/*
  Cliente da API REST do Sienge (v1), só leitura.

  - Autenticação Basic, com o usuário de API do Painel de Integrações.
  - O limite do Sienge é de 200 requisições por minuto para o subdomínio
    inteiro, dividido com o Painel Sienge. O freio abaixo segura este sistema
    no teto configurado, numa janela deslizante de 60 s, e espera o prazo que a
    API indicar quando ela mesmo assim devolver 429.
  - Listagem pagina por `limit`/`offset` (no máximo 200) dentro do envelope
    `resultSetMetadata`; algumas devolvem array puro. Filtro sem resultado
    volta 404, que numa listagem quer dizer lista vazia.
*/

/** Token de injeção: `null` quando o servidor não tem as credenciais do Sienge. */
export const SIENGE = Symbol('SIENGE')

export class ErroSienge extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly caminho: string,
  ) {
    super(message)
    this.name = 'ErroSienge'
  }
}

export interface OpcoesSienge {
  subdominio: string
  usuario: string
  senha: string
  porMinuto: number
  /** Trocados nos testes. */
  fetch?: typeof fetch
  esperar?: (ms: number) => Promise<void>
}

type Parametros = Record<string, string | number | undefined>

/**
 * Contador de requisições de uma operação (uma busca do quadro, uma
 * conferência). O cliente é um só para o processo inteiro; o contador dele
 * soma tudo, e este separa quem gastou o quê.
 */
export interface Conta {
  requisicoes: number
}

interface Pagina<T> {
  resultSetMetadata?: { count?: number }
  results?: T[]
}

/** Tentativas além da primeira para 429, 502–504 e falha de rede. */
const NOVAS_TENTATIVAS = 3

export class SiengeCliente {
  private readonly base: string
  private readonly autorizacao: string
  private readonly fetch: typeof fetch
  private readonly esperar: (ms: number) => Promise<void>
  private janela: number[] = []
  /** Requisições feitas desde que o processo subiu (vai para o log de cada busca). */
  requisicoes = 0

  constructor(private readonly opcoes: OpcoesSienge) {
    this.base = `https://api.sienge.com.br/${encodeURIComponent(opcoes.subdominio)}/public/api/v1`
    this.autorizacao = `Basic ${Buffer.from(`${opcoes.usuario}:${opcoes.senha}`).toString('base64')}`
    this.fetch = opcoes.fetch ?? fetch
    this.esperar = opcoes.esperar ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)))
  }

  /** Espera a vez dentro do teto por minuto. */
  private async vez(): Promise<void> {
    for (;;) {
      const agora = Date.now()
      this.janela = this.janela.filter((t) => agora - t < 60_000)
      if (this.janela.length < this.opcoes.porMinuto) {
        this.janela.push(agora)
        return
      }
      await this.esperar(60_000 - (agora - this.janela[0]!) + 50)
    }
  }

  /** GET com freio e novas tentativas. Devolve `null` quando o status está em `tolerar`. */
  async get<T>(
    caminho: string,
    parametros: Parametros = {},
    tolerar: number[] = [],
    conta?: Conta,
  ): Promise<T | null> {
    const url = new URL(this.base + caminho)
    for (const [nome, valor] of Object.entries(parametros)) {
      if (valor !== undefined) url.searchParams.set(nome, String(valor))
    }

    for (let tentativa = 0; ; tentativa++) {
      await this.vez()
      this.requisicoes++
      if (conta) conta.requisicoes++

      let resposta: Response
      try {
        resposta = await this.fetch(url, {
          headers: { authorization: this.autorizacao, accept: 'application/json' },
          signal: AbortSignal.timeout(60_000),
        })
      } catch (erro) {
        if (tentativa < NOVAS_TENTATIVAS) {
          await this.esperar((tentativa + 1) * 2000)
          continue
        }
        throw new ErroSienge(`Sem resposta do Sienge (${(erro as Error).message})`, 0, caminho)
      }

      if (resposta.ok) {
        // O corpo também pode cortar no meio ou não ser JSON (página de manutenção):
        // conta como falha de rede, com as mesmas novas tentativas.
        try {
          return (await resposta.json()) as T
        } catch (erro) {
          if (tentativa < NOVAS_TENTATIVAS) {
            await this.esperar((tentativa + 1) * 2000)
            continue
          }
          throw new ErroSienge(
            `Resposta inválida do Sienge (${(erro as Error).message})`,
            0,
            caminho,
          )
        }
      }
      if (tolerar.includes(resposta.status)) return null

      if (resposta.status === 429 && tentativa < NOVAS_TENTATIVAS) {
        // Estourou mesmo com o freio (o Painel Sienge divide o limite): espera a janela renovar.
        const reset = Number(resposta.headers.get('ratelimit-reset'))
        this.janela = []
        await this.esperar((Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000 + 1000)
        continue
      }
      if ([502, 503, 504].includes(resposta.status) && tentativa < NOVAS_TENTATIVAS) {
        await this.esperar((tentativa + 1) * 2000)
        continue
      }

      const corpo = (await resposta.json().catch(() => null)) as {
        clientMessage?: string
        developerMessage?: string
      } | null
      throw new ErroSienge(
        corpo?.clientMessage || corpo?.developerMessage || `O Sienge respondeu ${resposta.status}`,
        resposta.status,
        caminho,
      )
    }
  }

  /** Todas as páginas de uma listagem (404 = nenhum resultado). */
  async listar<T>(caminho: string, parametros: Parametros = {}, conta?: Conta): Promise<T[]> {
    const todos: T[] = []
    for (let offset = 0; ;) {
      const pagina = await this.get<Pagina<T> | T[]>(
        caminho,
        { ...parametros, limit: 200, offset },
        [404],
        conta,
      )
      if (!pagina) break
      if (Array.isArray(pagina)) {
        todos.push(...pagina)
        break
      }
      const linhas = pagina.results ?? []
      todos.push(...linhas)
      offset += linhas.length
      if (!linhas.length || offset >= (pagina.resultSetMetadata?.count ?? 0)) break
    }
    return todos
  }
}
