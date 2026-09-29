<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { CalendarPlus, CreditCard, Pencil, Plus, Power, PowerOff } from 'lucide-vue-next'
import type { Cartao, GastoFixo } from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { useCadastros } from '~/composables/useCadastros'
import { reais } from '~/composables/useFormat'
import { usePainel } from '~/composables/useLancamentos'
import { useToast } from '~/composables/useToast'

/*
  Aba "Cartões e orçamento" dos cadastros: cada cartão com o orçamento do mês,
  a fatura e os gastos fixos que carrega. Cartão e orçamento são do admin;
  gasto fixo, de quem lança no setor (a API confere).
*/
const { isAdmin, canEdit } = useAuth()
const { data: cadastros, isPending } = useCadastros()
const { data: painel } = usePainel()
const api = useApi()
const qc = useQueryClient()
const toast = useToast()

const cartoes = computed(() => cadastros.value?.cartoes ?? [])
const nomeForma = (id: number) =>
  cadastros.value?.formasPagamento.find((f) => f.id === id)?.nome ?? ''
const fixosAtivos = (c: Cartao) => c.gastosFixos.filter((f) => f.ativo)
const totalFixos = (c: Cartao) => fixosAtivos(c).reduce((t, f) => t + f.valorCentavos, 0)
const situacaoDoMes = (c: Cartao) => painel.value?.cartoes.find((x) => x.id === c.id)

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

async function alternar(caminho: string, ativo: boolean, nome: string) {
  try {
    await api.patch(caminho, { ativo: !ativo })
    await qc.invalidateQueries({ queryKey: ['cadastros'] })
    void qc.invalidateQueries({ queryKey: ['painel'] })
    toast.sucesso(`“${nome}” ${ativo ? 'desativado' : 'reativado'}`)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    toast.erro(e.message)
  }
}
</script>

<template>
  <div class="px-5 py-5 sm:px-6">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="max-w-2xl text-[13px] text-muted">
        Cada cartão tem um orçamento por mês. Os gastos fixos (assinaturas, ferramentas) já contam
        como comprometidos desde o início do mês e viram lançamento pelo botão
        <span class="font-medium text-ink">Lançar gastos fixos</span>.
      </p>
      <button v-if="isAdmin" type="button" class="btn btn-primary btn-sm" @click="novoCartao">
        <Plus :size="15" /> Novo cartão
      </button>
    </div>

    <div v-if="isPending" class="flex flex-col gap-4">
      <div v-for="n in 2" :key="n" class="skeleton h-40" />
    </div>

    <div v-else-if="!cartoes.length" class="card">
      <EmptyState
        :icone="CreditCard"
        titulo="Nenhum cartão cadastrado"
        texto="Cadastre o cartão do setor com o orçamento do mês e, se tiver, o fechamento e o vencimento da fatura."
      >
        <button v-if="isAdmin" type="button" class="btn btn-primary" @click="novoCartao">
          <Plus :size="16" /> Cadastrar cartão
        </button>
      </EmptyState>
    </div>

    <div v-else class="flex flex-col gap-4">
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
                <span class="badge">
                  <span class="size-1.5 rounded-full" :class="c.ativo ? 'bg-pos' : 'bg-ghost'" />
                  {{ c.ativo ? 'Ativo' : 'Inativo' }}
                </span>
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
                @click="alternar(`/cartoes/${c.id}`, c.ativo, c.nome)"
              >
                <PowerOff v-if="c.ativo" :size="13" />
                <Power v-else :size="13" />
                {{ c.ativo ? 'Desativar' : 'Reativar' }}
              </button>
            </template>
          </div>
        </header>

        <div class="grid gap-6 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <!-- orçamento -->
          <div>
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
              <div class="eyebrow mb-2">Situação neste mês</div>
              <OrcamentoCartao :cartao="situacaoDoMes(c)!" />
            </div>
          </div>

          <!-- gastos fixos -->
          <div>
            <div class="flex items-center justify-between gap-2">
              <div class="eyebrow">Gastos fixos</div>
              <button
                v-if="canEdit && c.ativo"
                type="button"
                class="btn btn-sm btn-ghost"
                @click="novoFixo(c)"
              >
                <Plus :size="14" /> Adicionar
              </button>
            </div>
            <p v-if="!c.gastosFixos.length" class="mt-3 text-[13px] text-faint">
              Nenhum gasto fixo neste cartão.
            </p>
            <ul v-else class="mt-1 divide-y divide-line-soft">
              <li
                v-for="f in c.gastosFixos"
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
                    :title="f.ativo ? 'Desativar' : 'Reativar'"
                    :aria-label="`${f.ativo ? 'Desativar' : 'Reativar'} ${f.descricao}`"
                    @click="alternar(`/gastos-fixos/${f.id}`, f.ativo, f.descricao)"
                  >
                    <PowerOff v-if="f.ativo" :size="14" />
                    <Power v-else :size="14" />
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>

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
