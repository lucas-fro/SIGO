import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias, type PgTable } from 'drizzle-orm/pg-core'
import { AnexosService } from '../anexos/anexos.service.js'
import { enxergaSetor, escopoDeSetor, exigirEdicaoNoSetor } from '../common/acesso.js'
import { erroDeValidacao } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import type { ErroValidacao } from '../contracts/comum.js'
import {
  diaDoMes,
  fimDoMes,
  hoje,
  janelaDe12Meses,
  somarDias,
  somarMeses,
  somarMesesAoMes,
  vencimentoDaFatura,
} from '../contracts/datas.js'
import { normalizarDocumento } from '../contracts/documento.js'
import type {
  Alteracao,
  CriarLancamentoInput,
  FiltrosFixosLancados,
  FiltrosLancamentos,
  FixosLancados,
  Indicadores,
  LancamentoDetalhe,
  LancamentoInput,
  LancamentoResumo,
  LancarFixosInput,
  ListaLancamentos,
  ParcelaInput,
  PossivelDuplicado,
  RespostaDuplicidade,
  ResultadoLancarFixos,
  SituacaoLancamento,
} from '../contracts/lancamentos.js'
import { situacaoPagamento } from '../contracts/parcelas.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import {
  anexos,
  campanhas,
  cartoes,
  categorias,
  empreendimentos,
  eventos,
  formasPagamento,
  fornecedores,
  gastosFixos,
  lancamentos,
  parcelas,
  setores,
  usuarios,
} from '../db/schema.js'

/**
 * Totais das parcelas por lançamento, calculados no banco.
 *
 * "Vencida" depende do dia de hoje em São Paulo, que entra como parâmetro: o
 * servidor e o banco rodam em UTC, e às 21h de Brasília o `current_date` deles
 * já é amanhã.
 */
function resumoParcelas(db: Database, hojeIso: string) {
  return db
    .select({
      lancamentoId: parcelas.lancamentoId,
      quantidade: sql<number>`count(*)::int`.as('quantidade'),
      pagas: sql<number>`count(${parcelas.pagoEm})::int`.as('pagas'),
      vencidas:
        sql<number>`(count(*) filter (where ${parcelas.pagoEm} is null and ${parcelas.vencimento} < ${hojeIso}::date))::int`.as(
          'vencidas',
        ),
      proximoVencimento: sql<
        string | null
      >`min(${parcelas.vencimento}) filter (where ${parcelas.pagoEm} is null)`.as(
        'proximo_vencimento',
      ),
      emAbertoCentavos:
        sql<string>`coalesce(sum(${parcelas.valorCentavos}) filter (where ${parcelas.pagoEm} is null), 0)::bigint`.as(
          'em_aberto_centavos',
        ),
    })
    .from(parcelas)
    .groupBy(parcelas.lancamentoId)
    .as('resumo')
}
type Resumo = ReturnType<typeof resumoParcelas>

/** Comprovantes do lançamento que continuam na lista (os removidos não contam). */
const qtdAnexos = sql<number>`(select count(*) from ${anexos} where ${anexos.lancamentoId} = ${lancamentos.id} and ${anexos.removidoEm} is null)::int`
const temAnexo = sql`exists (select 1 from ${anexos} where ${anexos.lancamentoId} = ${lancamentos.id} and ${anexos.removidoEm} is null)`

/** Colunas da lista, com os nomes dos cadastros já resolvidos. */
function camposResumo(resumo: Resumo) {
  return {
    id: lancamentos.id,
    setorId: setores.id,
    setorNome: setores.nome,
    descricao: lancamentos.descricao,
    valorCentavos: lancamentos.valorCentavos,
    dataGasto: lancamentos.dataGasto,
    categoriaId: categorias.id,
    categoriaNome: categorias.nome,
    formaPagamentoId: formasPagamento.id,
    formaPagamentoNome: formasPagamento.nome,
    empreendimentoId: empreendimentos.id,
    empreendimentoNome: empreendimentos.nome,
    fornecedorId: fornecedores.id,
    fornecedorNome: fornecedores.nome,
    fornecedorDocumento: fornecedores.documento,
    campanhaId: campanhas.id,
    campanhaNome: campanhas.nome,
    cartaoId: cartoes.id,
    cartaoNome: cartoes.nome,
    codigoIdentificacao: lancamentos.codigoIdentificacao,
    situacao: lancamentos.situacao,
    criadoEm: lancamentos.criadoEm,
    parcelasQtd: resumo.quantidade,
    parcelasPagas: resumo.pagas,
    parcelasVencidas: resumo.vencidas,
    proximoVencimento: resumo.proximoVencimento,
    emAbertoCentavos: resumo.emAbertoCentavos,
    anexos: qtdAnexos,
  }
}

interface LinhaResumo {
  id: number
  setorId: number
  setorNome: string
  descricao: string
  valorCentavos: number
  dataGasto: string
  categoriaId: number | null
  categoriaNome: string | null
  formaPagamentoId: number | null
  formaPagamentoNome: string | null
  empreendimentoId: number | null
  empreendimentoNome: string | null
  fornecedorId: number | null
  fornecedorNome: string | null
  fornecedorDocumento: string | null
  campanhaId: number | null
  campanhaNome: string | null
  cartaoId: number | null
  cartaoNome: string | null
  codigoIdentificacao: string | null
  situacao: SituacaoLancamento
  criadoEm: Date
  parcelasQtd: number
  parcelasPagas: number
  parcelasVencidas: number
  proximoVencimento: string | null
  emAbertoCentavos: string | number
  anexos: number
}

/** Data vinda de agregação em SQL: o driver pode entregar texto ou Date, a API sempre devolve "AAAA-MM-DD". */
function comoData(valor: string | Date | null): string | null {
  if (valor === null) return null
  if (valor instanceof Date) {
    const y = valor.getFullYear()
    const m = String(valor.getMonth() + 1).padStart(2, '0')
    const d = String(valor.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return valor.slice(0, 10)
}

/** Cadastro opcional já com o nome resolvido, ou null quando o lançamento não tem. */
const ref = (id: number | null, nome: string | null) =>
  id === null ? null : { id, nome: nome ?? '' }

function paraResumo(r: LinhaResumo): LancamentoResumo {
  const quantidade = Number(r.parcelasQtd)
  const pagas = Number(r.parcelasPagas)
  return {
    id: r.id,
    setor: { id: r.setorId, nome: r.setorNome },
    descricao: r.descricao,
    valorCentavos: r.valorCentavos,
    dataGasto: r.dataGasto,
    categoria: ref(r.categoriaId, r.categoriaNome),
    formaPagamento: ref(r.formaPagamentoId, r.formaPagamentoNome),
    empreendimento: ref(r.empreendimentoId, r.empreendimentoNome),
    fornecedor:
      r.fornecedorId === null
        ? null
        : { id: r.fornecedorId, nome: r.fornecedorNome ?? '', documento: r.fornecedorDocumento },
    campanha: ref(r.campanhaId, r.campanhaNome),
    cartao: ref(r.cartaoId, r.cartaoNome),
    codigoIdentificacao: r.codigoIdentificacao,
    situacao: r.situacao,
    pagamento: {
      situacao: situacaoPagamento({
        parcelas: quantidade,
        pagas,
        vencidas: Number(r.parcelasVencidas),
      }),
      parcelas: quantidade,
      pagas,
      proximoVencimento: comoData(r.proximoVencimento),
      emAbertoCentavos: Number(r.emAbertoCentavos),
    },
    anexos: Number(r.anexos),
    criadoEm: r.criadoEm.toISOString(),
  }
}

/** Escapa curinga do ILIKE: quem busca "100%" quer o texto, não "100 seguido de qualquer coisa". */
const termoBusca = (texto: string): string => `%${texto.replace(/[\\%_]/g, '\\$&')}%`

const LANCAMENTO_MUDOU =
  'Este lançamento mudou desde que a edição foi aberta (por exemplo, um pagamento conferido no Sienge). Recarregue a página para editar a versão atual.'

/** Estado gravado de um lançamento, para comparar com a edição. */
interface Atual {
  id: number
  setorId: number
  descricao: string
  valorCentavos: number
  dataGasto: string
  categoriaId: number | null
  formaPagamentoId: number | null
  empreendimentoId: number | null
  fornecedorId: number | null
  campanhaId: number | null
  cartaoId: number | null
  codigoIdentificacao: string | null
  observacao: string | null
  situacao: SituacaoLancamento
  atualizadoEm: Date | null
  siengeTituloId: number | null
  parcelas: ParcelaInput[]
}

/** Campos de referência: o histórico guarda o nome de antes e de depois, não o id. */
const REFERENCIAS: Array<{
  campo: keyof Atual & keyof LancamentoInput
  rotulo: string
  tabela: PgTable
}> = [
  { campo: 'setorId', rotulo: 'Setor', tabela: setores },
  { campo: 'categoriaId', rotulo: 'Categoria', tabela: categorias },
  { campo: 'formaPagamentoId', rotulo: 'Forma de pagamento', tabela: formasPagamento },
  { campo: 'empreendimentoId', rotulo: 'Empreendimento', tabela: empreendimentos },
  { campo: 'fornecedorId', rotulo: 'Fornecedor', tabela: fornecedores },
  { campo: 'campanhaId', rotulo: 'Campanha', tabela: campanhas },
  { campo: 'cartaoId', rotulo: 'Cartão', tabela: cartoes },
]

const SIMPLES: Array<{ campo: keyof Atual & keyof LancamentoInput; rotulo: string }> = [
  { campo: 'descricao', rotulo: 'Descrição' },
  { campo: 'valorCentavos', rotulo: 'Valor' },
  { campo: 'dataGasto', rotulo: 'Data do gasto' },
  { campo: 'codigoIdentificacao', rotulo: 'Código de identificação' },
  { campo: 'observacao', rotulo: 'Observação' },
]

const chaveParcelas = (lista: ParcelaInput[]): string =>
  JSON.stringify(lista.map((p) => [p.valorCentavos, p.vencimento, p.pagoEm]))

@Injectable()
export class LancamentosService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly comprovantes: AnexosService,
  ) {}

  async listar(usuario: UsuarioSessao, filtros: FiltrosLancamentos): Promise<ListaLancamentos> {
    const resumo = resumoParcelas(this.db, hoje())
    const where = this.condicoes(usuario, filtros, resumo)

    const [linhas, totais] = await Promise.all([
      this.db
        .select(camposResumo(resumo))
        .from(lancamentos)
        .innerJoin(setores, eq(setores.id, lancamentos.setorId))
        .leftJoin(categorias, eq(categorias.id, lancamentos.categoriaId))
        .leftJoin(formasPagamento, eq(formasPagamento.id, lancamentos.formaPagamentoId))
        .leftJoin(empreendimentos, eq(empreendimentos.id, lancamentos.empreendimentoId))
        .leftJoin(fornecedores, eq(fornecedores.id, lancamentos.fornecedorId))
        .leftJoin(campanhas, eq(campanhas.id, lancamentos.campanhaId))
        .leftJoin(cartoes, eq(cartoes.id, lancamentos.cartaoId))
        .innerJoin(resumo, eq(resumo.lancamentoId, lancamentos.id))
        .where(where)
        .orderBy(desc(lancamentos.dataGasto), desc(lancamentos.id))
        .limit(filtros.porPagina)
        .offset((filtros.pagina - 1) * filtros.porPagina),
      this.db
        .select({
          total: sql<number>`count(*)::int`,
          soma: sql<string>`coalesce(sum(${lancamentos.valorCentavos}), 0)::bigint`,
          // Cancelado não tem nada a pagar, mesmo com parcela sem data de pagamento.
          emAberto: sql<string>`coalesce(sum(${resumo.emAbertoCentavos}) filter (where ${lancamentos.situacao} = 'ativo'), 0)::bigint`,
        })
        .from(lancamentos)
        .leftJoin(fornecedores, eq(fornecedores.id, lancamentos.fornecedorId))
        .innerJoin(resumo, eq(resumo.lancamentoId, lancamentos.id))
        .where(where),
    ])

    return {
      itens: linhas.map(paraResumo),
      total: Number(totais[0]?.total ?? 0),
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
      somaCentavos: Number(totais[0]?.soma ?? 0),
      emAbertoCentavos: Number(totais[0]?.emAberto ?? 0),
    }
  }

  async detalhar(usuario: UsuarioSessao, id: number): Promise<LancamentoDetalhe> {
    const resumo = resumoParcelas(this.db, hoje())
    const criador = alias(usuarios, 'criador')
    const cancelador = alias(usuarios, 'cancelador')

    const [linha] = await this.db
      .select({
        ...camposResumo(resumo),
        observacao: lancamentos.observacao,
        atualizadoEm: lancamentos.atualizadoEm,
        criadoPorId: criador.id,
        criadoPorNome: criador.nome,
        canceladoEm: lancamentos.canceladoEm,
        motivoCancelamento: lancamentos.motivoCancelamento,
        canceladoPorId: cancelador.id,
        canceladoPorNome: cancelador.nome,
        siengeTituloId: lancamentos.siengeTituloId,
        siengeVinculo: lancamentos.siengeVinculo,
        siengeProvas: lancamentos.siengeProvas,
        siengeVinculadoEm: lancamentos.siengeVinculadoEm,
        siengePausadoEm: lancamentos.siengePausadoEm,
      })
      .from(lancamentos)
      .innerJoin(setores, eq(setores.id, lancamentos.setorId))
      .leftJoin(categorias, eq(categorias.id, lancamentos.categoriaId))
      .leftJoin(formasPagamento, eq(formasPagamento.id, lancamentos.formaPagamentoId))
      .leftJoin(empreendimentos, eq(empreendimentos.id, lancamentos.empreendimentoId))
      .leftJoin(fornecedores, eq(fornecedores.id, lancamentos.fornecedorId))
      .leftJoin(campanhas, eq(campanhas.id, lancamentos.campanhaId))
      .leftJoin(cartoes, eq(cartoes.id, lancamentos.cartaoId))
      .innerJoin(resumo, eq(resumo.lancamentoId, lancamentos.id))
      .innerJoin(criador, eq(criador.id, lancamentos.criadoPor))
      .leftJoin(cancelador, eq(cancelador.id, lancamentos.canceladoPor))
      .where(eq(lancamentos.id, id))
      .limit(1)

    // Setor que a pessoa não enxerga responde como inexistente: não confirma que o número existe.
    if (!linha || !enxergaSetor(usuario, linha.setorId)) {
      throw new NotFoundException('Lançamento não encontrado')
    }

    const [listaParcelas, listaEventos, listaAnexos] = await Promise.all([
      this.db
        .select({
          id: parcelas.id,
          numero: parcelas.numero,
          valorCentavos: parcelas.valorCentavos,
          vencimento: parcelas.vencimento,
          pagoEm: parcelas.pagoEm,
        })
        .from(parcelas)
        .where(eq(parcelas.lancamentoId, id))
        .orderBy(asc(parcelas.numero)),
      this.db
        .select({
          id: eventos.id,
          tipo: eventos.tipo,
          em: eventos.em,
          dados: eventos.dados,
          usuarioId: usuarios.id,
          usuarioNome: usuarios.nome,
        })
        .from(eventos)
        .innerJoin(usuarios, eq(usuarios.id, eventos.usuarioId))
        .where(eq(eventos.lancamentoId, id))
        .orderBy(desc(eventos.em), desc(eventos.id)),
      this.comprovantes.doLancamento(id),
    ])

    const cancelamento =
      linha.canceladoEm && linha.canceladoPorId !== null
        ? {
            em: linha.canceladoEm.toISOString(),
            por: { id: linha.canceladoPorId, nome: linha.canceladoPorNome ?? '' },
            motivo: linha.motivoCancelamento ?? '',
          }
        : null

    return {
      ...paraResumo(linha),
      observacao: linha.observacao,
      parcelas: listaParcelas,
      anexos: listaAnexos,
      sienge:
        linha.siengeTituloId !== null && linha.siengeVinculo && linha.siengeVinculadoEm
          ? {
              tituloId: linha.siengeTituloId,
              vinculo: linha.siengeVinculo,
              provas: linha.siengeProvas ?? null,
              vinculadoEm: linha.siengeVinculadoEm.toISOString(),
              pausadoEm: linha.siengePausadoEm?.toISOString() ?? null,
            }
          : null,
      eventos: listaEventos.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        em: e.em.toISOString(),
        usuario: { id: e.usuarioId, nome: e.usuarioNome },
        dados: e.dados ?? null,
      })),
      criadoPor: { id: linha.criadoPorId, nome: linha.criadoPorNome },
      atualizadoEm: linha.atualizadoEm?.toISOString() ?? null,
      cancelamento,
    }
  }

  async criar(usuario: UsuarioSessao, entrada: CriarLancamentoInput): Promise<LancamentoDetalhe> {
    exigirEdicaoNoSetor(usuario, entrada.setorId)
    await this.validarEntrada(entrada)

    if (!entrada.confirmarDuplicidade) {
      const duplicados = await this.possiveisDuplicados(entrada)
      if (duplicados.length) {
        const corpo: RespostaDuplicidade = {
          message:
            'Há lançamentos parecidos com este. Confira se não é o mesmo gasto antes de salvar.',
          duplicados,
        }
        throw new ConflictException(corpo)
      }
    }

    const id = await this.db.transaction(async (tx) => {
      const [novo] = await tx
        .insert(lancamentos)
        .values({
          setorId: entrada.setorId,
          descricao: entrada.descricao,
          valorCentavos: entrada.valorCentavos,
          dataGasto: entrada.dataGasto,
          categoriaId: entrada.categoriaId,
          formaPagamentoId: entrada.formaPagamentoId,
          empreendimentoId: entrada.empreendimentoId,
          fornecedorId: entrada.fornecedorId,
          campanhaId: entrada.campanhaId,
          cartaoId: entrada.cartaoId,
          codigoIdentificacao: entrada.codigoIdentificacao,
          observacao: entrada.observacao,
          criadoPor: usuario.id,
        })
        .returning({ id: lancamentos.id })
      const lancamentoId = novo!.id

      await tx
        .insert(parcelas)
        .values(entrada.parcelas.map((p, i) => ({ lancamentoId, numero: i + 1, ...p })))
      await tx.insert(eventos).values({ lancamentoId, tipo: 'criado', usuarioId: usuario.id })
      // Os comprovantes enviados no formulário passam a ser deste lançamento (fazem parte da criação).
      await this.comprovantes.vincular(tx, usuario, lancamentoId, entrada.anexoIds)
      return lancamentoId
    })

    return this.detalhar(usuario, id)
  }

  /** Substitui todos os campos e as parcelas. O que mudou vai para o histórico, com antes e depois. */
  async atualizar(
    usuario: UsuarioSessao,
    id: number,
    entrada: LancamentoInput,
  ): Promise<LancamentoDetalhe> {
    const atual = await this.carregarAtual(id)
    if (!atual || !enxergaSetor(usuario, atual.setorId)) {
      throw new NotFoundException('Lançamento não encontrado')
    }
    exigirEdicaoNoSetor(usuario, atual.setorId)
    if (entrada.setorId !== atual.setorId) exigirEdicaoNoSetor(usuario, entrada.setorId)
    if (atual.situacao === 'cancelado') {
      throw new ConflictException('Lançamento cancelado não pode ser editado')
    }
    // O formulário abriu uma versão e alguém (ou a conferência com o Sienge) mudou o
    // lançamento depois: salvar agora desfaria a mudança sem a pessoa saber.
    if (
      entrada.versao !== undefined &&
      entrada.versao !== (atual.atualizadoEm?.toISOString() ?? null)
    ) {
      throw new ConflictException(LANCAMENTO_MUDOU)
    }

    await this.validarEntrada(entrada, atual)
    const alteracoes = await this.alteracoes(atual, entrada)
    if (!alteracoes.length && !entrada.anexoIds.length) return this.detalhar(usuario, id)

    await this.db.transaction(async (tx) => {
      // A conferência acima leu o lançamento fora da transação: trava a linha e confere de
      // novo. Se um pagamento (da pessoa ou da conferência com o Sienge) entrou nesse meio
      // tempo, as parcelas abaixo o apagariam.
      const [travado] = await tx
        .select({ atualizadoEm: lancamentos.atualizadoEm, situacao: lancamentos.situacao })
        .from(lancamentos)
        .where(eq(lancamentos.id, id))
        .for('update')
      if (
        !travado ||
        travado.situacao !== 'ativo' ||
        (travado.atualizadoEm?.toISOString() ?? null) !==
          (atual.atualizadoEm?.toISOString() ?? null)
      ) {
        throw new ConflictException(LANCAMENTO_MUDOU)
      }
      const ligados = await this.comprovantes.vincular(tx, usuario, id, entrada.anexoIds)
      if (ligados.length) {
        await tx.insert(eventos).values(
          ligados.map((a) => ({
            lancamentoId: id,
            tipo: 'anexo_adicionado' as const,
            usuarioId: usuario.id,
            dados: { anexo: a.nome },
          })),
        )
      }
      if (!alteracoes.length) return

      const campos = new Set(alteracoes.map((a) => a.campo))
      // O vínculo com o Sienge foi achado com o que serve de prova (fornecedor, valor,
      // código, parcelas, empreendimento, data do gasto e setor): se algo disso mudou, ele
      // sai (e a pausa junto) e o lançamento volta a ser procurado.
      const soltaSienge =
        atual.siengeTituloId !== null &&
        [
          'fornecedorId',
          'valorCentavos',
          'codigoIdentificacao',
          'parcelas',
          'empreendimentoId',
          'dataGasto',
          'setorId',
        ].some((c) => campos.has(c))
      // Tirou pela edição um pagamento que a conferência tinha marcado: pausa a conferência.
      const pausaSienge =
        !soltaSienge &&
        atual.siengeTituloId !== null &&
        atual.parcelas.some((p, i) => p.pagoEm && !entrada.parcelas[i]?.pagoEm) &&
        (await this.teveMarcacaoDoSienge(id))

      await tx
        .update(lancamentos)
        .set({
          setorId: entrada.setorId,
          descricao: entrada.descricao,
          valorCentavos: entrada.valorCentavos,
          dataGasto: entrada.dataGasto,
          categoriaId: entrada.categoriaId,
          formaPagamentoId: entrada.formaPagamentoId,
          empreendimentoId: entrada.empreendimentoId,
          fornecedorId: entrada.fornecedorId,
          campanhaId: entrada.campanhaId,
          cartaoId: entrada.cartaoId,
          codigoIdentificacao: entrada.codigoIdentificacao,
          observacao: entrada.observacao,
          atualizadoPor: usuario.id,
          atualizadoEm: new Date(),
          ...(soltaSienge
            ? {
                siengeTituloId: null,
                siengeVinculo: null,
                siengeProvas: null,
                siengeVinculadoEm: null,
                siengePausadoEm: null,
              }
            : {}),
          ...(pausaSienge ? { siengePausadoEm: new Date() } : {}),
        })
        .where(eq(lancamentos.id, id))

      if (alteracoes.some((a) => a.campo === 'parcelas')) {
        await tx.delete(parcelas).where(eq(parcelas.lancamentoId, id))
        await tx
          .insert(parcelas)
          .values(entrada.parcelas.map((p, i) => ({ lancamentoId: id, numero: i + 1, ...p })))
      }

      await tx
        .insert(eventos)
        .values({ lancamentoId: id, tipo: 'editado', usuarioId: usuario.id, dados: { alteracoes } })
    })

    return this.detalhar(usuario, id)
  }

  /** Cancelar é o "apagar" do sistema: o lançamento sai dos totais, mas continua consultável com o motivo. */
  async cancelar(usuario: UsuarioSessao, id: number, motivo: string): Promise<LancamentoDetalhe> {
    const [atual] = await this.db
      .select({ setorId: lancamentos.setorId, situacao: lancamentos.situacao })
      .from(lancamentos)
      .where(eq(lancamentos.id, id))
    if (!atual || !enxergaSetor(usuario, atual.setorId)) {
      throw new NotFoundException('Lançamento não encontrado')
    }
    exigirEdicaoNoSetor(usuario, atual.setorId)

    await this.db.transaction(async (tx) => {
      const agora = new Date()
      // A condição na própria atualização resolve dois cliques simultâneos: só um cancela.
      const alterados = await tx
        .update(lancamentos)
        .set({
          situacao: 'cancelado',
          canceladoEm: agora,
          canceladoPor: usuario.id,
          motivoCancelamento: motivo,
          atualizadoPor: usuario.id,
          atualizadoEm: agora,
          // O título do Sienge fica livre para o lançamento certo (um título serve a um lançamento só).
          siengeTituloId: null,
          siengeVinculo: null,
          siengeProvas: null,
          siengeVinculadoEm: null,
          siengePausadoEm: null,
        })
        .where(and(eq(lancamentos.id, id), eq(lancamentos.situacao, 'ativo')))
        .returning({ id: lancamentos.id })
      if (!alterados.length) throw new ConflictException('Este lançamento já está cancelado')

      await tx
        .insert(eventos)
        .values({ lancamentoId: id, tipo: 'cancelado', usuarioId: usuario.id, dados: { motivo } })
    })

    return this.detalhar(usuario, id)
  }

  /** Registra (data) ou desfaz (null) o pagamento de uma parcela. */
  async pagamentoParcela(
    usuario: UsuarioSessao,
    lancamentoId: number,
    parcelaId: number,
    pagoEm: string | null,
  ): Promise<LancamentoDetalhe> {
    const [linha] = await this.db
      .select({
        setorId: lancamentos.setorId,
        situacao: lancamentos.situacao,
        numero: parcelas.numero,
        pagoEm: parcelas.pagoEm,
      })
      .from(parcelas)
      .innerJoin(lancamentos, eq(lancamentos.id, parcelas.lancamentoId))
      .where(and(eq(parcelas.id, parcelaId), eq(parcelas.lancamentoId, lancamentoId)))
    if (!linha || !enxergaSetor(usuario, linha.setorId)) {
      throw new NotFoundException('Parcela não encontrada')
    }
    exigirEdicaoNoSetor(usuario, linha.setorId)
    if (linha.situacao === 'cancelado') {
      throw new ConflictException('Lançamento cancelado não pode ser alterado')
    }
    if (pagoEm && pagoEm > hoje()) {
      throw erroDeValidacao([{ path: 'pagoEm', message: 'O pagamento não pode estar no futuro' }])
    }
    if (linha.pagoEm === pagoEm) return this.detalhar(usuario, lancamentoId)

    // Desfazer um pagamento que a conferência com o Sienge marcou pausa a conferência deste
    // lançamento: a pessoa decidiu, e às 00h/12h ele não pode voltar sozinho.
    const pausaSienge = !pagoEm && (await this.marcadaPeloSienge(lancamentoId, linha.numero))

    await this.db.transaction(async (tx) => {
      // Só se a parcela continua como foi lida: outra pessoa (ou a conferência) pode ter
      // registrado ou desfeito o pagamento nesse meio tempo.
      const [mudou] = await tx
        .update(parcelas)
        .set({ pagoEm })
        .where(
          and(
            eq(parcelas.id, parcelaId),
            linha.pagoEm === null ? isNull(parcelas.pagoEm) : eq(parcelas.pagoEm, linha.pagoEm),
          ),
        )
        .returning({ id: parcelas.id })
      if (!mudou) {
        throw new ConflictException(
          'O pagamento desta parcela mudou enquanto a tela estava aberta. Confira e tente de novo.',
        )
      }
      await tx
        .update(lancamentos)
        .set({
          atualizadoPor: usuario.id,
          atualizadoEm: new Date(),
          ...(pausaSienge ? { siengePausadoEm: new Date() } : {}),
        })
        .where(eq(lancamentos.id, lancamentoId))
      await tx.insert(eventos).values({
        lancamentoId,
        tipo: pagoEm ? 'pagamento_registrado' : 'pagamento_desfeito',
        usuarioId: usuario.id,
        // A data anterior também: trocar ou desfazer não pode apagar a que existia.
        dados: { parcela: linha.numero, pagoEm, pagoEmAnterior: linha.pagoEm },
      })
    })

    return this.detalhar(usuario, lancamentoId)
  }

  /** O último pagamento registrado desta parcela foi o da conferência com o Sienge. */
  private async marcadaPeloSienge(lancamentoId: number, numero: number): Promise<boolean> {
    const [ultimo] = await this.db
      .select({ dados: eventos.dados })
      .from(eventos)
      .where(
        and(
          eq(eventos.lancamentoId, lancamentoId),
          eq(eventos.tipo, 'pagamento_registrado'),
          sql`(${eventos.dados} ->> 'parcela')::int = ${numero}`,
        ),
      )
      .orderBy(desc(eventos.em), desc(eventos.id))
      .limit(1)
    return ultimo?.dados?.origem === 'sienge'
  }

  /** Algum pagamento deste lançamento foi marcado pela conferência com o Sienge. */
  private async teveMarcacaoDoSienge(lancamentoId: number): Promise<boolean> {
    const [algum] = await this.db
      .select({ id: eventos.id })
      .from(eventos)
      .where(
        and(
          eq(eventos.lancamentoId, lancamentoId),
          eq(eventos.tipo, 'pagamento_registrado'),
          sql`${eventos.dados} ->> 'origem' = 'sienge'`,
        ),
      )
      .limit(1)
    return !!algum
  }

  /** Quais gastos fixos do cartão já têm lançamento ativo no mês (para a tela avisar antes). */
  async fixosLancados(
    usuario: UsuarioSessao,
    { cartaoId, mes }: FiltrosFixosLancados,
  ): Promise<FixosLancados> {
    const [cartao] = await this.db
      .select({ setorId: cartoes.setorId })
      .from(cartoes)
      .where(eq(cartoes.id, cartaoId))
    if (!cartao || !enxergaSetor(usuario, cartao.setorId)) {
      throw new NotFoundException('Cartão não encontrado')
    }
    const inicio = `${mes}-01`
    // Pelo gasto fixo, como o "lançar" e o painel contam: o lançamento pode ter
    // mudado de cartão (ou ficado sem) depois de criado.
    const linhas = await this.db
      .selectDistinct({ gastoFixoId: lancamentos.gastoFixoId })
      .from(lancamentos)
      .where(
        and(
          inArray(
            lancamentos.gastoFixoId,
            this.db
              .select({ id: gastosFixos.id })
              .from(gastosFixos)
              .where(eq(gastosFixos.cartaoId, cartaoId)),
          ),
          eq(lancamentos.situacao, 'ativo'),
          between(lancamentos.dataGasto, inicio, fimDoMes(inicio)),
        ),
      )
    return { gastoFixoIds: linhas.map((l) => l.gastoFixoId!) }
  }

  /**
   * Lança, de uma vez, os gastos fixos ativos de um cartão num mês.
   *
   * Gasto fixo que já tem lançamento ativo no mês fica de fora, então clicar
   * duas vezes não duplica. A data do gasto é o dia da cobrança, e o
   * vencimento sai da fatura do cartão quando ela está configurada.
   */
  async lancarFixos(
    usuario: UsuarioSessao,
    { cartaoId, mes }: LancarFixosInput,
  ): Promise<ResultadoLancarFixos> {
    const [cartao] = await this.db.select().from(cartoes).where(eq(cartoes.id, cartaoId))
    if (!cartao || !enxergaSetor(usuario, cartao.setorId)) {
      throw new NotFoundException('Cartão não encontrado')
    }
    exigirEdicaoNoSetor(usuario, cartao.setorId)
    if (!cartao.ativo) throw new ConflictException('Este cartão está desativado')

    const inicio = `${mes}-01`
    const fim = fimDoMes(inicio)
    const [ano, numeroMes] = mes.split('-')

    return this.db.transaction(async (tx) => {
      // Dois cliques ao mesmo tempo esperam um pelo outro; o segundo encontra tudo lançado.
      await tx.execute(sql`select pg_advisory_xact_lock(7301, ${cartao.id})`)

      const fixos = await tx
        .select()
        .from(gastosFixos)
        .where(and(eq(gastosFixos.cartaoId, cartao.id), eq(gastosFixos.ativo, true)))
        .orderBy(asc(gastosFixos.diaCobranca), asc(gastosFixos.id))
      if (!fixos.length) return { criados: [], jaLancados: 0 }

      const existentes = await tx
        .select({ gastoFixoId: lancamentos.gastoFixoId })
        .from(lancamentos)
        .where(
          and(
            inArray(
              lancamentos.gastoFixoId,
              fixos.map((f) => f.id),
            ),
            eq(lancamentos.situacao, 'ativo'),
            between(lancamentos.dataGasto, inicio, fim),
          ),
        )
      const lancados = new Set(existentes.map((e) => e.gastoFixoId))

      const criados: number[] = []
      for (const fixo of fixos) {
        if (lancados.has(fixo.id)) continue
        const dataGasto = diaDoMes(mes, fixo.diaCobranca)
        const temFatura = !!(cartao.diaFechamento && cartao.diaVencimento)
        const vencimento = temFatura
          ? vencimentoDaFatura(dataGasto, cartao.diaFechamento!, cartao.diaVencimento!)
          : dataGasto
        // Sem fatura (pré-pago), o dinheiro sai sozinho no dia da cobrança: nasce pago
        // naquele dia, mesmo lançado antes (senão viraria "vencido" sem ninguém pagar nada).
        const pagoEm = temFatura ? null : dataGasto

        const [novo] = await tx
          .insert(lancamentos)
          .values({
            setorId: cartao.setorId,
            descricao: `${fixo.descricao} — ${numeroMes}/${ano}`,
            valorCentavos: fixo.valorCentavos,
            dataGasto,
            categoriaId: fixo.categoriaId,
            formaPagamentoId: cartao.formaPagamentoId,
            empreendimentoId: fixo.empreendimentoId,
            fornecedorId: fixo.fornecedorId,
            cartaoId: cartao.id,
            gastoFixoId: fixo.id,
            criadoPor: usuario.id,
          })
          .returning({ id: lancamentos.id })
        const lancamentoId = novo!.id

        await tx.insert(parcelas).values({
          lancamentoId,
          numero: 1,
          valorCentavos: fixo.valorCentavos,
          vencimento,
          pagoEm,
        })
        await tx.insert(eventos).values({
          lancamentoId,
          tipo: 'criado',
          usuarioId: usuario.id,
          dados: { origem: 'gasto_fixo' },
        })
        criados.push(lancamentoId)
      }

      return { criados, jaLancados: lancados.size }
    })
  }

  /**
   * A faixa de indicadores do topo da lista. Tudo sobre lançamentos ativos: o
   * cancelado não é gasto.
   */
  async indicadores(usuario: UsuarioSessao, setorId?: number, mes?: string): Promise<Indicadores> {
    const dia = hoje()
    const mesCorrente = dia.slice(0, 7)
    const referencia = mes ?? mesCorrente
    // No mês corrente, do dia 1 até hoje contra o mesmo trecho do anterior;
    // num mês que já terminou (ou futuro), o mês inteiro contra o anterior inteiro.
    const corrente = referencia === mesCorrente
    const inicioMes = `${referencia}-01`
    const fimMes = corrente ? dia : fimDoMes(inicioMes)
    const inicioAnterior = `${somarMesesAoMes(referencia, -1)}-01`
    const fimAnterior = corrente ? somarMeses(dia, -1) : fimDoMes(inicioAnterior)
    // O ano vai de 1º de janeiro até o mesmo corte do mês, contra o mesmo trecho do ano anterior.
    const inicioAno = `${referencia.slice(0, 4)}-01-01`
    const inicioAnoAnterior = `${Number(referencia.slice(0, 4)) - 1}-01-01`
    const fimAnoAnterior = corrente
      ? somarMeses(dia, -12)
      : fimDoMes(`${somarMesesAoMes(referencia, -12)}-01`)
    const janela = janelaDe12Meses(referencia, mesCorrente)
    const daquiA7 = somarDias(dia, 7)
    const ativos = and(
      eq(lancamentos.situacao, 'ativo'),
      escopoDeSetor(usuario, lancamentos.setorId, setorId),
    )
    const mesDoGasto = sql<string>`to_char(${lancamentos.dataGasto}, 'YYYY-MM')`

    const [gasto, serie, abertas] = await Promise.all([
      this.db
        .select({
          atual: sql<string>`coalesce(sum(${lancamentos.valorCentavos}) filter (where ${lancamentos.dataGasto} between ${inicioMes}::date and ${fimMes}::date), 0)::bigint`,
          anterior: sql<string>`coalesce(sum(${lancamentos.valorCentavos}) filter (where ${lancamentos.dataGasto} between ${inicioAnterior}::date and ${fimAnterior}::date), 0)::bigint`,
          lancamentos: sql<number>`(count(*) filter (where ${lancamentos.dataGasto} between ${inicioMes}::date and ${fimMes}::date))::int`,
          ano: sql<string>`coalesce(sum(${lancamentos.valorCentavos}) filter (where ${lancamentos.dataGasto} between ${inicioAno}::date and ${fimMes}::date), 0)::bigint`,
          anoAnterior: sql<string>`coalesce(sum(${lancamentos.valorCentavos}) filter (where ${lancamentos.dataGasto} between ${inicioAnoAnterior}::date and ${fimAnoAnterior}::date), 0)::bigint`,
        })
        .from(lancamentos)
        .where(and(ativos, between(lancamentos.dataGasto, inicioAnoAnterior, fimMes))),
      this.db
        .select({
          mes: mesDoGasto,
          centavos: sql<string>`sum(${lancamentos.valorCentavos})::bigint`,
        })
        .from(lancamentos)
        .where(
          and(
            ativos,
            between(lancamentos.dataGasto, `${janela.inicio}-01`, fimDoMes(`${janela.fim}-01`)),
            // O mês corrente vai até hoje, como o gasto do mês: a barra e o número batem.
            not(between(lancamentos.dataGasto, somarDias(dia, 1), fimDoMes(dia))),
          ),
        )
        .groupBy(mesDoGasto),
      this.db
        .select({
          emAberto: sql<string>`coalesce(sum(${parcelas.valorCentavos}), 0)::bigint`,
          parcelasEmAberto: sql<number>`count(*)::int`,
          vencido: sql<string>`coalesce(sum(${parcelas.valorCentavos}) filter (where ${parcelas.vencimento} < ${dia}::date), 0)::bigint`,
          parcelasVencidas: sql<number>`(count(*) filter (where ${parcelas.vencimento} < ${dia}::date))::int`,
          proximos: sql<string>`coalesce(sum(${parcelas.valorCentavos}) filter (where ${parcelas.vencimento} between ${dia}::date and ${daquiA7}::date), 0)::bigint`,
          parcelasProximas: sql<number>`(count(*) filter (where ${parcelas.vencimento} between ${dia}::date and ${daquiA7}::date))::int`,
        })
        .from(parcelas)
        .innerJoin(lancamentos, eq(lancamentos.id, parcelas.lancamentoId))
        .where(and(isNull(parcelas.pagoEm), ativos)),
    ])

    const porMes = new Map(serie.map((s) => [s.mes, Number(s.centavos)]))
    const g = gasto[0]
    const a = abertas[0]

    return {
      hoje: dia,
      mes: referencia,
      gastoMes: {
        centavos: Number(g?.atual ?? 0),
        anteriorCentavos: Number(g?.anterior ?? 0),
        lancamentos: Number(g?.lancamentos ?? 0),
      },
      gastoAno: {
        centavos: Number(g?.ano ?? 0),
        anteriorCentavos: Number(g?.anoAnterior ?? 0),
      },
      serieMensal: Array.from({ length: 12 }, (_, i) => {
        const chave = somarMesesAoMes(janela.inicio, i)
        return { mes: chave, centavos: porMes.get(chave) ?? 0 }
      }),
      emAberto: { centavos: Number(a?.emAberto ?? 0), parcelas: Number(a?.parcelasEmAberto ?? 0) },
      vencido: { centavos: Number(a?.vencido ?? 0), parcelas: Number(a?.parcelasVencidas ?? 0) },
      proximos7Dias: {
        centavos: Number(a?.proximos ?? 0),
        parcelas: Number(a?.parcelasProximas ?? 0),
      },
    }
  }

  private condicoes(
    usuario: UsuarioSessao,
    f: FiltrosLancamentos,
    resumo: Resumo,
  ): SQL | undefined {
    const condicoes: Array<SQL | undefined> = [
      escopoDeSetor(usuario, lancamentos.setorId, f.setorId),
    ]

    if (f.de) condicoes.push(gte(lancamentos.dataGasto, f.de))
    if (f.ate) condicoes.push(lte(lancamentos.dataGasto, f.ate))
    if (f.categoriaId) condicoes.push(eq(lancamentos.categoriaId, f.categoriaId))
    if (f.formaPagamentoId) condicoes.push(eq(lancamentos.formaPagamentoId, f.formaPagamentoId))
    if (f.empreendimentoId) condicoes.push(eq(lancamentos.empreendimentoId, f.empreendimentoId))
    if (f.fornecedorId) condicoes.push(eq(lancamentos.fornecedorId, f.fornecedorId))
    if (f.campanhaId) condicoes.push(eq(lancamentos.campanhaId, f.campanhaId))
    if (f.cartaoId) condicoes.push(eq(lancamentos.cartaoId, f.cartaoId))
    if (f.comprovante === 'com') condicoes.push(temAnexo)
    if (f.comprovante === 'sem') condicoes.push(sql`not ${temAnexo}`)
    if (f.situacao !== 'todos') condicoes.push(eq(lancamentos.situacao, f.situacao))

    if (f.pagamento === 'pago') condicoes.push(sql`${resumo.pagas} = ${resumo.quantidade}`)
    if (f.pagamento === 'em_aberto') condicoes.push(sql`${resumo.pagas} < ${resumo.quantidade}`)
    if (f.pagamento === 'vencido') condicoes.push(sql`${resumo.vencidas} > 0`)

    if (f.busca) {
      const termo = termoBusca(f.busca)
      const documento = normalizarDocumento(f.busca)
      condicoes.push(
        or(
          ilike(lancamentos.descricao, termo),
          ilike(lancamentos.codigoIdentificacao, termo),
          ilike(fornecedores.nome, termo),
          documento.length >= 3 ? ilike(fornecedores.documento, termoBusca(documento)) : undefined,
        ),
      )
    }

    return and(...condicoes)
  }

  /**
   * Confere o que o esquema sozinho não sabe: se os cadastros escolhidos
   * existem, estão ativos e pertencem ao setor. Cadastro em branco não tem o
   * que conferir (é opcional). Item desativado só é recusado quando é uma
   * escolha nova — lançamento antigo que já apontava para ele continua editável.
   */
  private async validarEntrada(entrada: LancamentoInput, atual?: Atual): Promise<void> {
    const buscar = <T>(escolhido: number | null, consulta: (id: number) => Promise<T[]>) =>
      escolhido === null ? Promise.resolve<T[]>([]) : consulta(escolhido)

    const [setor, categoria, forma, empreendimento, fornecedor, campanha, cartao] =
      await Promise.all([
        this.db
          .select({ ativo: setores.ativo })
          .from(setores)
          .where(eq(setores.id, entrada.setorId)),
        buscar(entrada.categoriaId, (id) =>
          this.db
            .select({ ativo: categorias.ativo, setorId: categorias.setorId })
            .from(categorias)
            .where(eq(categorias.id, id)),
        ),
        buscar(entrada.formaPagamentoId, (id) =>
          this.db
            .select({ ativo: formasPagamento.ativo, cartao: formasPagamento.cartao })
            .from(formasPagamento)
            .where(eq(formasPagamento.id, id)),
        ),
        buscar(entrada.empreendimentoId, (id) =>
          this.db
            .select({ ativo: empreendimentos.ativo })
            .from(empreendimentos)
            .where(eq(empreendimentos.id, id)),
        ),
        buscar(entrada.fornecedorId, (id) =>
          this.db
            .select({ ativo: fornecedores.ativo })
            .from(fornecedores)
            .where(eq(fornecedores.id, id)),
        ),
        buscar(entrada.campanhaId, (id) =>
          this.db
            .select({ ativo: campanhas.ativo, setorId: campanhas.setorId })
            .from(campanhas)
            .where(eq(campanhas.id, id)),
        ),
        buscar(entrada.cartaoId, (id) =>
          this.db
            .select({
              ativo: cartoes.ativo,
              setorId: cartoes.setorId,
              formaPagamentoId: cartoes.formaPagamentoId,
            })
            .from(cartoes)
            .where(eq(cartoes.id, id)),
        ),
      ])

    const problemas: ErroValidacao['issues'] = []
    const conferir = (
      path: keyof LancamentoInput,
      item: { ativo: boolean; setorId?: number } | undefined,
      nome: string,
    ) => {
      if (entrada[path] === null) return
      const novaEscolha = !atual || atual[path as keyof Atual] !== entrada[path]
      if (!item) problemas.push({ path, message: `${nome} não encontrado(a)` })
      else if (item.setorId !== undefined && item.setorId !== entrada.setorId) {
        problemas.push({ path, message: `${nome} de outro setor` })
      } else if (!item.ativo && novaEscolha) {
        problemas.push({ path, message: `${nome} desativado(a)` })
      }
    }

    conferir('setorId', setor[0], 'Setor')
    conferir('categoriaId', categoria[0], 'Categoria')
    conferir('formaPagamentoId', forma[0], 'Forma de pagamento')
    conferir('empreendimentoId', empreendimento[0], 'Empreendimento')
    conferir('fornecedorId', fornecedor[0], 'Fornecedor')
    conferir('campanhaId', campanha[0], 'Campanha')

    // Cartão (opcional): quando informado, precisa de uma forma de cartão, do
    // mesmo setor e da mesma forma. Sem cartão, o gasto só não entra no
    // orçamento de nenhum cartão. Lançamento antigo que não mexe em cartão nem
    // forma continua editável mesmo que o cadastro do cartão ou da forma tenha
    // mudado depois (como no cadastro desativado).
    if (entrada.cartaoId !== null) {
      const cartaoMudou =
        !atual ||
        atual.cartaoId !== entrada.cartaoId ||
        atual.formaPagamentoId !== entrada.formaPagamentoId
      if (entrada.formaPagamentoId === null) {
        problemas.push({
          path: 'formaPagamentoId',
          message: 'Escolha a forma de pagamento do cartão',
        })
      } else if (cartaoMudou && forma[0] && !forma[0].cartao) {
        problemas.push({ path: 'cartaoId', message: 'Esta forma de pagamento não usa cartão' })
      } else {
        conferir('cartaoId', cartao[0], 'Cartão')
        if (cartaoMudou && cartao[0] && cartao[0].formaPagamentoId !== entrada.formaPagamentoId) {
          problemas.push({ path: 'cartaoId', message: 'Este cartão é de outra forma de pagamento' })
        }
      }
    }

    const dia = hoje()
    entrada.parcelas.forEach((p, i) => {
      // O pagamento já gravado (o fixo de cartão pré-pago nasce pago na data da cobrança)
      // passa como está; só a data nova no futuro é recusada.
      const mesmaData = !!atual && atual.parcelas[i]?.pagoEm === p.pagoEm
      if (p.pagoEm && p.pagoEm > dia && !mesmaData) {
        problemas.push({
          path: `parcelas.${i}.pagoEm`,
          message: 'O pagamento não pode estar no futuro',
        })
      }
    })

    if (problemas.length) throw erroDeValidacao(problemas)
  }

  /**
   * Mesmo fornecedor e mesmo código de identificação, ou mesmo fornecedor e
   * mesmo valor com até 7 dias de diferença. Sem fornecedor, compara com os
   * outros lançamentos sem fornecedor. Recorrência mensal (a mesma assinatura
   * todo mês) fica de fora do aviso de propósito.
   */
  private possiveisDuplicados(entrada: LancamentoInput): Promise<PossivelDuplicado[]> {
    const mesmoCodigo = entrada.codigoIdentificacao
      ? sql`lower(${lancamentos.codigoIdentificacao}) = lower(${entrada.codigoIdentificacao})`
      : undefined
    const mesmoValorPerto = and(
      eq(lancamentos.valorCentavos, entrada.valorCentavos),
      between(
        lancamentos.dataGasto,
        somarDias(entrada.dataGasto, -7),
        somarDias(entrada.dataGasto, 7),
      ),
    )

    return this.db
      .select({
        id: lancamentos.id,
        descricao: lancamentos.descricao,
        valorCentavos: lancamentos.valorCentavos,
        dataGasto: lancamentos.dataGasto,
        codigoIdentificacao: lancamentos.codigoIdentificacao,
      })
      .from(lancamentos)
      .where(
        and(
          // Só do mesmo setor: o aviso devolve descrição, valor e código, e de outro
          // setor a pessoa nem pode ver o lançamento.
          eq(lancamentos.setorId, entrada.setorId),
          entrada.fornecedorId === null
            ? isNull(lancamentos.fornecedorId)
            : eq(lancamentos.fornecedorId, entrada.fornecedorId),
          eq(lancamentos.situacao, 'ativo'),
          or(mesmoCodigo, mesmoValorPerto),
        ),
      )
      .orderBy(desc(lancamentos.dataGasto))
      .limit(5)
  }

  private async carregarAtual(id: number): Promise<Atual | undefined> {
    const [linha] = await this.db
      .select({
        id: lancamentos.id,
        setorId: lancamentos.setorId,
        descricao: lancamentos.descricao,
        valorCentavos: lancamentos.valorCentavos,
        dataGasto: lancamentos.dataGasto,
        categoriaId: lancamentos.categoriaId,
        formaPagamentoId: lancamentos.formaPagamentoId,
        empreendimentoId: lancamentos.empreendimentoId,
        fornecedorId: lancamentos.fornecedorId,
        campanhaId: lancamentos.campanhaId,
        cartaoId: lancamentos.cartaoId,
        codigoIdentificacao: lancamentos.codigoIdentificacao,
        observacao: lancamentos.observacao,
        situacao: lancamentos.situacao,
        atualizadoEm: lancamentos.atualizadoEm,
        siengeTituloId: lancamentos.siengeTituloId,
      })
      .from(lancamentos)
      .where(eq(lancamentos.id, id))
    if (!linha) return undefined

    const lista = await this.db
      .select({
        valorCentavos: parcelas.valorCentavos,
        vencimento: parcelas.vencimento,
        pagoEm: parcelas.pagoEm,
      })
      .from(parcelas)
      .where(eq(parcelas.lancamentoId, id))
      .orderBy(asc(parcelas.numero))

    return { ...linha, parcelas: lista }
  }

  private async alteracoes(atual: Atual, entrada: LancamentoInput): Promise<Alteracao[]> {
    const lista: Alteracao[] = []

    for (const { campo, rotulo } of SIMPLES) {
      if (atual[campo] !== entrada[campo]) {
        lista.push({ campo, rotulo, de: atual[campo], para: entrada[campo] })
      }
    }

    for (const { campo, rotulo, tabela } of REFERENCIAS) {
      const de = atual[campo] as number | null
      const para = entrada[campo] as number | null
      if (de !== para) {
        const [nomeDe, nomePara] = await Promise.all([
          this.nomeDe(tabela, de),
          this.nomeDe(tabela, para),
        ])
        lista.push({ campo, rotulo, de: nomeDe, para: nomePara })
      }
    }

    if (chaveParcelas(atual.parcelas) !== chaveParcelas(entrada.parcelas)) {
      lista.push({
        campo: 'parcelas',
        rotulo: 'Parcelas',
        de: atual.parcelas,
        para: entrada.parcelas,
      })
    }

    return lista
  }

  private async nomeDe(tabela: PgTable, id: number | null): Promise<string | null> {
    if (id === null) return null
    const { rows } = await this.db.execute<{ nome: string }>(
      sql`select nome from ${tabela} where id = ${id}`,
    )
    return rows[0]?.nome ?? null
  }
}
