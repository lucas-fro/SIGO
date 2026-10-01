import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import type { ContextoLeitura } from './leitor.js'
import { ErroLeitura } from './leitor.js'
import { LeitorClaude, type ClienteMensagens } from './leitor-claude.js'
import { IMAGEM_LADO_MAXIMO, prepararImagem } from './instrucoes-leitura.js'

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

/** Mensagem da API como o SDK entrega (só o que o leitor lê). */
const mensagem = (texto: string, extra: Record<string, unknown> = {}) =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'x' },
      { type: 'text', text: texto },
    ],
    stop_reason: 'end_turn',
    stop_details: null,
    usage: { input_tokens: 3200, output_tokens: 410 },
    ...extra,
  }) as unknown as Anthropic.Beta.BetaMessage

function falso(...respostas: Array<Anthropic.Beta.BetaMessage | Error>) {
  const pedidos: Array<Record<string, unknown>> = []
  const cliente = {
    beta: {
      messages: {
        create: async (pedido: Record<string, unknown>) => {
          pedidos.push(pedido)
          const r = respostas.shift()
          if (!r) throw new Error('chamada a mais')
          if (r instanceof Error) throw r
          return r
        },
      },
    },
  } as unknown as ClienteMensagens
  return {
    leitor: new LeitorClaude({ chave: 'sk-teste', modelo: 'claude-sonnet-5-5' }, cliente),
    pedidos,
  }
}

const PDF = Buffer.from('%PDF-1.4 teste')

describe('LeitorClaude', () => {
  it('manda o arquivo antes das listas, com esquema, esforço baixo e fallback', async () => {
    const { leitor, pedidos } = falso(mensagem(JSON.stringify(RESPOSTA_OK)))
    await leitor.ler(PDF, 'application/pdf', CONTEXTO)

    const p = pedidos[0] as {
      model: string
      betas: string[]
      fallbacks: string
      output_config: { effort: string; format: { type: string; schema: { required: string[] } } }
      messages: Array<{
        content: Array<{
          type: string
          text?: string
          source?: { media_type: string; data: string }
        }>
      }>
    }
    expect(p.model).toBe('claude-sonnet-5-5')
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(p.fallbacks).toBe('default')
    expect(p.output_config.effort).toBe('low')
    expect(p.output_config.format.type).toBe('json_schema')
    expect(p.output_config.format.schema.required).toContain('valorCentavos')
    const [arquivo, texto] = p.messages[0]!.content
    expect(arquivo!.type).toBe('document')
    expect(arquivo!.source!.data).toBe(PDF.toString('base64'))
    expect(texto!.type).toBe('text')
    expect(texto!.text).toContain('1: Mídia digital — Meta Ads, Google Ads')
    expect(texto!.text).toContain('7: Lumine Residence')
    expect(texto!.text).toContain('Hoje é 2026-09-29.')
  })

  it('foto pequena vai como imagem, do jeito que veio', async () => {
    const foto = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer()
    const { leitor, pedidos } = falso(mensagem(JSON.stringify(RESPOSTA_OK)))
    await leitor.ler(foto, 'image/jpeg', CONTEXTO)
    const bloco = (
      pedidos[0] as {
        messages: Array<{
          content: Array<{ type: string; source: { media_type: string; data: string } }>
        }>
      }
    ).messages[0]!.content[0]!
    expect(bloco.type).toBe('image')
    expect(bloco.source.media_type).toBe('image/jpeg')
    expect(bloco.source.data).toBe(foto.toString('base64'))
  })

  it('foto grande de celular é reduzida para o limite da API', async () => {
    const grande = await sharp({
      create: { width: 8000, height: 6000, channels: 3, background: '#e8e8e8' },
    })
      .png()
      .toBuffer()
    const r = await prepararImagem(grande, 'image/png')
    const { width, height } = await sharp(r.data).metadata()
    expect(r.tipo).toBe('image/jpeg')
    expect(Math.max(width!, height!)).toBe(IMAGEM_LADO_MAXIMO)
  })

  it('imagem que não abre vira ErroLeitura, sem chamar a API', async () => {
    const { leitor, pedidos } = falso(mensagem(JSON.stringify(RESPOSTA_OK)))
    await expect(
      leitor.ler(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg', CONTEXTO),
    ).rejects.toBeInstanceOf(ErroLeitura)
    expect(pedidos).toHaveLength(0)
  })

  it('converte a resposta: texto vazio vira null, e devolve modelo e tokens', async () => {
    const { leitor } = falso(
      mensagem(JSON.stringify({ ...RESPOSTA_OK, codigo: '', observacao: '  ' })),
    )
    const r = await leitor.ler(PDF, 'application/pdf', CONTEXTO)
    expect(r.extraido.codigo).toBeNull()
    expect(r.extraido.observacao).toBeNull()
    expect(r.extraido.fornecedor).toEqual({
      nome: 'DLOCAL BRASIL',
      documento: '11.222.333/0001-81',
    })
    expect(r.extraido.valorCentavos).toBe(250000)
    expect(r).toMatchObject({ modelo: 'claude-sonnet-5-5', tokensEntrada: 3200, tokensSaida: 410 })
  })

  it('sem fornecedor no documento, fornecedor é null', async () => {
    const { leitor } = falso(
      mensagem(JSON.stringify({ ...RESPOSTA_OK, nomeFornecedor: '', documentoFornecedor: '' })),
    )
    expect((await leitor.ler(PDF, 'application/pdf', CONTEXTO)).extraido.fornecedor).toBeNull()
  })

  it('se o fallback for recusado pela API, tenta de novo sem ele', async () => {
    // Corpo como a API manda: o SDK monta a mensagem do erro a partir dele.
    const corpo = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'fallbacks: not supported for this model' },
    }
    const recusa = new Anthropic.BadRequestError(400, corpo, undefined, new Headers())
    const { leitor, pedidos } = falso(recusa, mensagem(JSON.stringify(RESPOSTA_OK)))
    await leitor.ler(PDF, 'application/pdf', CONTEXTO)
    expect(pedidos).toHaveLength(2)
    expect(pedidos[1]).not.toHaveProperty('fallbacks')
    expect(pedidos[1]).not.toHaveProperty('betas')
  })

  it('recusa, resposta cortada e JSON inválido viram ErroLeitura com mensagem para a tela', async () => {
    const recusado = falso(
      mensagem('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null } }),
    )
    await expect(recusado.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(/recusou/)

    const cortado = falso(mensagem('{"tipo', { stop_reason: 'max_tokens' }))
    await expect(cortado.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(
      /grande demais/,
    )

    const invalido = falso(mensagem('{"tipoDocumento":"extrato"}'))
    const erro = await invalido.leitor
      .ler(PDF, 'application/pdf', CONTEXTO)
      .catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroLeitura)
    expect((erro as ErroLeitura).message).toMatch(/inválido/)
  })

  it('chave recusada e limite de uso viram mensagens claras', async () => {
    const semChave = falso(
      new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers()),
    )
    await expect(semChave.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(/chave/)

    const limite = falso(new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers()))
    await expect(limite.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(
      /limite de uso/,
    )

    // Sem crédito a Anthropic responde 400: não pode virar "arquivo protegido ou grande demais".
    const semCredito = falso(
      new Anthropic.BadRequestError(
        400,
        {
          type: 'error',
          error: { message: 'Your credit balance is too low to access the Anthropic API.' },
        },
        'Your credit balance is too low to access the Anthropic API.',
        new Headers(),
      ),
    )
    await expect(semCredito.leitor.ler(PDF, 'application/pdf', CONTEXTO)).rejects.toThrow(
      /sem crédito/,
    )
  })
})
