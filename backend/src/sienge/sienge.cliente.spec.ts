import { ErroSienge, SiengeCliente } from './sienge.cliente.js'

/** Resposta falsa do Sienge: status, corpo JSON e cabeçalhos. */
const resposta = (status: number, corpo: unknown = {}, cabecalhos: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json', ...cabecalhos },
  })

/** Cliente com fetch roteirizado: cada chamada consome a próxima resposta da lista. */
function clienteCom(respostas: Response[], porMinuto = 1000) {
  const chamadas: URL[] = []
  const esperas: number[] = []
  const cliente = new SiengeCliente({
    subdominio: 'empresa',
    usuario: 'api',
    senha: 'segredo',
    porMinuto,
    fetch: (async (url: URL) => {
      chamadas.push(new URL(url))
      const proxima = respostas.shift()
      if (!proxima) throw new Error('chamada a mais')
      return proxima
    }) as typeof fetch,
    esperar: async (ms) => {
      esperas.push(ms)
    },
  })
  return { cliente, chamadas, esperas }
}

describe('SiengeCliente.listar', () => {
  it('percorre as páginas até o total do envelope', async () => {
    const pagina = (ids: number[], count: number) =>
      resposta(200, {
        resultSetMetadata: { count, offset: 0, limit: 200 },
        results: ids.map((id) => ({ id })),
      })
    const primeira = Array.from({ length: 200 }, (_, i) => i + 1)
    const { cliente, chamadas } = clienteCom([pagina(primeira, 203), pagina([201, 202, 203], 203)])

    const itens = await cliente.listar<{ id: number }>('/bills', {
      startDate: '2026-08-01',
      costCenterId: 7,
    })

    expect(itens).toHaveLength(203)
    expect(chamadas).toHaveLength(2)
    expect(chamadas[0]!.pathname).toBe('/empresa/public/api/v1/bills')
    expect(chamadas[0]!.searchParams.get('costCenterId')).toBe('7')
    expect(chamadas[1]!.searchParams.get('offset')).toBe('200')
    expect(chamadas[1]!.searchParams.get('limit')).toBe('200')
  })

  it('trata 404 como lista vazia e aceita array puro', async () => {
    const { cliente } = clienteCom([
      resposta(404, { status: 404 }),
      resposta(200, [{ id: 1 }, { id: 2 }]),
    ])
    expect(await cliente.listar('/bills')).toEqual([])
    expect(await cliente.listar('/cost-centers')).toEqual([{ id: 1 }, { id: 2 }])
  })
})

describe('SiengeCliente.get', () => {
  it('manda a credencial em Basic e não repete a senha na URL', async () => {
    let autorizacao = ''
    const cliente = new SiengeCliente({
      subdominio: 'empresa',
      usuario: 'api',
      senha: 'segredo',
      porMinuto: 10,
      fetch: (async (url: URL, init?: RequestInit) => {
        autorizacao = new Headers(init?.headers).get('authorization') ?? ''
        expect(String(url)).not.toContain('segredo')
        return resposta(200, { ok: true })
      }) as typeof fetch,
    })
    await cliente.get('/cost-centers')
    expect(autorizacao).toBe(`Basic ${Buffer.from('api:segredo').toString('base64')}`)
  })

  it('no 429 espera o prazo que a API indicar e tenta de novo', async () => {
    const { cliente, esperas } = clienteCom([
      resposta(429, {}, { 'ratelimit-reset': '12' }),
      resposta(200, { ok: true }),
    ])
    expect(await cliente.get('/bills')).toEqual({ ok: true })
    expect(esperas).toEqual([13_000])
  })

  it('depois das novas tentativas, falha com a mensagem do Sienge', async () => {
    const { cliente } = clienteCom([
      resposta(403, { clientMessage: 'Sem permissão para o recurso' }),
    ])
    const erro = await cliente.get('/bills').catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroSienge)
    expect(erro).toMatchObject({
      status: 403,
      message: 'Sem permissão para o recurso',
      caminho: '/bills',
    })
  })

  it('resposta 200 que não é JSON é tentada de novo e, se persistir, vira ErroSienge', async () => {
    const html = () => new Response('<html>manutenção</html>', { status: 200 })
    const { cliente, esperas } = clienteCom([html(), resposta(200, { ok: true })])
    expect(await cliente.get('/bills')).toEqual({ ok: true })
    expect(esperas).toHaveLength(1)

    const sempre = clienteCom([html(), html(), html(), html()])
    const erro = await sempre.cliente.get('/bills').catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroSienge)
    expect((erro as ErroSienge).message).toMatch(/Resposta inválida/)
  })

  it('a conta da operação soma só as requisições dela', async () => {
    const { cliente } = clienteCom([resposta(200, {}), resposta(200, {}), resposta(200, {})])
    const conta = { requisicoes: 0 }
    await cliente.get('/a', {}, [], conta)
    await cliente.get('/b')
    await cliente.get('/c', {}, [], conta)
    expect(conta.requisicoes).toBe(2)
    expect(cliente.requisicoes).toBe(3)
  })

  it('segura o ritmo no teto por minuto', async () => {
    // Relógio parado: só anda quando o cliente "espera".
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const esperas: number[] = []
      const cliente = new SiengeCliente({
        subdominio: 'empresa',
        usuario: 'api',
        senha: 'segredo',
        porMinuto: 2,
        fetch: (async () => resposta(200, {})) as unknown as typeof fetch,
        esperar: async (ms) => {
          esperas.push(ms)
          vi.setSystemTime(Date.now() + ms)
        },
      })
      await cliente.get('/a')
      await cliente.get('/b')
      expect(esperas).toEqual([])
      // A terceira passaria do teto de 2 por minuto: espera a janela de 60 s abrir.
      await cliente.get('/c')
      expect(esperas).toHaveLength(1)
      expect(esperas[0]).toBeGreaterThanOrEqual(60_000)
      expect(cliente.requisicoes).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
