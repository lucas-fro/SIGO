<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { CircleAlert, Loader2, RefreshCw } from 'lucide-vue-next'
import type { StatusConferencia } from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { dataHora } from '~/composables/useFormat'
import { invalidarTotais, useConferenciaSienge } from '~/composables/useLancamentos'
import { useToast } from '~/composables/useToast'

/*
  Uma linha sobre a conferência de pagamentos com o Sienge, nas abas de
  parcelas em aberto do Histórico: quando foi a última, o que ela marcou,
  quando é a próxima e o que ela não conseguiu resolver sozinha. O admin
  pode pedir uma conferência na hora.
*/
const { isAdmin } = useAuth()
const api = useApi()
const qc = useQueryClient()
const toast = useToast()
const { data: status } = useConferenciaSienge()

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

// Terminou uma conferência: lista, totais e o detalhe aberto mudam.
watch(
  () => status.value?.andamento,
  (agora, antes) => {
    if (antes && !agora) {
      invalidarTotais(qc)
      void qc.invalidateQueries({ queryKey: ['lancamento'] })
    }
  },
)

const resumo = computed(() => {
  const s = status.value
  const u = s?.ultima
  if (!s || !u || u.situacao === 'andamento') return null
  if (u.situacao === 'erro') return null
  const pagas =
    u.pagas === 0
      ? 'nenhuma parcela nova paga'
      : u.pagas === 1
        ? '1 parcela marcada como paga'
        : `${u.pagas} parcelas marcadas como pagas`
  return `Pagamentos conferidos no Sienge em ${dataHora(u.fim ?? u.inicio)}: ${pagas}.`
})

const pendencias = computed(() => {
  const d = status.value?.ultima?.detalhe
  if (!d) return ''
  const partes: string[] = []
  // `?? 0`: a última conferência pode ser de antes deste campo existir.
  const semDados = d.semDados ?? 0
  if (semDados) {
    partes.push(
      semDados === 1
        ? '1 lançamento não tem como ser achado no Sienge (falta o CNPJ do fornecedor cadastrado lá, o nome dele ou o número da nota)'
        : `${semDados} lançamentos não têm como ser achados no Sienge (falta o CNPJ do fornecedor cadastrado lá, o nome dele ou o número da nota)`,
    )
  }
  if (d.ambiguos.length) {
    partes.push(
      d.ambiguos.length === 1
        ? '1 tem mais de um título possível no Sienge'
        : `${d.ambiguos.length} têm mais de um título possível no Sienge`,
    )
  }
  const semDinheiro = d.pagasSemMovimento?.length ?? 0
  if (semDinheiro) {
    partes.push(
      semDinheiro === 1
        ? '1 parcela aparece paga no Sienge sem pagamento no extrato (substituída ou renegociada?) e ficou para conferir à mão'
        : `${semDinheiro} parcelas aparecem pagas no Sienge sem pagamento no extrato (substituídas ou renegociadas?) e ficaram para conferir à mão`,
    )
  }
  const falhas = d.falhas?.length ?? 0
  if (falhas) {
    partes.push(
      falhas === 1
        ? '1 consulta ao Sienge falhou e fica para a próxima'
        : `${falhas} consultas ao Sienge falharam e ficam para a próxima`,
    )
  }
  return partes.length ? `${partes.join('; ')}.` : ''
})

const pedindo = ref(false)

async function conferirAgora() {
  pedindo.value = true
  try {
    const novo = await api.post<StatusConferencia>('/sienge/conferencia')
    qc.setQueryData(['sienge-conferencia', '/sienge/conferencia', {}], novo)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    toast.erro(e.message)
  } finally {
    pedindo.value = false
  }
}
</script>

<template>
  <div
    v-if="status?.ligada"
    class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted"
    aria-live="polite"
  >
    <template v-if="status.andamento">
      <Loader2 :size="14" class="animate-spin text-faint" />
      <span>Conferindo os pagamentos no Sienge…</span>
    </template>
    <template v-else>
      <template v-if="status.ultima?.situacao === 'erro'">
        <CircleAlert :size="14" class="text-warn" />
        <span class="text-ink">
          A conferência com o Sienge de {{ dataHora(status.ultima.inicio) }} falhou:
          {{ status.ultima.erro }}.
        </span>
      </template>
      <span v-else-if="resumo">{{ resumo }}</span>
      <span v-else>
        Os pagamentos são conferidos no Sienge às {{ status.horarios.join(' e às ') }}.
      </span>
      <span v-if="pendencias" class="text-faint">{{ pendencias }}</span>
      <span v-if="status.proxima" class="text-faint">Próxima às {{ hora(status.proxima) }}.</span>
      <button
        v-if="isAdmin"
        type="button"
        class="btn btn-sm btn-ghost"
        :disabled="pedindo"
        @click="conferirAgora"
      >
        <RefreshCw :size="13" /> Conferir agora
      </button>
    </template>
  </div>
</template>
