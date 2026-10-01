import { z } from 'zod'
import type { TipoRecarga } from './cadastros.js'
import { idQuery, mesQuery } from './comum.js'

/*
  A página Cartão. O cadastro de cada cartão, com as recargas e os gastos
  fixos, vem com as outras listas em GET /cadastros; daqui vêm os números: a
  situação de cada cartão num mês (`mes`, "AAAA-MM"; sem ele, o corrente),
  pela data do gasto, e o saldo de hoje dos cartões de recarga avulsa.
*/

export const situacaoCartoesSchema = z.object({
  setorId: idQuery.optional(),
  mes: mesQuery.optional(),
})
export type FiltrosSituacaoCartoes = z.output<typeof situacaoCartoesSchema>

/**
 * Situação de um cartão num mês (pela data do gasto).
 *
 * comprometido = lançado + fixos que não viraram lançamento no mês;
 * disponível = orçamento − comprometido (negativo quando estourou).
 * O orçamento é o do cadastro hoje: ainda não há histórico de orçamento por mês.
 */
export interface OrcamentoCartao {
  id: number
  recarga: TipoRecarga
  /**
   * Mensal: o orçamento do cadastro. Avulsa: o disponível no mês, saldo de antes
   * mais as recargas do mês (0 se o saldo de antes for negativo e nada entrou).
   */
  orcamentoCentavos: number
  /** Avulsa: recargas menos gastos de antes do mês (pode ser negativo). */
  saldoAnteriorCentavos: number
  /** Avulsa: soma das recargas com data no mês. */
  recarregadoCentavos: number
  lancadoCentavos: number
  /** Soma dos gastos fixos ativos do cartão, por mês. */
  fixosCentavos: number
  fixosPendentesCentavos: number
  fixosPendentes: number
}

/**
 * Saldo de hoje de um cartão de recarga avulsa: as recargas menos o lançado no
 * cartão com data do gasto até hoje. É o número que bate com o extrato do banco
 * (o fixo lançado para o dia 20 só sai do saldo no dia 20).
 */
export interface SaldoCartao {
  cartaoId: number
  centavos: number
}

export interface SituacaoCartoes {
  hoje: string
  /** Mês de referência ("AAAA-MM"): o pedido ou, sem pedido, o corrente. */
  mes: string
  /** Os cartões ativos já cadastrados no mês e os que tiveram gasto nele (mesmo desativados depois). */
  cartoes: OrcamentoCartao[]
  /** Todos os cartões de recarga avulsa, seja qual for o mês. */
  saldos: SaldoCartao[]
}
