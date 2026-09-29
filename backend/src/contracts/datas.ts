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

/** Soma (ou subtrai) meses a um mês "AAAA-MM": ("2026-01", -1) → "2025-12". */
export function somarMesesAoMes(mes: string, meses: number): string {
  return somarMeses(`${mes.slice(0, 7)}-01`, meses).slice(0, 7)
}

/**
 * Os 12 meses do gráfico de um mês escolhido: a janela mais recente que ainda
 * o contém, sem passar do mês corrente. Nos últimos 12 meses a janela fica
 * parada e só o destaque anda; antes disso, o mês escolhido é o primeiro dela.
 * Meses em "AAAA-MM".
 */
export function janelaDe12Meses(mes: string, mesCorrente: string): { inicio: string; fim: string } {
  const limite = somarMesesAoMes(mes, 11)
  const fim = mes > mesCorrente ? mes : limite < mesCorrente ? limite : mesCorrente
  return { inicio: somarMesesAoMes(fim, -11), fim }
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

/**
 * Um dia dentro do mês, sem estourar o fim dele: dia 31 em fevereiro vira 28
 * (ou 29). Aceita "AAAA-MM" ou qualquer data do mês.
 */
export function diaDoMes(mes: string, dia: number): string {
  const inicio = `${mes.slice(0, 7)}-01`
  const ultimo = Number(fimDoMes(inicio).slice(8, 10))
  return `${mes.slice(0, 7)}-${String(Math.min(Math.max(1, dia), ultimo)).padStart(2, '0')}`
}

/**
 * Vencimento da fatura em que uma compra no cartão vai cair.
 *
 * Compra antes do dia de fechamento entra na fatura que fecha naquele mês;
 * no dia do fechamento ou depois, na do mês seguinte. A fatura vence no dia
 * de vencimento seguinte ao fechamento: no mesmo mês quando o vencimento vem
 * depois do fechamento (fecha 3, vence 10), no mês seguinte quando vem antes
 * (fecha 25, vence 5).
 */
export function vencimentoDaFatura(
  dataCompra: string,
  diaFechamento: number,
  diaVencimento: number,
): string {
  const [, , dia] = partes(dataCompra)
  const mesesAteFechar = dia < diaFechamento ? 0 : 1
  const mesesAteVencer = mesesAteFechar + (diaVencimento > diaFechamento ? 0 : 1)
  return diaDoMes(somarMeses(inicioDoMes(dataCompra), mesesAteVencer), diaVencimento)
}
