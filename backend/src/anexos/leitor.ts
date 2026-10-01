import type { TipoAnexo } from '../contracts/anexos.js'
import type { TipoDocumentoLido } from '../contracts/leitura.js'

/*
  O leitor de documento é uma peça trocável: recebe o arquivo e as listas do
  SIGO e devolve o que entendeu, cru (centavos, datas em texto, ids como a
  IA escolheu). Quem confere e ajusta ao formato do formulário é
  `montarLeitura` (leitura.ts), que não confia em nada do que chega aqui.
*/

/** As listas do SIGO que a IA pode usar para sugerir. */
export interface ContextoLeitura {
  hoje: string
  categorias: Array<{ id: number; nome: string; descricao: string | null }>
  empreendimentos: Array<{ id: number; nome: string }>
  formasPagamento: Array<{ id: number; nome: string; cartao: boolean }>
}

/** O que o leitor devolve, antes de qualquer conferência. */
export interface DocumentoExtraido {
  tipoDocumento: TipoDocumentoLido
  descricao: string | null
  /** Valor a pagar, em centavos (R$ 1.234,56 = 123456). */
  valorCentavos: number | null
  dataDocumento: string | null
  fornecedor: { nome: string | null; documento: string | null } | null
  codigo: string | null
  parcelas: Array<{ vencimento: string; valorCentavos: number }>
  pagoEm: string | null
  formaPagamentoId: number | null
  categoriaId: number | null
  empreendimentoId: number | null
  observacao: string | null
  avisos: string[]
}

export interface ResultadoLeitor {
  extraido: DocumentoExtraido
  modelo: string
  tokensEntrada: number
  tokensSaida: number
}

export interface Leitor {
  /** Confere chave e modelo sem ler nada (ao salvar a configuração). Falha com ErroLeitura. */
  conferir(): Promise<void>
  ler(conteudo: Buffer, tipo: TipoAnexo, contexto: ContextoLeitura): Promise<ResultadoLeitor>
}

/** Falha da leitura com mensagem para a tela (a técnica vai para o log). */
export class ErroLeitura extends Error {
  constructor(
    message: string,
    readonly detalhe?: string,
  ) {
    super(message)
    this.name = 'ErroLeitura'
  }
}
