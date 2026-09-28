/** Fuso da empresa. O servidor roda em UTC, e às 21h de Brasília já seria amanhã. */
export const FUSO = 'America/Sao_Paulo'

const formatoIso = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** O dia de hoje em São Paulo, "AAAA-MM-DD". */
export function hoje(agora: Date = new Date()): string {
  return formatoIso.format(agora)
}

function partes(dataIso: string): [number, number, number] {
  const [ano, mes, dia] = dataIso.split('-').map(Number)
  if (!ano || !mes || !dia) throw new Error(`Data inválida: ${dataIso}`)
  return [ano, mes, dia]
}

/**
 * Soma meses mantendo o dia, e quando o mês de destino é mais curto cai no
 * último dia dele: 31/01 + 1 mês = 28/02 (ou 29/02 no bissexto), não 03/03.
 * É a regra que banco e cartão usam para vencimento de parcela.
 */
export function somarMeses(dataIso: string, meses: number): string {
  const [ano, mes, dia] = partes(dataIso)
  const alvo = new Date(Date.UTC(ano, mes - 1 + meses, 1))
  const ultimoDia = new Date(
    Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0),
  ).getUTCDate()
  alvo.setUTCDate(Math.min(dia, ultimoDia))
  return alvo.toISOString().slice(0, 10)
}

/** Soma (ou subtrai) dias de calendário. */
export function somarDias(dataIso: string, dias: number): string {
  const [ano, mes, dia] = partes(dataIso)
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10)
}

/** Primeiro dia do mês da data. */
export function inicioDoMes(dataIso: string): string {
  return `${dataIso.slice(0, 7)}-01`
}

/** Último dia do mês da data. */
export function fimDoMes(dataIso: string): string {
  const [ano, mes] = partes(dataIso)
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return `${dataIso.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`
}
