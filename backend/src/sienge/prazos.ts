import { somarMesesAoMes } from '../contracts/datas.js'

/*
  Quando a cópia de um mês do Sienge precisa ser refeita. A busca só acontece
  quando a cópia venceu e alguém precisa do mês: a tela que olha o mês, ou a
  conferência de pagamentos, para os meses em que procura títulos. Assim a
  cota do Sienge (dividida com o Painel Sienge) só é gasta com o que é usado.
*/

/** Mês corrente e o anterior ainda recebem título novo: a cópia vence em 30 minutos. */
export const PRAZO_RECENTE_MS = 30 * 60_000
/** Mês mais antigo quase não muda: a cópia vale um dia. */
export const PRAZO_ANTIGO_MS = 24 * 60 * 60_000
/** Depois de uma falha, quanto esperar antes de tentar de novo sozinho. */
export const ESPERA_APOS_ERRO_MS = 5 * 60_000

export interface EstadoMes {
  buscadoEm: Date | null
  erroEm: Date | null
}

/** A falha é mais nova que a última busca completa (ou nunca houve busca completa). */
export const falhaAtual = (estado: EstadoMes | undefined): boolean =>
  !!estado?.erroEm && (!estado.buscadoEm || estado.erroEm > estado.buscadoEm)

export function precisaBuscar(
  estado: EstadoMes | undefined,
  mes: string,
  mesCorrente: string,
  agora: number,
): boolean {
  if (falhaAtual(estado) && agora - estado!.erroEm!.getTime() < ESPERA_APOS_ERRO_MS) return false
  if (!estado?.buscadoEm) return true
  const prazo = mes >= somarMesesAoMes(mesCorrente, -1) ? PRAZO_RECENTE_MS : PRAZO_ANTIGO_MS
  return agora - estado.buscadoEm.getTime() >= prazo
}
