import { z } from 'zod'
import { idQuery, mesQuery } from './comum.js'

/*
  O dashboard. Os indicadores do topo (gasto do mês, em aberto, vencido,
  vence em 7 dias e a série de 12 meses) vêm de `/lancamentos/indicadores`;
  aqui fica o resto: para onde foi o dinheiro no mês, como está cada cartão
  frente ao orçamento e o que vence em seguida.

  O mês (`mes`, "AAAA-MM") vale para categoria, empreendimento e cartões; sem
  ele, é o corrente. "A pagar" é sempre a partir de hoje, seja qual for o mês.
*/

export const painelSchema = z.object({
  setorId: idQuery.optional(),
  mes: mesQuery.optional(),
})
export type FiltrosPainel = z.output<typeof painelSchema>

/** Um pedaço do gasto do mês: uma categoria, um empreendimento. `id` null é o gasto sem classificação. */
export interface FatiaPainel {
  id: number | null
  nome: string
  centavos: number
}

/**
 * Situação de um cartão num mês (pela data do gasto).
 *
 * comprometido = lançado + fixos que não viraram lançamento no mês;
 * disponível = orçamento − comprometido (negativo quando estourou).
 * O orçamento é o do cadastro hoje: ainda não há histórico de orçamento por mês.
 */
export interface OrcamentoCartao {
  id: number
  nome: string
  final: string | null
  orcamentoCentavos: number
  lancadoCentavos: number
  /** Soma dos gastos fixos ativos do cartão, por mês. */
  fixosCentavos: number
  fixosPendentesCentavos: number
  fixosPendentes: number
}

/** Uma parcela a pagar: vencida ou vencendo nos próximos 30 dias. */
export interface VencimentoPainel {
  lancamentoId: number
  parcelaId: number
  numero: number
  totalParcelas: number
  descricao: string
  fornecedor: string | null
  vencimento: string
  valorCentavos: number
}

export interface Painel {
  hoje: string
  /** Mês de referência ("AAAA-MM"): o pedido ou, sem pedido, o corrente. */
  mes: string
  porCategoria: FatiaPainel[]
  porEmpreendimento: FatiaPainel[]
  cartoes: OrcamentoCartao[]
  aPagar: VencimentoPainel[]
}
