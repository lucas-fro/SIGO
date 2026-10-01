import OpenAI from 'openai'
import type { TipoAnexo } from '../contracts/anexos.js'
import {
  ESQUEMA,
  interpretarResposta,
  listas,
  prepararImagem,
  SISTEMA,
} from './instrucoes-leitura.js'
import { ErroLeitura, type ContextoLeitura, type Leitor, type ResultadoLeitor } from './leitor.js'

/*
  Leitura de boleto, nota e recibo com a API da OpenAI (Responses API).

  Uma chamada só: o arquivo (PDF ou imagem) vai antes do texto com as listas
  do SIGO, e a resposta vem num JSON imposto por esquema no modo estrito
  (structured outputs). `store: false`: o documento não fica guardado na
  OpenAI. Instruções, esquema e conferência: instrucoes-leitura.ts.
*/

type ConteudoEntrada = OpenAI.Responses.ResponseInputContent

async function blocoArquivo(conteudo: Buffer, tipo: TipoAnexo): Promise<ConteudoEntrada> {
  if (tipo === 'application/pdf') {
    return {
      type: 'input_file',
      filename: 'comprovante.pdf',
      file_data: `data:application/pdf;base64,${conteudo.toString('base64')}`,
    }
  }
  const imagem = await prepararImagem(conteudo, tipo)
  return {
    type: 'input_image',
    detail: 'high',
    image_url: `data:${imagem.tipo};base64,${imagem.data.toString('base64')}`,
  }
}

/** Parte do cliente que o leitor usa: permite trocar por um falso nos testes. */
export interface ClienteRespostas {
  responses: {
    create: (
      pedido: OpenAI.Responses.ResponseCreateParamsNonStreaming,
    ) => Promise<OpenAI.Responses.Response>
  }
  models: { retrieve: (modelo: string) => Promise<unknown> }
}

export class LeitorOpenAI implements Leitor {
  private readonly cliente: ClienteRespostas

  constructor(
    private readonly opcoes: { chave: string; modelo: string },
    cliente?: ClienteRespostas,
  ) {
    // Tela interativa: 90 s por tentativa e 2 novas tentativas (429, 5xx, conexão) já no SDK.
    this.cliente = cliente ?? new OpenAI({ apiKey: opcoes.chave, timeout: 90_000, maxRetries: 2 })
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
    let arquivo: ConteudoEntrada
    try {
      arquivo = await blocoArquivo(conteudo, tipo)
    } catch (erro) {
      throw new ErroLeitura('A imagem não pôde ser aberta para leitura.', (erro as Error).message)
    }
    const pedido: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: this.opcoes.modelo,
      instructions: SISTEMA,
      input: [
        {
          role: 'user',
          content: [arquivo, { type: 'input_text', text: listas(contexto) }],
        },
      ],
      text: {
        format: { type: 'json_schema', name: 'lancamento', schema: ESQUEMA, strict: true },
      },
      max_output_tokens: 8000,
      store: false,
    }

    let resposta: OpenAI.Responses.Response
    try {
      try {
        // Extração é tarefa simples: raciocínio baixo gasta menos e responde mais rápido.
        resposta = await this.cliente.responses.create({ ...pedido, reasoning: { effort: 'low' } })
      } catch (erro) {
        // Modelo sem raciocínio (gpt-4.1, gpt-4o) recusa o parâmetro: segue sem ele.
        if (!(erro instanceof OpenAI.BadRequestError) || !/reasoning/i.test(erro.message))
          throw erro
        resposta = await this.cliente.responses.create(pedido)
      }
    } catch (erro) {
      throw paraErroLeitura(erro)
    }

    if (resposta.status === 'incomplete') {
      const motivo = resposta.incomplete_details?.reason ?? 'sem motivo'
      throw motivo === 'content_filter'
        ? new ErroLeitura('A leitura automática recusou este documento; preencha à mão.', motivo)
        : new ErroLeitura('O documento é grande demais para a leitura automática.', motivo)
    }
    if (resposta.status === 'failed') {
      throw new ErroLeitura(
        'A leitura automática está instável; tente de novo em instantes.',
        resposta.error?.message ?? 'failed',
      )
    }

    const conteudoSaida = resposta.output.flatMap((item) =>
      item.type === 'message' ? item.content : [],
    )
    const recusa = conteudoSaida.find((c) => c.type === 'refusal')
    if (recusa) {
      throw new ErroLeitura(
        'A leitura automática recusou este documento; preencha à mão.',
        `recusa (${recusa.refusal})`,
      )
    }
    const texto = resposta.output_text
    if (!texto) {
      throw new ErroLeitura(
        'A leitura não devolveu nada; preencha à mão.',
        `sem texto (${resposta.status ?? 'sem situação'})`,
      )
    }

    return {
      extraido: interpretarResposta(texto),
      modelo: resposta.model,
      tokensEntrada: resposta.usage?.input_tokens ?? 0,
      tokensSaida: resposta.usage?.output_tokens ?? 0,
    }
  }
}

/** Erro do SDK → mensagem para a tela (o detalhe técnico vai para o log). */
function paraErroLeitura(erro: unknown): ErroLeitura {
  const e = erro as Error
  if (erro instanceof OpenAI.AuthenticationError || erro instanceof OpenAI.PermissionDeniedError) {
    return new ErroLeitura(
      'A chave da leitura automática foi recusada; avise o administrador.',
      e.message,
    )
  }
  if (erro instanceof OpenAI.RateLimitError) {
    // 429 da OpenAI também é crédito acabado (insufficient_quota).
    return erro.code === 'insufficient_quota' || /quota/i.test(e.message)
      ? new ErroLeitura('A conta da OpenAI está sem crédito; avise o administrador.', e.message)
      : new ErroLeitura(
          'A leitura automática está no limite de uso; tente de novo em instantes.',
          e.message,
        )
  }
  if (erro instanceof OpenAI.APIConnectionTimeoutError) {
    return new ErroLeitura('A leitura demorou demais; tente de novo ou preencha à mão.', e.message)
  }
  if (erro instanceof OpenAI.APIConnectionError) {
    return new ErroLeitura('Sem conexão com a leitura automática agora; tente de novo.', e.message)
  }
  if (erro instanceof OpenAI.BadRequestError) {
    return new ErroLeitura(
      'Este arquivo não pôde ser lido (protegido por senha ou grande demais?).',
      e.message,
    )
  }
  if (erro instanceof OpenAI.APIError) {
    return new ErroLeitura(
      'A leitura automática está instável; tente de novo em instantes.',
      e.message,
    )
  }
  return new ErroLeitura('Não deu para ler o documento agora; preencha à mão.', e?.message)
}

/** Erro ao conferir chave e modelo → mensagem para quem está configurando. */
function paraErroConferencia(erro: unknown, modelo: string): ErroLeitura {
  const e = erro as Error
  if (erro instanceof OpenAI.NotFoundError) {
    return new ErroLeitura(
      `O modelo "${modelo}" não existe ou não está liberado para esta chave.`,
      e.message,
    )
  }
  if (erro instanceof OpenAI.AuthenticationError || erro instanceof OpenAI.PermissionDeniedError) {
    return new ErroLeitura(
      'A OpenAI recusou esta chave. Confira se ela foi copiada inteira e está ativa.',
      e.message,
    )
  }
  return paraErroLeitura(erro)
}
