<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { Loader2 } from 'lucide-vue-next'
import { hoje, recargaSchema, type Cartao } from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { useToast } from '~/composables/useToast'

/** Registro de dinheiro que entrou num cartão de recarga avulsa: valor e dia quaisquer. */
const props = defineProps<{ open: boolean; cartao: Cartao | null }>()
const emit = defineEmits<{ fechar: [] }>()

const api = useApi()
const qc = useQueryClient()
const toast = useToast()

const campos = reactive({
  data: '',
  valorCentavos: null as number | null,
  observacao: '',
})
const erros = ref<Record<string, string>>({})
const erroGeral = ref<string | null>(null)
const salvando = ref(false)
const hojeSp = ref(hoje())

watch(
  () => props.open,
  (aberto) => {
    if (!aberto) return
    hojeSp.value = hoje()
    Object.assign(campos, { data: hojeSp.value, valorCentavos: null, observacao: '' })
    erros.value = {}
    erroGeral.value = null
  },
)

async function salvar() {
  if (!props.cartao) return
  erroGeral.value = null
  const r = recargaSchema.safeParse({ ...campos, cartaoId: props.cartao.id })
  if (!r.success) {
    const saida: Record<string, string> = {}
    for (const i of r.error.issues) saida[i.path.map(String).join('.')] ??= i.message
    erros.value = saida
    return
  }
  if (r.data.data > hojeSp.value) {
    erros.value = { data: 'A recarga não pode ter data no futuro' }
    return
  }
  erros.value = {}
  salvando.value = true
  try {
    await api.post('/recargas', r.data)
    await qc.invalidateQueries({ queryKey: ['cadastros'] })
    void qc.invalidateQueries({ queryKey: ['cartoes-situacao'] })
    toast.sucesso('Recarga registrada')
    emit('fechar')
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    if (e.status === 400) erros.value = e.porCampo
    erroGeral.value = e.message
  } finally {
    salvando.value = false
  }
}
</script>

<template>
  <ModalDialog
    :open="open"
    titulo="Registrar recarga"
    :descricao="`Dinheiro que entrou no ${cartao?.nome ?? 'cartão'}. Some ao saldo do cartão na data informada.`"
    largura="440px"
    @fechar="emit('fechar')"
  >
    <form id="form-recarga" class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="salvar">
      <FormField rotulo="Valor" para="recarga-valor" :erro="erros.valorCentavos">
        <MoneyInput
          id="recarga-valor"
          v-model="campos.valorCentavos"
          :invalid="!!erros.valorCentavos"
        />
      </FormField>
      <FormField rotulo="Data" para="recarga-data" :erro="erros.data">
        <input
          id="recarga-data"
          v-model="campos.data"
          type="date"
          min="2000-01-01"
          :max="hojeSp"
          class="input tnum"
          :aria-invalid="!!erros.data || undefined"
        />
      </FormField>
      <FormField
        rotulo="Observação"
        para="recarga-obs"
        opcional
        :erro="erros.observacao"
        class="sm:col-span-2"
      >
        <input
          id="recarga-obs"
          v-model="campos.observacao"
          class="input"
          maxlength="200"
          placeholder="Ex.: recarga automática do banco"
        />
      </FormField>

      <p
        v-if="erroGeral"
        class="rounded-lg border border-neg/20 bg-neg-soft px-3 py-2 text-[12.5px] text-ink sm:col-span-2"
      >
        {{ erroGeral }}
      </p>
    </form>

    <template #rodape>
      <button type="button" class="btn btn-secondary" @click="emit('fechar')">Cancelar</button>
      <button type="submit" form="form-recarga" class="btn btn-primary" :disabled="salvando">
        <Loader2 v-if="salvando" :size="15" class="animate-spin" />
        Registrar recarga
      </button>
    </template>
  </ModalDialog>
</template>
