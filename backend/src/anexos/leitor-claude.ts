import Anthropic from '@anthropic-ai/sdk'
import type { TipoAnexo } from '../contracts/anexos.js'
import {
  interpretarResposta,
  listas,
  ESQUEMA,
  prepararImagem,
  SISTEMA,
} from './instrucoes-leitura.js'
import { ErroLeitura, type ContextoLeitura, type Leitor, type ResultadoLeitor } from './leitor.js'

/*
  Leitura de boleto, nota e recibo com o Claude (API da Anthropic).

  Uma chamada só: o arquivo (PDF ou imagem) vai antes do texto com as listas
  do SIGO, e a resposta vem num JSON imposto por esquema (structured outputs).
  Instruções, esquema e conferência da resposta: instrucoes-leitura.ts.
*/

async function blocoArquivo(
  conteudo: Buffer,
  tipo: TipoAnexo,
): Promise<Anthropic.Beta.BetaContentBlockParam> {
  if (tipo === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: conteudo.toString('base64') },
    }
  }
  const imagem = await prepararImagem(conteudo, tipo)
  return {
    type: 'image',
    source: { type: 'base64', media_type: imagem.tipo, data: imagem.data.toString('base64') },
  }
}

/** Parte do cliente que o leitor usa: permite trocar por um falso nos testes. */
export interface ClienteMensagens {
  beta: { messages: { create: Anthropic['beta']['messages']['create'] } }
  models: { retrieve: (modelo: string) => Promise<unknown> }
}

export class LeitorClaude implements Leitor {
  private readonly cliente: ClienteMensagens

  constructor(
    private readonly opcoes: { chave: string; modelo: string },
    cliente?: ClienteMensagens,
  ) {
    // Tela interativa: 90 s por tentativa e 2 novas tentativas (429, 5xx, conexão) já no SDK.
    this.cliente =
      cliente ?? new Anthropic({ apiKey: opcoes.chave, timeout: 90_000, maxRetries: 2 })
  }

  async conferir(): Promise<void> {
    try {
      await this.cliente.models.retrieve(this.opcoes.modelo)
    } catch (erro) {
      throw paraErroConferencia(erro, this.opcoes.modelo)
    }
  }

  async ler(
    conteudo: Buffer,
    tipo: TipoAnexo,
    contexto: ContextoLeitura,
  ): Promise<ResultadoLeitor> {
    let arquivo: Anthropic.Beta.BetaContentBlockParam
    try {
      arquivo = await blocoArquivo(conteudo, tipo)
    } catch (erro) {
      throw new ErroLeitura('A imagem não pôde ser aberta para leitura.', (erro as Error).message)
    }
    const pedido = {
      model: this.opcoes.modelo,
      max_tokens: 8000,
      // Extração é tarefa simples: esforço baixo gasta menos e responde mais rápido.
      output_config: {
        effort: 'low' as const,
        format: { type: 'json_schema' as const, schema: ESQUEMA },
      },
      system: SISTEMA,
      messages: [
        {
          role: 'user' as const,
          content: [arquivo, { type: 'text' as const, text: listas(contexto) }],
        },
      ],
    }

    let resposta: Anthropic.Beta.BetaMessage
    try {
      try {
        // Recusa numa categoria que o modelo não atende é refeita no servidor por outro modelo.
        resposta = await this.cliente.beta.messages.create({
          ...pedido,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
      } catch (erro) {
        // Se a conta ou o modelo não aceitarem o fallback, a leitura segue sem ele.
        if (!(erro instanceof Anthropic.BadRequestError) || !/fallback/i.test(erro.message))
          throw erro
        resposta = await this.cliente.beta.messages.create(pedido)
      }
    } catch (erro) {
      throw paraErroLeitura(erro)
    }

    if (resposta.stop_reason === 'refusal') {
      throw new ErroLeitura(
        'A leitura automática recusou este documento; preencha à mão.',
        `recusa (${resposta.stop_details?.category ?? 'sem categoria'})`,
      )
    }
    if (
      resposta.stop_reason === 'max_tokens' ||
      resposta.stop_reason === 'model_context_window_exceeded'
    ) {
      throw new ErroLeitura(
        'O documento é grande demais para a leitura automática.',
        resposta.stop_reason,
      )
    }
    const texto = resposta.content.find(
      (b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text',
    )?.text
    if (!texto)
      throw new ErroLeitura(
        'A leitura não devolveu nada; preencha à mão.',
        `sem texto (${resposta.stop_reason})`,
      )

    const extraido = interpretarResposta(texto)
    return {
      extraido,
      modelo: resposta.model,
      tokensEntrada: resposta.usage.input_tokens,
      tokensSaida: resposta.usage.output_tokens,
    }
  }
}

/** Erro do SDK → mensagem para a tela (o detalhe técnico vai para o log). */
function paraErroLeitura(erro: unknown): ErroLeitura {
  const e = erro as Error
  if (
    erro instanceof Anthropic.AuthenticationError ||
    erro instanceof Anthropic.PermissionDeniedError
  ) {
    return new ErroLeitura(
      'A chave da leitura automática foi recusada; avise o administrador.',
      e.message,
    )
  }
  if (erro instanceof Anthropic.RateLimitError) {
    return new ErroLeitura(
      'A leitura automática está no limite de uso; tente de novo em instantes.',
      e.message,
    )
  }
  if (erro instanceof Anthropic.APIConnectionTimeoutError) {
    return new ErroLeitura('A leitura demorou demais; tente de novo ou preencha à mão.', e.message)
  }
  if (erro instanceof Anthropic.APIConnectionError) {
    return new ErroLeitura('Sem conexão com a leitura automática agora; tente de novo.', e.message)
  }
  // Sem crédito, a Anthropic responde 400 ("Your credit balance is too low"): não é o arquivo.
  if (erro instanceof Anthropic.APIError && /credit balance|billing/i.test(e.message)) {
    return new ErroLeitura(
      'A conta da Anthropic está sem crédito. O administrador precisa adicionar crédito em console.anthropic.com (Billing).',
      e.message,
    )
  }
  if (erro instanceof Anthropic.BadRequestError) {
    return new ErroLeitura(
      'Este arquivo não pôde ser lido (protegido por senha ou grande demais?).',
      e.message,
    )
  }
  if (erro instanceof Anthropic.APIError) {
    return new ErroLeitura(
      'A leitura automática está instável; tente de novo em instantes.',
      e.message,
    )
  }
  return new ErroLeitura('Não deu para ler o documento agora; preencha à mão.', e?.message)
}

/** Erro ao conferir chave e modelo → mensagem para quem está configurando. */
function paraErroConferencia(erro: unknown, modelo: string): ErroLeitura {
  if (erro instanceof Anthropic.NotFoundError) {
    return new ErroLeitura(
      `O modelo "${modelo}" não existe ou não está liberado para esta chave.`,
      (erro as Error).message,
    )
  }
  if (
    erro instanceof Anthropic.AuthenticationError ||
    erro instanceof Anthropic.PermissionDeniedError
  ) {
    return new ErroLeitura(
      'A Anthropic recusou esta chave. Confira se ela foi copiada inteira e está ativa.',
      (erro as Error).message,
    )
  }
  return paraErroLeitura(erro)
}
