<script setup lang="ts">
import { ArrowRight, History, Plus } from 'lucide-vue-next'
import { fimDoMes, hoje, mesQuery, type VencimentoPainel } from '#contracts'
import { data, mesCurto, mesPorExtenso, reais } from '~/composables/useFormat'
import { useIndicadores, usePainel } from '~/composables/useLancamentos'

definePageMeta({ title: 'Dashboard' })

const { user, canEdit } = useAuth()
const route = useRoute()
const router = useRouter()

// ---------- mês de referência ----------

/** O mês corrente em São Paulo: o limite do seletor. */
const mesCorrente = hoje().slice(0, 7)

/**
 * O mês fica na URL (`?mes=AAAA-MM`), para o link poder ser guardado ou
 * mandado para alguém; sem ele, ou com um mês inválido ou futuro, é o corrente.
 */
const mes = computed(() => {
  const q = route.query.mes
  return typeof q === 'string' && mesQuery.safeParse(q).success && q <= mesCorrente
    ? q
    : mesCorrente
})

function escolherMes(novo: string) {
  void router.replace({ query: { ...route.query, mes: novo === mesCorrente ? undefined : novo } })
}

const {
  data: indicadores,
  isPlaceholderData: trocandoIndicadores,
  isError: erroIndicadores,
} = useIndicadores(mes)
const {
  data: painel,
  isPending: carregando,
  isPlaceholderData: trocandoPainel,
  isError,
  error,
} = usePainel(mes)
/** Trocou de mês e o novo ainda está chegando: o anterior fica na tela, apagado. */
const trocando = computed(() => trocandoIndicadores.value || trocandoPainel.value)

// Os textos de cada quadro saem do mês dos dados, para baterem com os números na tela.
const mesDoPainel = computed(() => painel.value?.mes ?? mes.value)
const encerrado = computed(() => mesDoPainel.value < (painel.value?.hoje ?? hoje()).slice(0, 7))
const tituloMes = computed(() => mesPorExtenso(mesDoPainel.value))

const subtitulo = computed(() => {
  const setores = user.value?.setores ?? []
  const escopo = setores.length === 1 ? setores[0]!.nome : 'Todos os setores'
  if (mes.value !== mesCorrente) return `${escopo} · mês encerrado`
  const dia = hoje()
  return `${escopo} · mês em andamento, dia ${Number(dia.slice(8))} de ${Number(fimDoMes(dia).slice(8))}`
})

/**
 * Os lançamentos do mês escolhido, no Histórico. No mês corrente, até hoje: é o
 * mesmo corte do "Gasto em <mês>", então a soma da lista bate com o número.
 */
const linkLancamentos = computed(() => ({
  path: '/historico',
  query: {
    periodo: 'personalizado',
    de: `${mes.value}-01`,
    ate: mes.value === mesCorrente ? hoje() : fimDoMes(`${mes.value}-01`),
  },
}))

const dicaGrafico = computed(() => {
  const serie = indicadores.value?.serieMensal ?? []
  const janela =
    !serie.length || serie.at(-1)!.mes === mesCorrente
      ? 'nos últimos 12 meses'
      : `de ${mesCurto(serie[0]!.mes)} a ${mesCurto(serie.at(-1)!.mes)}`
  return `Pela data do gasto, ${janela}. Clique num mês para abri-lo.`
})

const diaUtc = (iso: string) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))

/** Dias até o vencimento (negativo quando venceu), contados pelo dia de hoje em São Paulo. */
function diasAte(p: VencimentoPainel): number {
  const hoje = painel.value?.hoje
  if (!hoje) return 0
  return Math.round((diaUtc(p.vencimento) - diaUtc(hoje)) / 86_400_000)
}

function prazo(p: VencimentoPainel): string {
  const n = diasAte(p)
  if (n < 0) return n === -1 ? 'venceu ontem' : `venceu há ${-n} dias`
  if (n === 0) return 'vence hoje'
  if (n === 1) return 'vence amanhã'
  return `em ${n} dias`
}

const MESES_CURTOS = [
  'JAN',
  'FEV',
  'MAR',
  'ABR',
  'MAI',
  'JUN',
  'JUL',
  'AGO',
  'SET',
  'OUT',
  'NOV',
  'DEZ',
]
const mesDaData = (iso: string) => MESES_CURTOS[Number(iso.slice(5, 7)) - 1] ?? ''
</script>

<template>
  <div class="pb-8">
    <PageHeader titulo="Dashboard" :subtitulo="subtitulo">
      <template #acoes>
        <SeletorMes :model-value="mes" :max="mesCorrente" @update:model-value="escolherMes" />
        <NuxtLink
          :to="linkLancamentos"
          class="btn btn-secondary"
          :title="`Lançamentos de ${mesPorExtenso(mes).toLowerCase()} no Histórico`"
        >
          <History :size="15" />
          <span>Lançamentos<span class="max-sm:hidden"> do mês</span></span>
        </NuxtLink>
        <NuxtLink v-if="canEdit" to="/lancamentos/novo" class="btn btn-primary">
          <Plus :size="16" /> Novo lançamento
        </NuxtLink>
      </template>
    </PageHeader>

    <div
      class="transition-opacity duration-150"
      :class="trocando ? 'opacity-60' : ''"
      :aria-busy="trocando || undefined"
    >
      <FaixaIndicadores :mes="mes" />

      <div v-if="isError" class="px-6 py-10 text-center text-[13px] text-muted">
        Não foi possível carregar o dashboard. {{ error?.message }}
      </div>

      <div v-else class="flex flex-col gap-4 px-5 pt-5 sm:px-6">
        <!-- linha 1: gasto por mês -->
        <section class="card p-5">
          <header class="mb-5 flex items-baseline justify-between gap-3">
            <div>
              <h2 class="text-[14px] font-semibold text-ink">Gasto por mês</h2>
              <p class="hint">{{ dicaGrafico }}</p>
            </div>
          </header>
          <GraficoMensal
            v-if="indicadores"
            :serie="indicadores.serieMensal"
            :destaque="indicadores.mes"
            @escolher="escolherMes"
          />
          <p v-else-if="erroIndicadores" class="py-16 text-center text-[13px] text-muted">
            Não foi possível carregar o gráfico.
          </p>
          <div v-else class="skeleton h-52" />
        </section>

        <!-- linha 2: por categoria e por empreendimento -->
        <div class="grid gap-4 lg:grid-cols-2">
          <section class="card p-5">
            <header class="mb-4">
              <h2 class="text-[14px] font-semibold text-ink">Por categoria</h2>
              <p class="hint">{{ tituloMes }}</p>
            </header>
            <div v-if="carregando" class="skeleton h-40" />
            <RankingBarras v-else :itens="painel?.porCategoria ?? []" />
          </section>
          <section class="card p-5">
            <header class="mb-4">
              <h2 class="text-[14px] font-semibold text-ink">Por empreendimento</h2>
              <p class="hint">{{ tituloMes }}</p>
            </header>
            <div v-if="carregando" class="skeleton h-40" />
            <RankingBarras v-else :itens="painel?.porEmpreendimento ?? []" />
          </section>
        </div>

        <!-- linha 3: a pagar -->
        <section class="card overflow-hidden">
          <header class="flex items-baseline justify-between gap-3 px-5 pt-5 pb-3">
            <div>
              <h2 class="flex items-center gap-2 text-[14px] font-semibold text-ink">
                A pagar <span v-if="encerrado" class="badge h-[18px] px-1.5">hoje</span>
              </h2>
              <p class="hint">Parcelas vencidas e as que vencem nos próximos 30 dias</p>
            </div>
            <NuxtLink
              to="/historico?aba=em_aberto"
              class="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-accent-text hover:underline"
            >
              Ver tudo em aberto <ArrowRight :size="14" />
            </NuxtLink>
          </header>

          <div v-if="carregando" class="flex flex-col gap-2 px-5 pb-5">
            <div v-for="n in 3" :key="n" class="skeleton h-12" />
          </div>
          <p v-else-if="!painel?.aPagar.length" class="px-5 pb-6 text-[13px] text-faint">
            Nada vencido e nada vencendo nos próximos 30 dias.
          </p>
          <ul v-else class="divide-y divide-line-soft border-t border-line-soft">
            <li v-for="p in painel.aPagar" :key="p.parcelaId">
              <NuxtLink
                :to="`/historico?id=${p.lancamentoId}`"
                class="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-alt"
              >
                <div
                  class="flex w-12 shrink-0 flex-col items-center rounded-lg border py-1 leading-tight"
                  :class="diasAte(p) < 0 ? 'border-neg/30 bg-neg-soft' : 'border-line bg-surface'"
                >
                  <span
                    class="text-[10px] font-semibold tracking-wide"
                    :class="diasAte(p) < 0 ? 'text-neg' : 'text-faint'"
                    >{{ mesDaData(p.vencimento) }}</span
                  >
                  <span class="tnum text-[17px] font-semibold text-ink">{{
                    p.vencimento.slice(8, 10)
                  }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-[13.5px] font-medium text-ink">{{ p.descricao }}</div>
                  <div
                    v-if="p.fornecedor || p.totalParcelas > 1"
                    class="truncate text-[12px] text-faint"
                  >
                    {{
                      [
                        p.fornecedor,
                        p.totalParcelas > 1 ? `parcela ${p.numero}/${p.totalParcelas}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    }}
                  </div>
                </div>
                <div class="shrink-0 text-right">
                  <div class="tnum text-[13.5px] font-semibold text-ink">
                    {{ reais(p.valorCentavos) }}
                  </div>
                  <div
                    class="text-[12px]"
                    :class="
                      diasAte(p) < 0
                        ? 'font-medium text-neg'
                        : diasAte(p) <= 7
                          ? 'text-warn'
                          : 'text-faint'
                    "
                    :title="data(p.vencimento)"
                  >
                    {{ prazo(p) }}
                  </div>
                </div>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
