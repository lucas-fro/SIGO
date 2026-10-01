<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import {
  CalendarPlus,
  CreditCard,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
  X,
} from 'lucide-vue-next'
import { hoje, mesQuery, type Cartao, type GastoFixo, type RecargaCartao } from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { useCadastros } from '~/composables/useCadastros'
import { data, mesPorExtenso, reais } from '~/composables/useFormat'
import { useSituacaoCartoes } from '~/composables/useLancamentos'
import { useToast } from '~/composables/useToast'

/*
  Os cartões do setor: cada um com o orçamento do mês ou, no de recarga
  avulsa, o saldo e as recargas; a fatura; os gastos fixos que carrega; e a
  situação num mês (o corrente ou o escolhido no seletor). Cartão e orçamento
  são do admin; recarga e gasto fixo, de quem lança no setor (a API confere).
*/
definePageMeta({ title: 'Cartão' })

const { isAdmin, canEdit } = useAuth()
const route = useRoute()
const router = useRouter()
const { data: cadastros, isPending } = useCadastros()
const api = useApi()
const qc = useQueryClient()
const toast = useToast()

// ---------- mês da situação ----------

const mesCorrente = hoje().slice(0, 7)

/** Como no dashboard: o mês fica na URL (`?mes=AAAA-MM`); inválido ou futuro, vale o corrente. */
const mes = computed(() => {
  const q = route.query.mes
  return typeof q === 'string' && mesQuery.safeParse(q).success && q <= mesCorrente
    ? q
    : mesCorrente
})

function escolherMes(novo: string) {
  void router.replace({ query: { ...route.query, mes: novo === mesCorrente ? undefined : novo } })
}

const { data: situacao, isPlaceholderData: trocandoMes } = useSituacaoCartoes(mes)
// Os textos saem do mês dos dados, para baterem com os números na tela.
const mesDaSituacao = computed(() => situacao.value?.mes ?? mes.value)
const encerrado = computed(() => mesDaSituacao.value < (situacao.value?.hoje ?? hoje()).slice(0, 7))
const tituloSituacao = computed(
  () => `Situação em ${mesPorExtenso(mesDaSituacao.value).toLowerCase()}`,
)

const mostrarCartoesExcluidos = ref(false)
const mostrarFixosExcluidos = reactive<Record<number, boolean>>({})
const cartoesTodos = computed(() => cadastros.value?.cartoes ?? [])
const cartoes = computed(() =>
  cartoesTodos.value.filter((c) => c.ativo !== mostrarCartoesExcluidos.value),
)
const quantidadeCartoesExcluidos = computed(() => cartoesTodos.value.filter((c) => !c.ativo).length)
const nomeForma = (id: number) =>
  cadastros.value?.formasPagamento.find((f) => f.id === id)?.nome ?? ''
const fixosAtivos = (c: Cartao) => c.gastosFixos.filter((f) => f.ativo)
const fixosVisiveis = (c: Cartao) =>
  c.gastosFixos.filter((f) => f.ativo !== !!mostrarFixosExcluidos[c.id])
const quantidadeFixosExcluidos = (c: Cartao) => c.gastosFixos.filter((f) => !f.ativo).length
const totalFixos = (c: Cartao) => fixosAtivos(c).reduce((t, f) => t + f.valorCentavos, 0)
const situacaoDoMes = (c: Cartao) => situacao.value?.cartoes.find((x) => x.id === c.id)
/** Saldo de hoje do cartão de recarga avulsa, seja qual for o mês escolhido. */
const saldoAtual = (c: Cartao) =>
  situacao.value?.saldos.find((s) => s.cartaoId === c.id)?.centavos ?? null

function descricaoFatura(c: Cartao): string {
  return c.diaFechamento && c.diaVencimento
    ? `fatura fecha dia ${c.diaFechamento} e vence dia ${c.diaVencimento}`
    : 'sem fatura: o gasto sai pago na data da cobrança'
}

// ---------- modais ----------

const modalCartao = ref(false)
const cartaoEmEdicao = ref<Cartao | null>(null)
const modalFixo = ref(false)
const cartaoDoFixo = ref<Cartao | null>(null)
const fixoEmEdicao = ref<GastoFixo | null>(null)
const modalRecarga = ref(false)
const cartaoDaRecarga = ref<Cartao | null>(null)
const todasRecargas = reactive<Record<number, boolean>>({})
const recargasVisiveis = (c: Cartao) => (todasRecargas[c.id] ? c.recargas : c.recargas.slice(0, 5))
function novaRecarga(c: Cartao) {
  cartaoDaRecarga.value = c
  modalRecarga.value = true
}
async function removerRecarga(r: RecargaCartao) {
  if (!confirm(`Tirar a recarga de ${reais(r.valorCentavos)} de ${data(r.data)} do saldo?`)) return
  try {
    await api.post(`/recargas/${r.id}/remover`, {})
    await qc.invalidateQueries({ queryKey: ['cadastros'] })
    void qc.invalidateQueries({ queryKey: ['cartoes-situacao'] })
    toast.sucesso('Recarga retirada do saldo')
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    toast.erro(e.message)
  }
}

const modalLancar = ref(false)
const cartaoParaLancar = ref<Cartao | null>(null)

function novoCartao() {
  cartaoEmEdicao.value = null
  modalCartao.value = true
}
function editarCartao(c: Cartao) {
  cartaoEmEdicao.value = c
  modalCartao.value = true
}
function novoFixo(c: Cartao) {
  cartaoDoFixo.value = c
  fixoEmEdicao.value = null
  modalFixo.value = true
}
function editarFixo(c: Cartao, f: GastoFixo) {
  cartaoDoFixo.value = c
  fixoEmEdicao.value = f
  modalFixo.value = true
}
function lancarFixos(c: Cartao) {
  cartaoParaLancar.value = c
  modalLancar.value = true
}

async function alternarExclusao(caminho: string, ativo: boolean, nome: string) {
  try {
    await api.patch(caminho, { ativo: !ativo })
    await qc.invalidateQueries({ queryKey: ['cadastros'] })
    void qc.invalidateQueries({ queryKey: ['cartoes-situacao'] })
    toast.sucesso(`“${nome}” ${ativo ? 'excluído' : 'restaurado'}`)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    toast.erro(e.message)
  }
}
</script>

<template>
  <div class="pb-8">
    <PageHeader
      titulo="Cartão"
      subtitulo="Orçamento ou recargas, fatura e gastos fixos de cada cartão. O gasto fixo conta como comprometido desde o início do mês e vira lançamento pelo botão Lançar gastos fixos."
    >
      <template #acoes>
        <button
          v-if="quantidadeCartoesExcluidos || mostrarCartoesExcluidos"
          type="button"
          class="btn btn-ghost"
          @click="mostrarCartoesExcluidos = !mostrarCartoesExcluidos"
        >
          {{
            mostrarCartoesExcluidos
              ? 'Voltar aos cartões'
              : `Ver excluídos (${quantidadeCartoesExcluidos})`
          }}
        </button>
        <SeletorMes :model-value="mes" :max="mesCorrente" @update:model-value="escolherMes" />
        <button v-if="isAdmin" type="button" class="btn btn-primary" @click="novoCartao">
          <Plus :size="16" /> Novo cartão
        </button>
      </template>
    </PageHeader>

    <div v-if="isPending" class="flex flex-col gap-4 px-5 sm:px-6">
      <div v-for="n in 2" :key="n" class="skeleton h-40" />
    </div>

    <div v-else-if="!cartoes.length" class="card mx-5 sm:mx-6">
      <EmptyState
        :icone="CreditCard"
        :titulo="mostrarCartoesExcluidos ? 'Nenhum cartão excluído' : 'Nenhum cartão cadastrado'"
        :texto="
          mostrarCartoesExcluidos
            ? 'Os cartões excluídos aparecerão aqui para restauração.'
            : 'Cadastre o cartão do setor, com orçamento por mês ou de recarga avulsa e, se tiver, o fechamento e o vencimento da fatura.'
        "
      >
        <button
          v-if="isAdmin && !mostrarCartoesExcluidos"
          type="button"
          class="btn btn-primary"
          @click="novoCartao"
        >
          <Plus :size="16" /> Cadastrar cartão
        </button>
      </EmptyState>
    </div>

    <div
      v-else
      class="flex flex-col gap-4 px-5 transition-opacity duration-150 sm:px-6"
      :class="trocandoMes ? 'opacity-60' : ''"
      :aria-busy="trocandoMes || undefined"
    >
      <section
        v-for="c in cartoes"
        :key="c.id"
        class="card overflow-hidden"
        :class="!c.ativo && 'opacity-70'"
      >
        <header
          class="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4"
        >
          <div class="flex min-w-0 items-start gap-3">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text"
            >
              <CreditCard :size="19" />
            </span>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-[14.5px] font-semibold text-ink">{{ c.nome }}</h3>
                <span v-if="c.final" class="tnum text-[12.5px] text-faint">•••• {{ c.final }}</span>
              </div>
              <p class="mt-0.5 text-[12.5px] text-muted">
                {{ nomeForma(c.formaPagamentoId) }} · {{ descricaoFatura(c) }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-if="canEdit && c.ativo && fixosAtivos(c).length"
              type="button"
              class="btn btn-sm btn-secondary"
              @click="lancarFixos(c)"
            >
              <CalendarPlus :size="14" /> Lançar gastos fixos
            </button>
            <template v-if="isAdmin">
              <button type="button" class="btn btn-sm btn-ghost" @click="editarCartao(c)">
                <Pencil :size="13" /> Editar
              </button>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                @click="alternarExclusao(`/cartoes/${c.id}`, c.ativo, c.nome)"
              >
                <Trash2 v-if="c.ativo" :size="13" />
                <RotateCcw v-else :size="13" />
                {{ c.ativo ? 'Excluir' : 'Restaurar' }}
              </button>
            </template>
          </div>
        </header>

        <div class="grid gap-6 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <!-- recarga avulsa: saldo e recargas -->
          <div v-if="c.recarga === 'avulsa'">
            <div class="flex items-center justify-between gap-2">
              <div class="eyebrow">Saldo</div>
              <button
                v-if="canEdit && c.ativo"
                type="button"
                class="btn btn-sm btn-ghost"
                @click="novaRecarga(c)"
              >
                <Wallet :size="14" /> Registrar recarga
              </button>
            </div>
            <div
              class="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.02em]"
              :class="(saldoAtual(c) ?? 0) < 0 ? 'text-neg' : 'text-ink'"
            >
              {{ saldoAtual(c) === null ? '—' : reais(saldoAtual(c)) }}
            </div>
            <p class="mt-0.5 text-[12.5px] text-muted">
              Recargas somadas, menos o que foi lançado no cartão até hoje.
            </p>
            <div v-if="situacaoDoMes(c)" class="mt-4 rounded-lg bg-surface-alt p-3">
              <OrcamentoCartao
                :cartao="situacaoDoMes(c)!"
                :titulo="tituloSituacao"
                :encerrado="encerrado"
              />
            </div>
            <div class="eyebrow mt-4">Recargas</div>
            <p v-if="!c.recargas.length" class="mt-2 text-[13px] text-faint">
              Nenhuma recarga registrada.
            </p>
            <ul v-else class="mt-1 divide-y divide-line-soft">
              <li v-for="r in recargasVisiveis(c)" :key="r.id" class="flex items-center gap-3 py-2">
                <span class="tnum w-[84px] shrink-0 text-[12.5px] text-muted">{{
                  data(r.data)
                }}</span>
                <span class="min-w-0 flex-1 truncate text-[12.5px] text-faint">{{
                  r.observacao
                }}</span>
                <span class="tnum shrink-0 text-[13px] font-medium text-ink">{{
                  reais(r.valorCentavos)
                }}</span>
                <button
                  v-if="canEdit"
                  type="button"
                  class="btn-icon shrink-0"
                  title="Tirar do saldo"
                  :aria-label="`Tirar a recarga de ${data(r.data)} do saldo`"
                  @click="removerRecarga(r)"
                >
                  <X :size="14" />
                </button>
              </li>
            </ul>
            <button
              v-if="c.recargas.length > 5"
              type="button"
              class="btn btn-sm btn-ghost mt-1"
              @click="todasRecargas[c.id] = !todasRecargas[c.id]"
            >
              {{ todasRecargas[c.id] ? 'Mostrar menos' : `Ver todas (${c.recargas.length})` }}
            </button>
          </div>

          <!-- orçamento -->
          <div v-else>
            <div class="eyebrow">Orçamento do mês</div>
            <div class="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">
              {{ reais(c.orcamentoMensalCentavos) }}
            </div>
            <p class="mt-0.5 text-[12.5px] text-muted">
              Fixos <span class="tnum text-ink">{{ reais(totalFixos(c)) }}</span
              >/mês · livre para o resto
              <span class="tnum text-ink">{{
                reais(c.orcamentoMensalCentavos - totalFixos(c))
              }}</span>
            </p>
            <div v-if="situacaoDoMes(c)" class="mt-4 rounded-lg bg-surface-alt p-3">
              <OrcamentoCartao
                :cartao="situacaoDoMes(c)!"
                :titulo="tituloSituacao"
                :encerrado="encerrado"
              />
            </div>
          </div>

          <!-- gastos fixos -->
          <div>
            <div class="flex items-center justify-between gap-2">
              <div class="eyebrow">Gastos fixos</div>
              <div class="flex items-center gap-1.5">
                <button
                  v-if="quantidadeFixosExcluidos(c) || mostrarFixosExcluidos[c.id]"
                  type="button"
                  class="btn btn-sm btn-ghost"
                  @click="mostrarFixosExcluidos[c.id] = !mostrarFixosExcluidos[c.id]"
                >
                  {{
                    mostrarFixosExcluidos[c.id]
                      ? 'Voltar aos gastos fixos'
                      : `Excluídos (${quantidadeFixosExcluidos(c)})`
                  }}
                </button>
                <button
                  v-if="canEdit && c.ativo"
                  type="button"
                  class="btn btn-sm btn-ghost"
                  @click="novoFixo(c)"
                >
                  <Plus :size="14" /> Adicionar
                </button>
              </div>
            </div>
            <p v-if="!fixosVisiveis(c).length" class="mt-3 text-[13px] text-faint">
              {{
                mostrarFixosExcluidos[c.id]
                  ? 'Nenhum gasto fixo excluído.'
                  : 'Nenhum gasto fixo neste cartão.'
              }}
            </p>
            <ul v-else class="mt-1 divide-y divide-line-soft">
              <li
                v-for="f in fixosVisiveis(c)"
                :key="f.id"
                class="flex items-center gap-3 py-2.5"
                :class="!f.ativo && 'opacity-60'"
              >
                <span
                  class="flex size-9 shrink-0 flex-col items-center justify-center rounded-md bg-sunken leading-none"
                  :title="`Cobrado no dia ${f.diaCobranca}`"
                >
                  <span class="text-[9px] font-semibold tracking-wide text-faint">DIA</span>
                  <span class="tnum text-[13px] font-semibold text-ink">{{ f.diaCobranca }}</span>
                </span>
                <div class="min-w-0 flex-1">
                  <div
                    class="truncate text-[13px] font-medium"
                    :class="f.ativo ? 'text-ink' : 'text-faint line-through'"
                  >
                    {{ f.descricao }}
                  </div>
                  <div class="truncate text-[12px] text-faint">
                    {{ f.fornecedor.nome }} · {{ f.categoria.nome }}
                  </div>
                </div>
                <span class="tnum shrink-0 text-[13px] font-medium text-ink">{{
                  reais(f.valorCentavos)
                }}</span>
                <div v-if="canEdit" class="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    class="btn-icon"
                    title="Editar"
                    :aria-label="`Editar ${f.descricao}`"
                    @click="editarFixo(c, f)"
                  >
                    <Pencil :size="14" />
                  </button>
                  <button
                    type="button"
                    class="btn-icon"
                    :title="f.ativo ? 'Excluir' : 'Restaurar'"
                    :aria-label="`${f.ativo ? 'Excluir' : 'Restaurar'} ${f.descricao}`"
                    @click="alternarExclusao(`/gastos-fixos/${f.id}`, f.ativo, f.descricao)"
                  >
                    <Trash2 v-if="f.ativo" :size="14" />
                    <RotateCcw v-else :size="14" />
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>

    <RecargaModal :open="modalRecarga" :cartao="cartaoDaRecarga" @fechar="modalRecarga = false" />
    <CartaoModal :open="modalCartao" :cartao="cartaoEmEdicao" @fechar="modalCartao = false" />
    <GastoFixoModal
      :open="modalFixo"
      :cartao="cartaoDoFixo"
      :fixo="fixoEmEdicao"
      @fechar="modalFixo = false"
    />
    <LancarFixosModal
      :open="modalLancar"
      :cartao="cartaoParaLancar"
      @fechar="modalLancar = false"
    />
  </div>
</template>
