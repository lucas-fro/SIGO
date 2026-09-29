<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { Check, Loader2 } from 'lucide-vue-next'
import {
  hoje,
  somarMeses,
  type Cartao,
  type FixosLancados,
  type ResultadoLancarFixos,
} from '#contracts'
import { ApiError, useApi, useApiQuery } from '~/composables/useApi'
import { nomeMes, reais } from '~/composables/useFormat'
import { invalidarTotais } from '~/composables/useLancamentos'
import { useToast } from '~/composables/useToast'

/**
 * Lança de uma vez os gastos fixos ativos do cartão num mês. Os que já têm
 * lançamento naquele mês aparecem marcados e ficam de fora, então repetir não
 * duplica.
 */
const props = defineProps<{ open: boolean; cartao: Cartao | null }>()
const emit = defineEmits<{ fechar: [] }>()

const api = useApi()
const qc = useQueryClient()
const toast = useToast()

const meses = computed(() =>
  [-1, 0, 1].map((m) => {
    const mes = somarMeses(hoje(), m).slice(0, 7)
    const nome = nomeMes(mes)
    return {
      valor: mes,
      rotulo: `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${mes.slice(0, 4)}`,
    }
  }),
)
const mes = ref(hoje().slice(0, 7))
const erro = ref<string | null>(null)
const lancando = ref(false)

watch(
  () => props.open,
  (aberto) => {
    if (!aberto) return
    mes.value = hoje().slice(0, 7)
    erro.value = null
  },
)

const { data: jaLancados, isFetching: conferindo } = useApiQuery<FixosLancados>(
  'fixos-lancados',
  '/lancamentos/fixos-lancados',
  () => ({ cartaoId: props.cartao?.id, mes: mes.value }),
  { enabled: () => props.open && !!props.cartao },
)
const lancado = (id: number) => jaLancados.value?.gastoFixoIds.includes(id) ?? false

const fixos = computed(() => props.cartao?.gastosFixos.filter((f) => f.ativo) ?? [])
const pendentes = computed(() => fixos.value.filter((f) => !lancado(f.id)))
const totalPendente = computed(() => pendentes.value.reduce((t, f) => t + f.valorCentavos, 0))
const rotuloMes = computed(
  () => meses.value.find((m) => m.valor === mes.value)?.rotulo ?? mes.value,
)

async function lancar() {
  if (!props.cartao) return
  erro.value = null
  lancando.value = true
  try {
    const r = await api.post<ResultadoLancarFixos>('/lancamentos/lancar-fixos', {
      cartaoId: props.cartao.id,
      mes: mes.value,
    })
    invalidarTotais(qc)
    void qc.invalidateQueries({ queryKey: ['fixos-lancados'] })
    const partes = [
      r.criados.length === 1
        ? `1 gasto fixo lançado em ${rotuloMes.value.toLowerCase()}`
        : `${r.criados.length} gastos fixos lançados em ${rotuloMes.value.toLowerCase()}`,
    ]
    if (r.jaLancados) partes.push(`${r.jaLancados} já estava(m) lançado(s)`)
    toast.sucesso(partes.join('; '), {
      rotulo: 'Ver no histórico',
      to: `/historico?cartaoId=${props.cartao.id}`,
    })
    emit('fechar')
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    erro.value = e.message
  } finally {
    lancando.value = false
  }
}
</script>

<template>
  <ModalDialog
    :open="open"
    :titulo="`Lançar gastos fixos — ${cartao?.nome ?? ''}`"
    descricao="Cada gasto fixo vira um lançamento no mês escolhido, no dia da cobrança. O que já tiver lançamento nesse mês fica de fora."
    largura="520px"
    @fechar="emit('fechar')"
  >
    <div class="flex flex-col gap-4">
      <div class="seg w-full sm:w-auto" role="group" aria-label="Mês">
        <button
          v-for="m in meses"
          :key="m.valor"
          type="button"
          :aria-pressed="mes === m.valor"
          @click="mes = m.valor"
        >
          {{ m.rotulo }}
        </button>
      </div>

      <ul
        class="divide-y divide-line-soft rounded-lg border border-line transition-opacity"
        :class="conferindo ? 'opacity-60' : ''"
      >
        <li
          v-for="f in fixos"
          :key="f.id"
          class="flex items-center gap-3 px-3 py-2 text-[13px]"
          :class="lancado(f.id) ? 'text-faint' : ''"
        >
          <span class="tnum w-12 shrink-0 text-faint">dia {{ f.diaCobranca }}</span>
          <span class="min-w-0 flex-1 truncate" :class="lancado(f.id) ? '' : 'text-ink'">{{
            f.descricao
          }}</span>
          <span v-if="lancado(f.id)" class="badge shrink-0">
            <Check :size="12" :stroke-width="2.5" class="text-pos" /> Já lançado
          </span>
          <span class="tnum shrink-0" :class="lancado(f.id) ? 'line-through' : 'text-ink'">{{
            reais(f.valorCentavos)
          }}</span>
        </li>
        <li class="flex items-center justify-between bg-surface-alt px-3 py-2 text-[13px]">
          <span class="text-muted">
            {{ pendentes.length }} a lançar
            <template v-if="fixos.length !== pendentes.length"> de {{ fixos.length }} </template>
          </span>
          <span class="tnum font-semibold text-ink">{{ reais(totalPendente) }}</span>
        </li>
      </ul>

      <p
        v-if="erro"
        class="rounded-lg border border-neg/20 bg-neg-soft px-3 py-2 text-[12.5px] text-ink"
      >
        {{ erro }}
      </p>
    </div>

    <template #rodape>
      <button type="button" class="btn btn-secondary" @click="emit('fechar')">
        {{ pendentes.length ? 'Cancelar' : 'Fechar' }}
      </button>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="lancando || conferindo || !pendentes.length"
        @click="lancar"
      >
        <Loader2 v-if="lancando" :size="15" class="animate-spin" />
        {{
          pendentes.length
            ? `Lançar ${pendentes.length} em ${rotuloMes.toLowerCase()}`
            : 'Tudo lançado neste mês'
        }}
      </button>
    </template>
  </ModalDialog>
</template>
