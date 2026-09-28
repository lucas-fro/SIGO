import { somarMeses } from './datas.js'

export interface ParcelaGerada {
  valorCentavos: number
  vencimento: string
}

/**
 * Divide o total em parcelas mensais.
 *
 * Os centavos que sobram da divisão vão para a primeira parcela, como fazem
 * banco e cartão: R$ 100,00 em 3x vira 33,34 + 33,33 + 33,33. Assim a soma
 * sempre fecha com o total, que é a regra que a API confere.
 */
export function gerarParcelas(
  totalCentavos: number,
  quantidade: number,
  primeiroVencimento: string,
): ParcelaGerada[] {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) return []
  const n = Math.max(1, Math.floor(quantidade))
  const base = Math.floor(totalCentavos / n)
  const resto = totalCentavos - base * n

  return Array.from({ length: n }, (_, i) => ({
    valorCentavos: base + (i === 0 ? resto : 0),
    vencimento: somarMeses(primeiroVencimento, i),
  }))
}

export const somaCentavos = (itens: ReadonlyArray<{ valorCentavos: number }>): number =>
  itens.reduce((total, item) => total + item.valorCentavos, 0)

export const SITUACOES_PAGAMENTO = ['pago', 'parcial', 'em_aberto', 'vencido'] as const
export type SituacaoPagamento = (typeof SITUACOES_PAGAMENTO)[number]

/**
 * Situação de pagamento de um lançamento, a partir da contagem das parcelas.
 *
 * Vencido pesa mais que parcial: se uma parcela passou do vencimento sem
 * pagamento, é isso que precisa aparecer, mesmo que outras já tenham sido pagas.
 */
export function situacaoPagamento(resumo: {
  parcelas: number
  pagas: number
  vencidas: number
}): SituacaoPagamento {
  if (resumo.pagas >= resumo.parcelas) return 'pago'
  if (resumo.vencidas > 0) return 'vencido'
  if (resumo.pagas > 0) return 'parcial'
  return 'em_aberto'
}
