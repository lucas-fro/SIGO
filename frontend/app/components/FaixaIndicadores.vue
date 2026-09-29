<script setup lang="ts">
import {
  CalendarClock,
  ChartColumnIncreasing,
  CircleAlert,
  ReceiptText,
  Wallet,
} from 'lucide-vue-next'
import { hoje, somarDias, somarMeses, somarMesesAoMes } from '#contracts'
import { data, dataCurta, nomeMes, reais, reaisIndicador } from '~/composables/useFormat'
import { useIndicadores } from '~/composables/useLancamentos'

/*
  A faixa do topo do dashboard. Os dois primeiros seguem o mês escolhido: o
  gasto do mês e o do ano até ele. Os dois últimos são sempre de hoje (o que
  está em aberto, com o vencido destacado, e o que vence na semana) e, quando
  o mês é outro, levam a etiqueta "hoje". A tendência fica no gráfico de 12
  meses logo abaixo.
  Rótulos e legendas saem dos dados, não do seletor: enquanto o mês novo
  carrega, o texto continua batendo com os números que estão na tela.
*/
const props = defineProps<{ mes?: string }>()

const { data: indicadores, isPending: carregando } = useIndicadores(() => props.mes)

const mesDosDados = computed(() => indicadores.value?.mes ?? props.mes ?? hoje().slice(0, 7))
const corrente = computed(
  () => mesDosDados.value === (indicadores.value?.hoje ?? hoje()).slice(0, 7),
)

/** "Gasto em agosto", com o ano quando não é o do mês corrente. */
const rotuloGasto = computed(() => {
  const mes = mesDosDados.value
  const outroAno = mes.slice(0, 4) !== (indicadores.value?.hoje ?? hoje()).slice(0, 4)
  return `Gasto em ${nomeMes(mes)}${outroAno ? ` de ${mes.slice(0, 4)}` : ''}`
})

function variacao(g?: { centavos: number; anteriorCentavos: number }) {
  if (!g || !g.anteriorCentavos) return null
  const razao = (g.centavos - g.anteriorCentavos) / g.anteriorCentavos
  const pct = Math.round(Math.abs(razao) * 100)
  return {
    texto: `${pct}%`,
    direcao: pct === 0 ? ('estavel' as const) : razao > 0 ? ('sobe' as const) : ('desce' as const),
  }
}

/**
 * No mês corrente, a comparação é com o mesmo trecho do mês anterior (do dia 1
 * até o mesmo dia, "até 28/08"); num mês encerrado, com o anterior inteiro
 * ("em julho"). A legenda diz qual.
 */
const legendaGasto = computed(() => {
  const i = indicadores.value
  if (!i) return ''
  const trecho = corrente.value
    ? `até ${dataCurta(somarMeses(i.hoje, -1))}`
    : `em ${nomeMes(somarMesesAoMes(mesDosDados.value, -1))}`
  return i.gastoMes.anteriorCentavos
    ? `vs. ${reaisIndicador(i.gastoMes.anteriorCentavos)} ${trecho}`
    : `sem gasto ${trecho} para comparar`
})

/** "Gasto em 2026"; num mês encerrado, "Gasto em 2026 até agosto". */
const rotuloAno = computed(() => {
  const mes = mesDosDados.value
  return `Gasto em ${mes.slice(0, 4)}${corrente.value ? '' : ` até ${nomeMes(mes)}`}`
})

/** O ano anterior no mesmo corte: até o mesmo dia no mês corrente, até o fim do mês nos outros. */
const legendaAno = computed(() => {
  const i = indicadores.value
  // Sem gasto no ano anterior não há com o que comparar: o quadro fica sem legenda.
  if (!i?.gastoAno.anteriorCentavos) return ''
  const anterior = Number(mesDosDados.value.slice(0, 4)) - 1
  const ate = corrente.value
    ? data(somarMeses(i.hoje, -12))
    : `${nomeMes(mesDosDados.value)} de ${anterior}`
  return `vs. ${reaisIndicador(i.gastoAno.anteriorCentavos)} até ${ate}`
})

const marcaHoje = computed(() => (corrente.value ? undefined : 'hoje'))

/* O vencido não tem quadro próprio: quando existe, o "em aberto" fica em alerta e diz quantas. */
const vencidas = computed(() => indicadores.value?.vencido.parcelas ?? 0)
const legendaEmAberto = computed(() => {
  const n = indicadores.value?.emAberto.parcelas ?? 0
  if (!vencidas.value) return parcelasTexto(n, 'a pagar')
  const v = vencidas.value
  return `${n === 1 ? '1 parcela' : `${n.toLocaleString('pt-BR')} parcelas`} · ${v === 1 ? '1 vencida' : `${v} vencidas`}`
})

const parcelasTexto = (n: number, sufixo: string) =>
  n === 1 ? `1 parcela ${sufixo}` : `${n.toLocaleString('pt-BR')} parcelas ${sufixo}`
</script>

<template>
  <!-- No celular os indicadores viram uma faixa que desliza para o lado: empilhados,
       ocupariam a primeira tela inteira. -->
  <section
    class="kpis flex snap-x snap-mandatory overflow-x-auto border-y border-line [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:overflow-hidden xl:grid-cols-4 [&>*]:max-sm:w-[82%] [&>*]:max-sm:shrink-0 [&>*]:max-sm:snap-start"
    aria-label="Indicadores"
  >
    <StatTile
      :rotulo="rotuloGasto"
      :icone="Wallet"
      :valor="reaisIndicador(indicadores?.gastoMes.centavos)"
      :valor-exato="reais(indicadores?.gastoMes.centavos)"
      :variacao="variacao(indicadores?.gastoMes)"
      :legenda="legendaGasto"
      :carregando="carregando"
    />
    <StatTile
      :rotulo="rotuloAno"
      :icone="ChartColumnIncreasing"
      :valor="reaisIndicador(indicadores?.gastoAno.centavos)"
      :valor-exato="reais(indicadores?.gastoAno.centavos)"
      :variacao="variacao(indicadores?.gastoAno)"
      :legenda="legendaAno"
      :carregando="carregando"
    />
    <StatTile
      rotulo="Em aberto"
      :marca="marcaHoje"
      :icone="vencidas ? CircleAlert : ReceiptText"
      :tom="vencidas ? 'neg' : 'neutro'"
      :valor="reaisIndicador(indicadores?.emAberto.centavos)"
      :valor-exato="
        vencidas
          ? `${reais(indicadores?.emAberto.centavos)}, dos quais ${reais(indicadores?.vencido.centavos)} vencidos`
          : reais(indicadores?.emAberto.centavos)
      "
      :legenda="legendaEmAberto"
      :carregando="carregando"
    />
    <StatTile
      rotulo="Vence em 7 dias"
      :marca="marcaHoje"
      :icone="CalendarClock"
      :tom="indicadores?.proximos7Dias.parcelas ? 'warn' : 'neutro'"
      :valor="reaisIndicador(indicadores?.proximos7Dias.centavos)"
      :valor-exato="reais(indicadores?.proximos7Dias.centavos)"
      :legenda="
        parcelasTexto(
          indicadores?.proximos7Dias.parcelas ?? 0,
          'até ' + dataCurta(somarDias(indicadores?.hoje ?? hoje(), 7)),
        )
      "
      :carregando="carregando"
    />
  </section>
</template>
