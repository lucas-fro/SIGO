import OpenAI from 'openai'
import sharp from 'sharp'
import { ErroLeitura, type ContextoLeitura } from './leitor.js'
import { LeitorOpenAI, type ClienteRespostas } from './leitor-openai.js'

const CONTEXTO: ContextoLeitura = {
  hoje: '2026-09-29',
  categorias: [{ id: 1, nome: 'Mídia digital', descricao: 'Meta Ads, Google Ads' }],
  empreendimentos: [{ id: 7, nome: 'Lumine Residence' }],
  formasPagamento: [{ id: 2, nome: 'Boleto', cartao: false }],
}

const RESPOSTA_OK = {
  tipoDocumento: 'boleto',
  descricao: 'Anúncios Meta Ads de setembro, via dLocal',
  valorCentavos: 250000,
  dataDocumento: '2026-09-20',
  nomeFornecedor: 'DLOCAL BRASIL',
  documentoFornecedor: '11.222.333/0001-81',
  codigo: '3748857064482062',
  parcelas: [{ vencimento: '2026-10-05', valorCentavos: 250000 }],
  pagoEm: null,
  formaPagamentoId: 2,
  categoriaId: 1,
  empreendimentoId: null,
  observacao: '',
  avisos: [],
}

/** Resposta da API como o SDK entrega (só o que o leitor lê). */
const resposta = (texto: string, extra: Record<string, unknown> = {}) =>
  ({
    id: 'resp_1',
    object: 'response',
    model: 'gpt-5.4-mini-2026-03-17',
    status: 'completed',
    incomplete_details: null,
    error: null,
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: texto }] },
    ],
    output_text: texto,
    usage: { input_tokens: 2900, output_tokens: 380 },
    ...extra,
  }) as unknown as OpenAI.Responses.Response

function falso(...respostas: Array<OpenAI.Responses.Response | Error>) {
  const pedidos: Array<Record<string, unknown>> = []
  const modelos: string[] = []
  const cliente: ClienteRespostas = {
    responses: {
      create: async (pedido) => {
        pedidos.push(pedido as unknown as Record<string, unknown>)
        const r = respostas.shift()
        if (!r) throw new Error('chamada a mais')
        if (r instanceof Error) throw r
        return r
      },
    },
    models: {
      retrieve: async (modelo) => {
        modelos.push(modelo)
        const r = respostas.shift()
        if (r instanceof Error) throw r
        return { id: modelo }
      },
    },
  }
  return {
    leitor: new LeitorOpenAI({ chave: 'sk-teste', modelo: 'gpt-5.4-mini' }, cliente),
    pedidos,
    modelos,
  }
}

const PDF = Buffer.from('%PDF-1.4 teste')

describe('LeitorOpenAI', () => {
  it('manda o PDF antes das listas, com esquema estrito, raciocínio baixo e sem guardar', async () => {
    const { leitor, pedidos } = falso(resposta(JSON.stringify(RESPOSTA_OK)))
    const r = await leitor.ler(PDF, 'application/pdf', CONTEXTO)

    const p = pedidos[0] as {
      model: string
      store: boolean
      instructions: string
      reasoning: { effort: string }
      text: { format: { type: string; strict: boolean; schema: { required: string[] } } }
      input: Array<{
        content: Array<{ type: string; text?: string; file_data?: string; filename?: string }>
      }>
    }
    expect(p.model).toBe('gpt-5.4-mini')
    expect(p.store).toBe(false)
    expect(p.reasoning.effort).toBe('low')
    expect(p.instructions).toContain('BENEFICIÁRIO')
    expect(p.text.format.type).toBe('json_schema')
    expect(p.text.format.strict).toBe(true)
    expect(p.text.format.schema.required).toContain('valorCentavos')
    const [arquivo, texto] = p.input[0]!.content
    expect(arquivo!.type).toBe('input_file')
    expect(arquivo!.file_data).toBe(`data:application/pdf;base64,${PDF.toString('base64')}`)
    expect(texto!.type).toBe('input_text')
    expect(texto!.text).toContain('7: Lumine Residence')

    expect(r.modelo).toBe('gpt-5.4-mini-2026-03-17')
    expect(r.tokensEntrada).toBe(2900)
    expect(r.extraido.fornecedor).toEqual({
      nome: 'DLOCAL BRASIL',
      documento: '11.222.333/0001-81',
    })
    expect(r.extraido.observacao).toBeNull()
  })

  it('imagem vai como data URL', async () => {
    const foto = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer()
    const { leitor, pedidos } = falso(resposta(JSON.stringify(RESPOSTA_OK)))
    await leitor.ler(foto, 'image/png', CONTEXTO)
    const arquivo = (
      pedidos[0] as { input: Array<{ content: Array<{ type: string; image_url: string }> }> }
    ).input[0]!.content[0]!
    expect(arquivo.type).toBe('input_image')
    expect(arquivo.image_url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('modelo sem raciocínio: tenta de novo sem o parâmetro', async () => {
    const { leitor, pedidos } = falso(
      new OpenAI.BadRequestError(
        400,
        { message: "Unsupported parameter: 'reasoning.effort'" },
        "Unsupported parameter: 'reasoning.effort'",
        new Headers(),
      ),
      resposta(JSON.stringify(RESPOSTA_OK)),
    )
    await leitor.ler(PDF, 'application/pdf', CONTEXTO)
    expect(pedidos).toHaveLength(2)
    expect(pedidos[1]!.reasoning).toBeUndefined()
  })

  it('recusa, resposta cortada e JSON inválido viram ErroLeitura', async () => {
    const recusado = falso(
      resposta('', {
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'não' }] },
        ],
      }),
    )
    await expect(recusado.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(/recusou/)

    const cortado = falso(
      resposta('{"tipo', {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
    )
    await expect(cortado.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(
      /grande demais/,
    )

    const invalido = falso(resposta('{"tipoDocumento":"extrato"}'))
    const erro = await invalido.leitor
      .ler(PDF, 'application/pdf', CONTEXTO)
      .catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroLeitura)
  })

  it('chave recusada, sem crédito e limite de uso viram mensagens claras', async () => {
    const semChave = falso(
      new OpenAI.AuthenticationError(401, {}, 'Incorrect API key', new Headers()),
    )
    await expect(semChave.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(/chave/)

    const semCredito = falso(
      new OpenAI.RateLimitError(
        429,
        { message: 'You exceeded your current quota', code: 'insufficient_quota' },
        undefined,
        new Headers(),
      ),
    )
    await expect(semCredito.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(
      /sem crédito/,
    )
    // A mensagem que a OpenAI manda hoje para conta zerada (sem o código insufficient_quota).
    const zerada = falso(
      new OpenAI.RateLimitError(
        429,
        undefined,
        'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
        new Headers(),
      ),
    )
    await expect(zerada.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(/sem crédito/)

    const limite = falso(new OpenAI.RateLimitError(429, {}, 'Rate limit reached', new Headers()))
    await expect(limite.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(
      /limite de uso/,
    )
  })

  it('conferir: modelo inexistente e chave recusada dizem o que fazer', async () => {
    const ok = falso()
    await ok.leitor.conferir()
    expect(ok.modelos).toEqual(['gpt-5.4-mini'])

    const semModelo = falso(new OpenAI.NotFoundError(404, {}, 'model not found', new Headers()))
    await expect(semModelo.leitor.conferir()).rejects.toThrow(/não existe/)

    const semChave = falso(new OpenAI.AuthenticationError(401, {}, 'bad key', new Headers()))
    await expect(semChave.leitor.conferir()).rejects.toThrow(/recusou esta chave/)
  })
})
