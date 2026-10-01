import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { criarLeitor } from '../anexos/leitores.js'
import { ErroLeitura, type Leitor } from '../anexos/leitor.js'
import { erroDeValidacao } from '../common/validacao.js'
import { chaveDoCofre, cifrar, decifrar } from '../config/cofre.js'
import { env } from '../config/env.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import {
  PROVEDORES_IA,
  ROTULO_PROVEDOR_IA,
  type ConfiguracaoLeituraIa,
  type ProvedorIa,
  type SalvarLeituraIa,
} from '../contracts/configuracoes.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import { configuracoes, usuarios } from '../db/schema.js'

const CHAVE = 'leitura_ia'

/** Como a linha `leitura_ia` fica guardada. A chave, só cifrada. */
interface ValorLeituraIa {
  provedor: ProvedorIa
  modelo: string
  chaveCifrada: string
  chaveFinal: string
}

function ehValor(v: unknown): v is ValorLeituraIa {
  const x = v as Partial<ValorLeituraIa> | null
  return (
    !!x &&
    (PROVEDORES_IA as readonly string[]).includes(x.provedor ?? '') &&
    typeof x.modelo === 'string' &&
    typeof x.chaveCifrada === 'string' &&
    typeof x.chaveFinal === 'string'
  )
}

/** A configuração é lida de novo depois deste prazo (ou na hora, quando salva aqui). */
const VALIDADE_CACHE_MS = 60_000

/**
 * Configuração da leitura de comprovante por IA, feita pelo administrador na
 * tela de Cadastros: a API, o modelo e a chave. Quem lê comprovante pede o
 * leitor aqui; sem configuração, a leitura fica desligada e o comprovante
 * continua sendo anexado.
 */
@Injectable()
export class LeituraIaService {
  private readonly log = new Logger('LeituraIA')
  private readonly cofre = chaveDoCofre(env.AUTH_SECRET ?? env.ADMIN_PASSWORD)
  private cache: { leitor: Promise<Leitor | null>; em: number } | null = null

  constructor(@Inject(DB) private readonly db: Database) {}

  /** O leitor configurado, ou `null` com a leitura desligada. */
  leitor(): Promise<Leitor | null> {
    if (!this.cache || Date.now() - this.cache.em > VALIDADE_CACHE_MS) {
      const leitor = this.montar().catch((erro: Error) => {
        this.log.error(`não deu para carregar a configuração da leitura: ${erro.message}`)
        this.cache = null
        return null
      })
      this.cache = { leitor, em: Date.now() }
    }
    return this.cache.leitor
  }

  async disponivel(): Promise<boolean> {
    return (await this.leitor()) !== null
  }

  private async guardado(): Promise<{
    valor: ValorLeituraIa | null
    atualizadoEm: Date
    porId: number | null
    porNome: string | null
  } | null> {
    const [linha] = await this.db
      .select({
        valor: configuracoes.valor,
        atualizadoEm: configuracoes.atualizadoEm,
        porId: usuarios.id,
        porNome: usuarios.nome,
      })
      .from(configuracoes)
      .leftJoin(usuarios, eq(usuarios.id, configuracoes.atualizadoPor))
      .where(eq(configuracoes.chave, CHAVE))
    if (!linha) return null
    return { ...linha, valor: ehValor(linha.valor) ? linha.valor : null }
  }

  private async montar(): Promise<Leitor | null> {
    const g = await this.guardado()
    if (!g?.valor) return null
    const chave = decifrar(g.valor.chaveCifrada, this.cofre)
    if (!chave) {
      this.log.warn(
        'a chave da leitura por IA não abre com o segredo atual do servidor; cadastre de novo em Cadastros',
      )
      return null
    }
    return criarLeitor(g.valor.provedor, chave, g.valor.modelo)
  }

  async obter(): Promise<ConfiguracaoLeituraIa> {
    const g = await this.guardado()
    const v = g?.valor ?? null
    const ilegivel = !!v && decifrar(v.chaveCifrada, this.cofre) === null
    return {
      ligada: !!v && !ilegivel,
      provedor: v?.provedor ?? null,
      modelo: v?.modelo ?? null,
      chaveFinal: v?.chaveFinal ?? null,
      chaveIlegivel: ilegivel,
      atualizadoEm: g?.atualizadoEm.toISOString() ?? null,
      atualizadoPor: g?.porId && g.porNome ? { id: g.porId, nome: g.porNome } : null,
    }
  }

  /**
   * Confere chave e modelo na própria API antes de guardar: chave errada não
   * chega a ser salva. Sem chave nova, usa a guardada (se for da mesma API).
   */
  async salvar(usuario: UsuarioSessao, dados: SalvarLeituraIa): Promise<ConfiguracaoLeituraIa> {
    const atual = (await this.guardado())?.valor ?? null
    const chave =
      dados.chave ??
      (atual && atual.provedor === dados.provedor ? decifrar(atual.chaveCifrada, this.cofre) : null)
    if (!chave) {
      throw erroDeValidacao([
        { path: 'chave', message: `Cole a chave da API da ${ROTULO_PROVEDOR_IA[dados.provedor]}` },
      ])
    }

    try {
      await criarLeitor(dados.provedor, chave, dados.modelo).conferir()
    } catch (erro) {
      const e = erro as Error
      this.log.warn(
        `chave ou modelo recusados ao salvar: ${e instanceof ErroLeitura ? (e.detalhe ?? e.message) : e.message}`,
      )
      throw new BadRequestException(
        e instanceof ErroLeitura
          ? e.message
          : 'Não deu para conferir a chave agora; tente de novo.',
      )
    }

    const valor: ValorLeituraIa = {
      provedor: dados.provedor,
      modelo: dados.modelo,
      chaveCifrada: cifrar(chave, this.cofre),
      chaveFinal: chave.slice(-4),
    }
    const mudanca = { valor: { ...valor }, atualizadoEm: new Date(), atualizadoPor: usuario.id }
    await this.db
      .insert(configuracoes)
      .values({ chave: CHAVE, ...mudanca })
      .onConflictDoUpdate({ target: configuracoes.chave, set: mudanca })
    this.cache = null
    this.log.log(
      `leitura por IA configurada por ${usuario.email}: ${dados.provedor}, ${dados.modelo}${dados.chave ? ', chave nova' : ''}`,
    )
    return this.obter()
  }

  /** Desliga a leitura e descarta a chave. */
  async remover(usuario: UsuarioSessao): Promise<ConfiguracaoLeituraIa> {
    await this.db.delete(configuracoes).where(eq(configuracoes.chave, CHAVE))
    this.cache = null
    this.log.log(`leitura por IA desligada por ${usuario.email}`)
    return this.obter()
  }
}
