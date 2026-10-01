/*
  Leitura de documento: o comprovante enviado no "Novo lançamento" é lido por
  IA, e o que ela entendeu volta para pré-preencher o formulário. Nada é salvo
  pela leitura: a pessoa revisa e conclui o lançamento.

  Os ids (categoria, empreendimento, forma de pagamento) só chegam aqui se
  existem e estão ativos; o fornecedor é achado pelo CNPJ/CPF no cadastro e,
  quando não existe, volta como sugestão para cadastrar.
*/

export const TIPOS_DOCUMENTO_LIDO = [
  'boleto',
  'nota_fiscal',
  'fatura',
  'recibo',
  'comprovante_pagamento',
  'cupom',
  'outro',
] as const
export type TipoDocumentoLido = (typeof TIPOS_DOCUMENTO_LIDO)[number]

export const ROTULO_DOCUMENTO_LIDO: Record<TipoDocumentoLido, string> = {
  boleto: 'boleto',
  nota_fiscal: 'nota fiscal',
  fatura: 'fatura',
  recibo: 'recibo',
  comprovante_pagamento: 'comprovante de pagamento',
  cupom: 'cupom',
  outro: 'documento',
}

export interface ParcelaLida {
  valorCentavos: number
  vencimento: string
}

export interface LeituraDocumento {
  tipoDocumento: TipoDocumentoLido
  descricao: string | null
  valorCentavos: number | null
  /** Emissão da nota ou data do documento: vira a data do gasto. */
  dataGasto: string | null
  codigoIdentificacao: string | null
  observacao: string | null
  /** Fornecedor já cadastrado, achado pelo CNPJ/CPF do documento. */
  fornecedor: { id: number; nome: string } | null
  /** Fornecedor do documento que ainda não está no cadastro. */
  fornecedorNovo: { nome: string; documento: string | null } | null
  categoriaId: number | null
  empreendimentoId: number | null
  formaPagamentoId: number | null
  /** Vencimentos lidos (vazio quando o documento não diz). A soma pode não fechar: o formulário confere. */
  parcelas: ParcelaLida[]
  /** Documento que prova pagamento já feito (comprovante de Pix, recibo quitado). */
  pagoEm: string | null
  /** O que a leitura não conseguiu garantir e a pessoa precisa conferir. */
  avisos: string[]
}

/** O que fica guardado no comprovante sobre a leitura: quem leu, quanto custou e o resultado. */
export interface RegistroLeitura {
  modelo: string
  em: string
  tokensEntrada: number
  tokensSaida: number
  resultado: LeituraDocumento
}
