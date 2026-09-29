<script setup lang="ts">
import {
  Download,
  Loader2,
  Maximize2,
  Plus,
  ReceiptText,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-vue-next'
import {
  fimDoMes,
  hoje,
  inicioDoMes,
  somarDias,
  somarMeses,
  type ListaLancamentos,
} from '#contracts'
import { ApiError, useApiQuery, type QueryParams } from '~/composables/useApi'
import { opcoesAtivas, useCadastros, useFornecedores } from '~/composables/useCadastros'
import { useExportarLancamentos } from '~/composables/useExportar'
import { data, dataCurta, reais } from '~/composables/useFormat'
import { useLancamento } from '~/composables/useLancamentos'
import { useToast } from '~/composables/useToast'

definePageMeta({ title: 'Histórico' })
useHead({ title: 'Histórico · SIGO' })

const route = useRoute()
const router = useRouter()
const { canEdit } = useAuth()
const { data: cadastros } = useCadastros()
const { data: fornecedores } = useFornecedores()
const toast = useToast()

// ---------- estado na URL: o link colado abre a mesma visão ----------

const texto = (chave: string): string => {
  const v = route.query[chave]
  return typeof v === 'string' ? v : ''
}
const numero = (chave: string): number | undefined => {
  const v = Number(texto(chave))
  return Number.isInteger(v) && v > 0 ? v : undefined
}

function atualizar(mudancas: Record<string, string | number | null | undefined>) {
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries(route.query)) if (typeof v === 'string') query[k] = v
  for (const [k, v] of Object.entries(mudancas)) {
    if (v === undefined || v === null || v === '') delete query[k]
    else query[k] = String(v)
  }
  // Mudou o filtro, volta para a primeira página. Abrir ou fechar o painel não conta.
  if (!('pagina' in mudancas) && !('id' in mudancas)) delete query.pagina
  void router.replace({ query })
}

// ---------- abas ----------

const ABAS = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'em_aberto', rotulo: 'Em aberto' },
  { valor: 'vencido', rotulo: 'Vencidos' },
  { valor: 'pago', rotulo: 'Pagos' },
  { valor: 'cancelado', rotulo: 'Cancelados' },
] as const
type Aba = (typeof ABAS)[number]['valor']

const aba = computed<Aba>(() => ABAS.find((a) => a.valor === texto('aba'))?.valor ?? 'todos')

// ---------- período ----------

const PERIODOS = [
  { valor: 'tudo', rotulo: 'Todo o período' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'mes-anterior', rotulo: 'Mês passado' },
  { valor: '90d', rotulo: 'Últimos 90 dias' },
  { valor: 'ano', rotulo: 'Este ano' },
  { valor: 'personalizado', rotulo: 'Personalizado' },
] as const

const periodo = computed(() => PERIODOS.find((p) => p.valor === texto('periodo'))?.valor ?? 'tudo')

const intervalo = computed<{ de?: string; ate?: string }>(() => {
  const dia = hoje()
  switch (periodo.value) {
    case 'mes':
      return { de: inicioDoMes(dia), ate: fimDoMes(dia) }
    case 'mes-anterior': {
      const mes = somarMeses(dia, -1)
      return { de: inicioDoMes(mes), ate: fimDoMes(mes) }
    }
    case '90d':
      return { de: somarDias(dia, -89), ate: dia }
    case 'ano':
      return { de: `${dia.slice(0, 4)}-01-01`, ate: `${dia.slice(0, 4)}-12-31` }
    case 'personalizado':
      return { de: texto('de') || undefined, ate: texto('ate') || undefined }
    default:
      return {}
  }
})

// ---------- busca (espera a pessoa parar de digitar) ----------

const busca = ref(texto('busca'))
watch(
  () => route.query.busca,
  () => {
    if (busca.value.trim() !== texto('busca')) busca.value = texto('busca')
  },
)
let espera: ReturnType<typeof setTimeout> | undefined
watch(busca, (valor) => {
  clearTimeout(espera)
  espera = setTimeout(() => {
    if (valor.trim() !== texto('busca')) atualizar({ busca: valor.trim() })
  }, 300)
})

// ---------- filtros por cadastro ----------

// Campanha fica de fora de propósito: é detalhe secundário, não recorte do dia a dia.
const FILTROS = [
  { chave: 'categoriaId', rotulo: 'Categoria' },
  { chave: 'empreendimentoId', rotulo: 'Empreendimento' },
  { chave: 'formaPagamentoId', rotulo: 'Forma de pagamento' },
  { chave: 'fornecedorId', rotulo: 'Fornecedor' },
  { chave: 'cartaoId', rotulo: 'Cartão' },
] as const
type ChaveFiltro = (typeof FILTROS)[number]['chave']

function opcoesDe(chave: ChaveFiltro): Array<{ id: number; nome: string }> {
  const c = cadastros.value
  const selecionado = numero(chave)
  switch (chave) {
    case 'categoriaId':
      return opcoesAtivas(c?.categorias, selecionado)
    case 'empreendimentoId':
      return opcoesAtivas(c?.empreendimentos, selecionado)
    case 'formaPagamentoId':
      return opcoesAtivas(c?.formasPagamento, selecionado)
    case 'fornecedorId':
      return opcoesAtivas(fornecedores.value, selecionado)
    case 'cartaoId':
      return opcoesAtivas(c?.cartoes, selecionado)
  }
}

const mostrarFiltros = ref(FILTROS.some((f) => numero(f.chave)))

const chips = computed(() =>
  FILTROS.flatMap((f) => {
    const id = numero(f.chave)
    if (!id) return []
    const nome = opcoesDe(f.chave).find((o) => o.id === id)?.nome ?? `#${id}`
    return [{ chave: f.chave, rotulo: f.rotulo, nome }]
  }),
)

const temFiltro = computed(
  () => chips.value.length > 0 || periodo.value !== 'tudo' || !!texto('busca'),
)

/**
 * Uma chamada só a `atualizar`: o `router.replace` é assíncrono, e uma segunda
 * chamada em seguida ainda leria a URL antiga, devolvendo os filtros removidos.
 */
function limparFiltros(incluindoAba = false) {
  busca.value = ''
  atualizar({
    busca: undefined,
    periodo: undefined,
    de: undefined,
    ate: undefined,
    ...Object.fromEntries(FILTROS.map((f) => [f.chave, undefined])),
    ...(incluindoAba ? { aba: undefined } : {}),
  })
}

function mudarPeriodo(evento: Event) {
  const valor = (evento.target as HTMLSelectElement).value
  atualizar({ periodo: valor === 'tudo' ? undefined : valor })
}

// ---------- consulta ----------

/** O filtro como a API entende, sem paginação: serve à lista e à exportação. */
const filtrosApi = computed<QueryParams>(() => {
  const base: QueryParams = {
    busca: texto('busca') || undefined,
    ...intervalo.value,
    ...Object.fromEntries(FILTROS.map((f) => [f.chave, numero(f.chave)])),
  }
  switch (aba.value) {
    case 'em_aberto':
    case 'vencido':
    case 'pago':
      return { ...base, pagamento: aba.value }
    case 'cancelado':
      return { ...base, situacao: 'cancelado' }
    default:
      return base
  }
})

const pagina = computed(() => numero('pagina') ?? 1)
const POR_PAGINA = 50

const {
  data: lista,
  isPending,
  isFetching,
  isError,
  error,
  refetch,
} = useApiQuery<ListaLancamentos>(
  'lancamentos',
  '/lancamentos',
  () => ({ ...filtrosApi.value, pagina: pagina.value, porPagina: POR_PAGINA }),
  { keepPrevious: true },
)

const inicio = computed(() => (lista.value?.total ? (pagina.value - 1) * POR_PAGINA + 1 : 0))
const fim = computed(() => Math.min(pagina.value * POR_PAGINA, lista.value?.total ?? 0))
const totalPaginas = computed(() => Math.max(1, Math.ceil((lista.value?.total ?? 0) / POR_PAGINA)))

// ---------- painel de detalhe ----------

const idAberto = computed(() => numero('id') ?? null)
const { data: aberto, isError: erroAberto, error: detalheErro } = useLancamento(idAberto)

function abrir(id: number) {
  atualizar({ id })
}

function fecharPainel() {
  atualizar({ id: undefined })
}

// ---------- exportação ----------

const exportar = useExportarLancamentos()
const exportando = ref(false)

async function exportarCsv() {
  exportando.value = true
  try {
    const n = await exportar(filtrosApi.value, `lancamentos-${hoje()}.csv`)
    toast.sucesso(`${n.toLocaleString('pt-BR')} lançamento(s) exportado(s)`)
  } catch (e) {
    toast.erro(e instanceof ApiError ? e.message : 'Não foi possível exportar.')
  } finally {
    exportando.value = false
  }
}
</script>

<template>
  <div
    class="flex min-h-full flex-col transition-[padding] duration-200"
    :class="idAberto !== null ? 'com-painel' : ''"
  >
    <PageHeader
      titulo="Histórico"
      subtitulo="Todos os lançamentos, com filtro, busca e exportação."
      :contagem="lista?.total"
    >
      <template #acoes>
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="exportando || !lista?.total"
          @click="exportarCsv"
        >
          <Loader2 v-if="exportando" :size="15" class="animate-spin" />
          <Download v-else :size="15" />
          Exportar
        </button>
        <NuxtLink v-if="canEdit" to="/lancamentos/novo" class="btn btn-primary">
          <Plus :size="16" /> Novo lançamento
        </NuxtLink>
      </template>
    </PageHeader>

    <!-- abas -->
    <div class="border-t border-line px-5 pt-2 sm:px-6">
      <div class="tabs" role="tablist" aria-label="Situação">
        <button
          v-for="a in ABAS"
          :key="a.valor"
          type="button"
          role="tab"
          class="tab"
          :aria-selected="aba === a.valor"
          @click="atualizar({ aba: a.valor === 'todos' ? undefined : a.valor })"
        >
          {{ a.rotulo }}
        </button>
      </div>
    </div>

    <!-- barra de ferramentas: busca, período e filtros numa linha, acima do que eles filtram -->
    <div class="flex flex-wrap items-center gap-2 px-5 py-3 sm:px-6">
      <label class="relative w-full sm:w-72">
        <span class="sr-only">Buscar</span>
        <Search
          :size="15"
          class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ghost"
        />
        <input
          v-model="busca"
          type="search"
          class="input input-sm pl-9"
          placeholder="Descrição, fornecedor, CNPJ ou código"
          autocomplete="off"
        />
      </label>

      <select
        class="input input-sm w-auto"
        aria-label="Período"
        :value="periodo"
        @change="mudarPeriodo"
      >
        <option v-for="p in PERIODOS" :key="p.valor" :value="p.valor">{{ p.rotulo }}</option>
      </select>

      <template v-if="periodo === 'personalizado'">
        <input
          type="date"
          class="input input-sm tnum w-auto"
          aria-label="De"
          :value="texto('de')"
          @change="atualizar({ de: ($event.target as HTMLInputElement).value })"
        />
        <span class="text-[12.5px] text-faint">até</span>
        <input
          type="date"
          class="input input-sm tnum w-auto"
          aria-label="Até"
          :value="texto('ate')"
          @change="atualizar({ ate: ($event.target as HTMLInputElement).value })"
        />
      </template>

      <button
        type="button"
        class="btn btn-sm btn-secondary"
        :aria-expanded="mostrarFiltros"
        @click="mostrarFiltros = !mostrarFiltros"
      >
        <SlidersHorizontal :size="14" />
        Filtros
        <span v-if="chips.length" class="count !bg-accent !text-white">{{ chips.length }}</span>
      </button>

      <button v-if="temFiltro" type="button" class="btn btn-sm btn-ghost" @click="limparFiltros()">
        Limpar
      </button>
    </div>

    <div
      v-if="mostrarFiltros"
      class="grid gap-3 border-t border-line bg-surface-alt px-5 py-4 sm:grid-cols-3 sm:px-6 xl:grid-cols-5"
    >
      <label v-for="f in FILTROS" :key="f.chave" class="flex flex-col gap-1.5">
        <span class="label">{{ f.rotulo }}</span>
        <select
          class="input input-sm"
          :value="numero(f.chave) ?? ''"
          @change="atualizar({ [f.chave]: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">Todos</option>
          <option v-for="o in opcoesDe(f.chave)" :key="o.id" :value="o.id">{{ o.nome }}</option>
        </select>
      </label>
    </div>

    <div v-if="chips.length && !mostrarFiltros" class="flex flex-wrap gap-2 px-5 pb-3 sm:px-6">
      <span v-for="c in chips" :key="c.chave" class="chip">
        <span class="text-faint">{{ c.rotulo }}:</span> {{ c.nome }}
        <button
          type="button"
          class="flex size-5 items-center justify-center rounded-full text-faint hover:bg-sunken hover:text-ink"
          :aria-label="`Remover filtro ${c.rotulo}`"
          @click="atualizar({ [c.chave]: undefined })"
        >
          <X :size="12" />
        </button>
      </span>
    </div>

    <!-- tabela -->
    <div
      class="flex-1 overflow-x-auto border-t border-line transition-opacity"
      :class="isFetching && !isPending ? 'opacity-60' : ''"
    >
      <div v-if="isError" class="px-6 py-10 text-center text-[13px]">
        <p class="text-ink">Não foi possível carregar os lançamentos.</p>
        <p class="mt-1 text-muted">{{ error?.message }}</p>
        <button type="button" class="btn btn-sm btn-secondary mt-3" @click="refetch()">
          Tentar de novo
        </button>
      </div>

      <table v-else class="table stack-table min-w-[880px]">
        <thead>
          <tr>
            <th class="w-[108px]">Data</th>
            <th>Descrição</th>
            <th class="col-opcional">Categoria</th>
            <th class="col-opcional">Empreendimento</th>
            <th class="col-opcional">Pagamento</th>
            <th class="text-right">Valor</th>
            <th class="w-[170px]">Situação</th>
          </tr>
        </thead>
        <tbody>
          <template v-if="isPending">
            <tr v-for="n in 8" :key="n">
              <td><div class="skeleton h-3.5 w-20" /></td>
              <td>
                <div class="skeleton h-3.5 w-56" />
                <div class="skeleton mt-1.5 h-3 w-32" />
              </td>
              <td><div class="skeleton h-3.5 w-24" /></td>
              <td><div class="skeleton h-3.5 w-24" /></td>
              <td><div class="skeleton h-3.5 w-20" /></td>
              <td><div class="skeleton ml-auto h-3.5 w-20" /></td>
              <td><div class="skeleton h-5 w-24" /></td>
            </tr>
          </template>

          <template v-else>
            <tr
              v-for="l in lista?.itens"
              :key="l.id"
              class="row-link"
              :data-selected="l.id === idAberto"
              tabindex="0"
              @click="abrir(l.id)"
              @keydown.enter="abrir(l.id)"
            >
              <td data-label="Data" class="tnum whitespace-nowrap text-muted">
                {{ data(l.dataGasto) }}
              </td>
              <td data-titulo>
                <div class="max-w-[380px]">
                  <div
                    class="truncate font-medium text-ink"
                    :class="l.situacao === 'cancelado' && 'text-faint line-through'"
                  >
                    {{ l.descricao }}
                  </div>
                  <div
                    v-if="l.fornecedor || l.codigoIdentificacao"
                    class="truncate text-[12px] text-faint"
                  >
                    {{ [l.fornecedor?.nome, l.codigoIdentificacao].filter(Boolean).join(' · ') }}
                  </div>
                </div>
              </td>
              <td data-label="Categoria" class="col-opcional text-muted">
                <div class="max-w-[180px] truncate">{{ l.categoria?.nome ?? '—' }}</div>
              </td>
              <td data-label="Empreendimento" class="col-opcional text-muted">
                <div class="max-w-[180px] truncate">{{ l.empreendimento?.nome ?? '—' }}</div>
              </td>
              <td data-label="Pagamento" class="col-opcional whitespace-nowrap text-muted">
                {{ l.formaPagamento?.nome ?? '—' }}
                <div v-if="l.cartao" class="truncate text-[12px] text-faint">
                  {{ l.cartao.nome }}
                </div>
              </td>
              <td data-label="Valor" class="tnum text-right font-medium whitespace-nowrap text-ink">
                {{ reais(l.valorCentavos) }}
              </td>
              <td data-label="Situação">
                <div class="flex flex-col items-start gap-0.5">
                  <PagamentoBadge
                    :situacao="l.situacao === 'cancelado' ? 'cancelado' : l.pagamento.situacao"
                  />
                  <span
                    v-if="l.situacao === 'ativo' && l.pagamento.proximoVencimento"
                    class="tnum text-[11.5px] whitespace-nowrap text-faint"
                  >
                    vence {{ dataCurta(l.pagamento.proximoVencimento) }}
                    <template v-if="l.pagamento.parcelas > 1">
                      · {{ l.pagamento.pagas }}/{{ l.pagamento.parcelas }}</template
                    >
                  </span>
                </div>
              </td>
            </tr>

            <tr v-if="!lista?.itens.length">
              <td colspan="7">
                <EmptyState
                  v-if="temFiltro || aba !== 'todos'"
                  :icone="Search"
                  titulo="Nenhum lançamento neste filtro"
                  texto="Tente outro período, outra aba ou limpe os filtros."
                >
                  <button type="button" class="btn btn-secondary" @click="limparFiltros(true)">
                    Limpar filtros
                  </button>
                </EmptyState>
                <EmptyState
                  v-else
                  :icone="ReceiptText"
                  titulo="Nenhum gasto registrado ainda"
                  texto="Cartão, boleto, Pix ou reembolso: todo gasto entra pelo mesmo formulário."
                >
                  <NuxtLink v-if="canEdit" to="/lancamentos/novo" class="btn btn-primary">
                    <Plus :size="16" /> Registrar o primeiro
                  </NuxtLink>
                </EmptyState>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- rodapé: posição e soma do filtro -->
    <footer
      v-if="lista?.total"
      class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-5 py-3 text-[12.5px] text-muted backdrop-blur sm:px-6"
    >
      <div class="tnum">
        {{ inicio.toLocaleString('pt-BR') }}–{{ fim.toLocaleString('pt-BR') }} de
        {{ lista.total.toLocaleString('pt-BR') }}
        <span class="mx-1.5 text-ghost">·</span>
        soma <span class="font-semibold text-ink">{{ reais(lista.somaCentavos) }}</span>
        <template v-if="lista.emAbertoCentavos">
          <span class="mx-1.5 text-ghost">·</span>
          em aberto <span class="font-semibold text-ink">{{ reais(lista.emAbertoCentavos) }}</span>
        </template>
      </div>
      <div v-if="totalPaginas > 1" class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-sm btn-secondary"
          :disabled="pagina <= 1"
          @click="atualizar({ pagina: pagina - 1 > 1 ? pagina - 1 : undefined })"
        >
          Anterior
        </button>
        <span class="tnum">{{ pagina }} / {{ totalPaginas }}</span>
        <button
          type="button"
          class="btn btn-sm btn-secondary"
          :disabled="pagina >= totalPaginas"
          @click="atualizar({ pagina: pagina + 1 })"
        >
          Próxima
        </button>
      </div>
    </footer>

    <SidePanel
      :open="idAberto !== null"
      :titulo="`Lançamento #${idAberto ?? ''}`"
      @fechar="fecharPainel"
    >
      <template #acoes>
        <NuxtLink
          :to="`/lancamentos/${idAberto}`"
          class="btn-icon"
          title="Abrir em página inteira"
          aria-label="Abrir em página inteira"
        >
          <Maximize2 :size="15" />
        </NuxtLink>
      </template>

      <LancamentoDetalhe v-if="aberto && aberto.id === idAberto" :lancamento="aberto" />
      <div v-else-if="erroAberto" class="px-5 py-10 text-center text-[13px] text-muted">
        {{ detalheErro?.message ?? 'Lançamento não encontrado' }}
      </div>
      <div v-else class="flex flex-col gap-3 p-5">
        <div class="skeleton h-5 w-24" />
        <div class="skeleton h-5 w-3/4" />
        <div class="skeleton h-4 w-1/2" />
        <div class="skeleton mt-2 h-8 w-40" />
      </div>
    </SidePanel>
  </div>
</template>
