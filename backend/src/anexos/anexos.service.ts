import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  PayloadTooLargeException,
  ServiceUnavailableException,
  BadGatewayException,
  ConflictException,
} from '@nestjs/common'
import { and, asc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm'
import { enxergaSetor, exigirEdicaoNoSetor } from '../common/acesso.js'
import type { Anexo, AnexoEnviado } from '../contracts/anexos.js'
import { TAMANHO_MAXIMO_ANEXO } from '../contracts/anexos.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import { hoje } from '../contracts/datas.js'
import type { LeituraDocumento } from '../contracts/leitura.js'
import type { Database, Transacao } from '../db/client.js'
import { DB } from '../db/database.module.js'
import {
  anexos,
  categorias,
  empreendimentos,
  eventos,
  formasPagamento,
  fornecedores,
  lancamentos,
  usuarios,
} from '../db/schema.js'
import { Armazenamento, nomeSeguro, sha256, tipoPeloConteudo } from './armazenamento.js'
import { LeituraIaService } from '../configuracoes/leitura-ia.service.js'
import { ErroLeitura, type ContextoLeitura } from './leitor.js'
import { documentoParaBusca, montarLeitura } from './leitura.js'

/** Token do armazenamento em disco. */
export const ARMAZENAMENTO = Symbol('ARMAZENAMENTO')

/** Arquivo como o multer entrega (guardado em memória). */
export interface ArquivoRecebido {
  buffer: Buffer
  originalname: string
  size: number
}

/** Rascunho que ninguém salvou some depois deste prazo, com o arquivo. */
const PRAZO_RASCUNHO_MS = 24 * 60 * 60_000

/**
 * Comprovantes: envio, leitura por IA, ver/baixar e remoção.
 *
 * Permissão: comprovante de lançamento segue o setor do lançamento (quem vê o
 * lançamento vê o arquivo; quem edita, anexa e remove). Rascunho é só de
 * quem enviou.
 */
@Injectable()
export class AnexosService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Comprovantes')
  private limpeza?: NodeJS.Timeout

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ARMAZENAMENTO) private readonly armazenamento: Armazenamento,
    private readonly leituraIa: LeituraIaService,
  ) {}

  onApplicationBootstrap() {
    // Pasta sem permissão aparece no log da subida, não só no primeiro envio que falhar.
    this.armazenamento
      .conferirEscrita()
      .catch((erro: Error) =>
        this.log.error(
          `a pasta dos comprovantes (${this.armazenamento.pasta}) não aceita escrita: ${erro.message}. No servidor: chown -R 1000:1000 dados`,
        ),
      )
    // De hora em hora, descarta rascunhos esquecidos (formulário abandonado).
    this.limpeza = setInterval(() => void this.limparRascunhos(), 60 * 60_000)
    this.limpeza.unref()
    void this.limparRascunhos()
  }

  onApplicationShutdown() {
    if (this.limpeza) clearInterval(this.limpeza)
  }

  async enviar(
    usuario: UsuarioSessao,
    arquivo: ArquivoRecebido | undefined,
    lancamentoId?: number,
  ): Promise<AnexoEnviado> {
    if (!arquivo?.buffer?.length) throw new BadRequestException('Escolha um arquivo')
    if (arquivo.size > TAMANHO_MAXIMO_ANEXO) {
      throw new PayloadTooLargeException('O arquivo passa de 15 MB')
    }
    const tipo = tipoPeloConteudo(arquivo.buffer)
    if (!tipo) throw new BadRequestException('Envie um PDF, JPG ou PNG')

    if (lancamentoId !== undefined) {
      const [lancamento] = await this.db
        .select({ setorId: lancamentos.setorId, situacao: lancamentos.situacao })
        .from(lancamentos)
        .where(eq(lancamentos.id, lancamentoId))
      if (!lancamento || !enxergaSetor(usuario, lancamento.setorId)) {
        throw new NotFoundException('Lançamento não encontrado')
      }
      exigirEdicaoNoSetor(usuario, lancamento.setorId)
      if (lancamento.situacao !== 'ativo') {
        throw new BadRequestException('Lançamento cancelado não recebe comprovante')
      }
    }

    const hash = sha256(arquivo.buffer)
    const nome = nomeSeguro(arquivo.originalname, tipo)
    const caminho = await this.armazenamento.gravar(arquivo.buffer, tipo)

    let novo: { id: number; enviadoEm: Date }
    try {
      novo = await this.db.transaction(async (tx) => {
        const [linha] = await tx
          .insert(anexos)
          .values({
            lancamentoId: lancamentoId ?? null,
            nome,
            tipo,
            tamanho: arquivo.buffer.length,
            sha256: hash,
            caminho,
            enviadoPor: usuario.id,
          })
          .returning({ id: anexos.id, enviadoEm: anexos.enviadoEm })
        if (lancamentoId !== undefined) {
          await tx.insert(eventos).values({
            lancamentoId,
            tipo: 'anexo_adicionado',
            usuarioId: usuario.id,
            dados: { anexo: nome },
          })
        }
        return linha!
      })
    } catch (erro) {
      // Sem registro no banco, o arquivo gravado não teria dono: sai do disco.
      await this.armazenamento.apagar(caminho)
      throw erro
    }

    return {
      id: novo.id,
      nome,
      tipo,
      tamanho: arquivo.buffer.length,
      enviadoEm: novo.enviadoEm.toISOString(),
      enviadoPor: { id: usuario.id, nome: usuario.nome },
      duplicadoDe: await this.duplicado(usuario, hash, lancamentoId),
      leituraDisponivel: await this.leituraIa.disponivel(),
    }
  }

  /** O mesmo conteúdo já anexado a outro lançamento ativo que a pessoa enxerga. */
  private async duplicado(usuario: UsuarioSessao, hash: string, excetoLancamento?: number) {
    const achados = await this.db
      .select({
        lancamentoId: lancamentos.id,
        descricao: lancamentos.descricao,
        setorId: lancamentos.setorId,
      })
      .from(anexos)
      .innerJoin(lancamentos, eq(lancamentos.id, anexos.lancamentoId))
      .where(
        and(
          eq(anexos.sha256, hash),
          isNull(anexos.removidoEm),
          eq(lancamentos.situacao, 'ativo'),
          excetoLancamento !== undefined ? ne(lancamentos.id, excetoLancamento) : undefined,
        ),
      )
      .orderBy(asc(lancamentos.id))
    const visivel = achados.find((a) => enxergaSetor(usuario, a.setorId))
    return visivel ? { lancamentoId: visivel.lancamentoId, descricao: visivel.descricao } : null
  }

  /** Registro do comprovante com o setor do lançamento (null no rascunho), conferindo quem pode ver. */
  private async carregar(usuario: UsuarioSessao, id: number) {
    const [linha] = await this.db
      .select({
        id: anexos.id,
        lancamentoId: anexos.lancamentoId,
        setorId: lancamentos.setorId,
        situacaoLancamento: lancamentos.situacao,
        nome: anexos.nome,
        tipo: anexos.tipo,
        tamanho: anexos.tamanho,
        caminho: anexos.caminho,
        enviadoPor: anexos.enviadoPor,
      })
      .from(anexos)
      .leftJoin(lancamentos, eq(lancamentos.id, anexos.lancamentoId))
      .where(and(eq(anexos.id, id), isNull(anexos.removidoEm)))
    const pode =
      linha &&
      (linha.setorId === null
        ? linha.enviadoPor === usuario.id
        : enxergaSetor(usuario, linha.setorId))
    if (!pode) throw new NotFoundException('Comprovante não encontrado')
    return linha
  }

  /** O arquivo para ver ou baixar. */
  async arquivo(usuario: UsuarioSessao, id: number) {
    const a = await this.carregar(usuario, id)
    return {
      nome: a.nome,
      tipo: a.tipo,
      tamanho: a.tamanho,
      conteudo: this.armazenamento.ler(a.caminho),
    }
  }

  /**
   * Rascunho sai de vez (arquivo e registro). Comprovante de lançamento só
   * sai da lista: o arquivo fica, e o histórico do lançamento registra.
   */
  async remover(usuario: UsuarioSessao, id: number): Promise<void> {
    const a = await this.carregar(usuario, id)
    if (a.lancamentoId === null) {
      // A condição vai no próprio DELETE: se o rascunho acabou de ser ligado a um
      // lançamento (salvar ao mesmo tempo), ele não é apagado.
      const [apagado] = await this.db
        .delete(anexos)
        .where(
          and(eq(anexos.id, id), isNull(anexos.lancamentoId), eq(anexos.enviadoPor, usuario.id)),
        )
        .returning({ caminho: anexos.caminho })
      if (!apagado) throw new ConflictException('O comprovante já foi salvo no lançamento')
      await this.armazenamento.apagar(apagado.caminho)
      return
    }
    exigirEdicaoNoSetor(usuario, a.setorId!)
    if (a.situacaoLancamento !== 'ativo') {
      throw new ConflictException('Lançamento cancelado não muda de comprovantes')
    }
    await this.db.transaction(async (tx) => {
      const [tirado] = await tx
        .update(anexos)
        .set({ removidoEm: new Date(), removidoPor: usuario.id })
        .where(and(eq(anexos.id, id), isNull(anexos.removidoEm)))
        .returning({ id: anexos.id })
      // Duas remoções ao mesmo tempo: só a primeira vale (e registra).
      if (!tirado) return
      await tx.insert(eventos).values({
        lancamentoId: a.lancamentoId!,
        tipo: 'anexo_removido',
        usuarioId: usuario.id,
        dados: { anexo: a.nome },
      })
    })
  }

  /**
   * Liga ao lançamento os rascunhos enviados no formulário. Só aceita
   * rascunho da própria pessoa: comprovante de outro lançamento não muda de dono.
   */
  async vincular(
    tx: Transacao,
    usuario: UsuarioSessao,
    lancamentoId: number,
    ids: number[],
  ): Promise<Array<{ id: number; nome: string }>> {
    const unicos = [...new Set(ids)]
    if (!unicos.length) return []
    const ligados = await tx
      .update(anexos)
      .set({ lancamentoId })
      .where(
        and(
          inArray(anexos.id, unicos),
          isNull(anexos.lancamentoId),
          isNull(anexos.removidoEm),
          eq(anexos.enviadoPor, usuario.id),
        ),
      )
      .returning({ id: anexos.id, nome: anexos.nome })
    if (ligados.length !== unicos.length) {
      throw new BadRequestException({
        message: 'Um dos comprovantes não foi encontrado; envie o arquivo de novo',
        issues: [{ path: 'anexoIds', message: 'Envie o comprovante de novo' }],
      })
    }
    return ligados
  }

  /** Comprovantes de um lançamento, do mais antigo ao mais novo. */
  async doLancamento(lancamentoId: number): Promise<Anexo[]> {
    const linhas = await this.db
      .select({
        id: anexos.id,
        nome: anexos.nome,
        tipo: anexos.tipo,
        tamanho: anexos.tamanho,
        enviadoEm: anexos.enviadoEm,
        porId: usuarios.id,
        porNome: usuarios.nome,
      })
      .from(anexos)
      .innerJoin(usuarios, eq(usuarios.id, anexos.enviadoPor))
      .where(and(eq(anexos.lancamentoId, lancamentoId), isNull(anexos.removidoEm)))
      .orderBy(asc(anexos.enviadoEm), asc(anexos.id))
    return linhas.map((l) => ({
      id: l.id,
      nome: l.nome,
      tipo: l.tipo,
      tamanho: l.tamanho,
      enviadoEm: l.enviadoEm.toISOString(),
      enviadoPor: { id: l.porId, nome: l.porNome },
    }))
  }

  /**
   * Lê o comprovante com a IA e devolve o que dá para pré-preencher. Não
   * grava nada no lançamento; guarda no comprovante o que foi lido.
   */
  async ler(usuario: UsuarioSessao, id: number, setorId: number): Promise<LeituraDocumento> {
    const leitor = await this.leituraIa.leitor()
    if (!leitor) {
      throw new ServiceUnavailableException(
        'A leitura automática está desligada. O administrador liga em Cadastros → Leitura por IA.',
      )
    }
    exigirEdicaoNoSetor(usuario, setorId)
    const a = await this.carregar(usuario, id)
    const conteudo = await this.armazenamento.lerConteudo(a.caminho)
    const contexto = await this.contexto(setorId)

    let resultado
    try {
      resultado = await leitor.ler(conteudo, a.tipo, contexto)
    } catch (erro) {
      const e = erro as Error
      this.log.warn(
        `leitura do comprovante ${id} falhou: ${e instanceof ErroLeitura ? (e.detalhe ?? e.message) : e.message}`,
      )
      throw new BadGatewayException(
        e instanceof ErroLeitura
          ? e.message
          : 'Não deu para ler o documento agora. Preencha à mão ou tente de novo em instantes.',
      )
    }

    const documento = documentoParaBusca(resultado.extraido)
    const [cadastrado] = documento
      ? await this.db
          .select({ id: fornecedores.id, nome: fornecedores.nome, ativo: fornecedores.ativo })
          .from(fornecedores)
          .where(eq(fornecedores.documento, documento))
      : []
    const leitura = montarLeitura(resultado.extraido, contexto, cadastrado ?? null)

    await this.db
      .update(anexos)
      .set({
        leitura: {
          modelo: resultado.modelo,
          em: new Date().toISOString(),
          tokensEntrada: resultado.tokensEntrada,
          tokensSaida: resultado.tokensSaida,
          resultado: leitura,
        },
      })
      .where(eq(anexos.id, id))
    this.log.log(
      `comprovante ${id} lido (${resultado.modelo}, ${resultado.tokensEntrada} + ${resultado.tokensSaida} tokens)`,
    )
    return leitura
  }

  /** As listas ativas que a IA pode sugerir: categorias do setor, empreendimentos e formas. */
  private async contexto(setorId: number): Promise<ContextoLeitura> {
    const [cats, emps, formas] = await Promise.all([
      this.db
        .select({ id: categorias.id, nome: categorias.nome, descricao: categorias.descricao })
        .from(categorias)
        .where(and(eq(categorias.setorId, setorId), eq(categorias.ativo, true)))
        .orderBy(asc(categorias.ordem), asc(categorias.nome)),
      this.db
        .select({ id: empreendimentos.id, nome: empreendimentos.nome })
        .from(empreendimentos)
        .where(eq(empreendimentos.ativo, true))
        .orderBy(asc(empreendimentos.ordem), asc(empreendimentos.nome)),
      this.db
        .select({
          id: formasPagamento.id,
          nome: formasPagamento.nome,
          cartao: formasPagamento.cartao,
        })
        .from(formasPagamento)
        .where(eq(formasPagamento.ativo, true))
        .orderBy(asc(formasPagamento.ordem), asc(formasPagamento.nome)),
    ])
    return { hoje: hoje(), categorias: cats, empreendimentos: emps, formasPagamento: formas }
  }

  /** Apaga rascunhos com mais de um dia (arquivo e registro). */
  async limparRascunhos(): Promise<number> {
    try {
      const velhos = await this.db
        .delete(anexos)
        .where(
          and(
            isNull(anexos.lancamentoId),
            lt(anexos.enviadoEm, sql`now() - ${`${PRAZO_RASCUNHO_MS / 1000} seconds`}::interval`),
          ),
        )
        .returning({ caminho: anexos.caminho })
      for (const v of velhos) await this.armazenamento.apagar(v.caminho)
      if (velhos.length) this.log.log(`${velhos.length} rascunho(s) de comprovante descartado(s)`)
      return velhos.length
    } catch (erro) {
      this.log.error(`limpeza de rascunhos falhou: ${(erro as Error).message}`)
      return 0
    }
  }
}
