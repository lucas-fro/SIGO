import type { SituacaoPagamento } from '#contracts'

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** Centavos → "R$ 1.234,56". A API trafega dinheiro sempre em centavos inteiros. */
export function reais(centavos: number | null | undefined): string {
  return brl.format(Number(centavos ?? 0) / 100)
}

const brlInteiro = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

/**
 * Valor de indicador: reais inteiros ("R$ 30.272") e, a partir do milhão,
 * abreviado ("R$ 1,2 mi"). Todos os indicadores da faixa saem no mesmo
 * formato, e o valor exato, com centavos, fica no `title`.
 */
export function reaisIndicador(centavos: number | null | undefined): string {
  const valor = Number(centavos ?? 0) / 100
  if (Math.abs(valor) >= 1_000_000) {
    return `R$ ${(valor / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  }
  return brlInteiro.format(valor)
}

/** Rótulo de eixo: curto e sem centavos ("R$ 40 mil", "R$ 1,5 mi"). */
export function reaisEixo(centavos: number): string {
  const valor = centavos / 100
  const umaCasa = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  if (Math.abs(valor) >= 1_000_000) return `R$ ${umaCasa(valor / 1_000_000)} mi`
  if (Math.abs(valor) >= 1_000) return `R$ ${umaCasa(valor / 1_000)} mil`
  return `R$ ${Math.round(valor)}`
}

const MESES_LONGOS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** "2026-08-15" ou "2026-08" → "agosto". */
export const nomeMes = (data: string): string => MESES_LONGOS[Number(data.slice(5, 7)) - 1] ?? ''

/** "2026-08" → "Agosto de 2026". */
export function mesPorExtenso(mes: string): string {
  const nome = nomeMes(mes)
  return nome ? `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${mes.slice(0, 4)}` : ''
}

export const ROTULO_PAGAMENTO: Record<SituacaoPagamento, string> = {
  pago: 'Pago',
  parcial: 'Parcial',
  em_aberto: 'Em aberto',
  vencido: 'Vencido',
}

export const rotuloPagamento = (situacao: SituacaoPagamento): string => ROTULO_PAGAMENTO[situacao]

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "2026-09" → "set/26". */
export function mesCurto(anoMes: string): string {
  const [ano, mes] = anoMes.split('-')
  const nome = MESES[Number(mes) - 1]
  return ano && nome ? `${nome}/${ano.slice(2)}` : anoMes
}

/**
 * Campo de dia (1 a 31) → número ou `null` quando vazio. O `v-model` num
 * `<input type="number">` entrega número depois que a pessoa digita e `''`
 * com o campo vazio, então o valor pode chegar como texto ou como número.
 */
export function paraDia(valor: string | number | null | undefined): number | null {
  return valor === null || valor === undefined || String(valor).trim() === '' ? null : Number(valor)
}

export function count(value: number | null | undefined): string {
  return int.format(Number(value ?? 0))
}

/** Datas chegam como "AAAA-MM-DD" ou ISO; sempre renderiza dd/mm/aaaa. */
export function data(value: string | null | undefined): string {
  if (!value) return '—'
  const [y, m, d] = String(value).slice(0, 10).split('-')
  if (!y || !m || !d) return '—'
  return `${d}/${m}/${y}`
}

/** Data curta para tabela densa: "28/09". */
export function dataCurta(value: string | null | undefined): string {
  if (!value) return '—'
  const [, m, d] = String(value).slice(0, 10).split('-')
  return m && d ? `${d}/${m}` : '—'
}

/** Instante de um registro — "28/09/2026 14:32", no fuso de quem olha. */
export function dataHora(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
