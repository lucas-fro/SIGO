<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { Loader2 } from 'lucide-vue-next'
import { fornecedorSchema, formatarDocumento, type Fornecedor } from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'

const props = defineProps<{ open: boolean; nomeInicial?: string; documentoInicial?: string }>()
const emit = defineEmits<{ fechar: []; criado: [Fornecedor] }>()

const api = useApi()
const qc = useQueryClient()

const nome = ref('')
const documento = ref('')
const erros = ref<Record<string, string>>({})
const erroGeral = ref<string | null>(null)
/** Com documento repetido a API devolve o fornecedor que já existe, para oferecer "usar este". */
const existente = ref<Fornecedor | null>(null)
const salvando = ref(false)

watch(
  () => props.open,
  (aberto) => {
    if (!aberto) return
    nome.value = props.nomeInicial ?? ''
    // Vindo da leitura de um comprovante, o CNPJ já chega preenchido.
    documento.value = props.documentoInicial ? formatarDocumento(props.documentoInicial) : ''
    erros.value = {}
    erroGeral.value = null
    existente.value = null
  },
)

async function salvar() {
  erroGeral.value = null
  existente.value = null
  const r = fornecedorSchema.safeParse({ nome: nome.value, documento: documento.value })
  if (!r.success) {
    erros.value = Object.fromEntries(
      r.error.issues.map((i) => [i.path.map(String).join('.'), i.message]),
    )
    return
  }
  erros.value = {}
  salvando.value = true
  try {
    const novo = await api.post<Fornecedor>('/fornecedores', r.data)
    await qc.invalidateQueries({ queryKey: ['fornecedores'] })
    emit('criado', novo)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    const dado = e.data as { fornecedor?: Fornecedor } | null
    if (e.status === 409 && dado?.fornecedor) existente.value = dado.fornecedor
    else if (e.status === 400) erros.value = e.porCampo
    erroGeral.value = e.message
  } finally {
    salvando.value = false
  }
}
</script>

<template>
  <ModalDialog
    :open="open"
    titulo="Cadastrar fornecedor"
    descricao="Quem prestou o serviço ou vendeu. Se pagou pelo cartão, é a loja — não a operadora do cartão."
    @fechar="emit('fechar')"
  >
    <form id="form-fornecedor" class="flex flex-col gap-4" novalidate @submit.prevent="salvar">
      <FormField rotulo="Nome" para="forn-nome" :erro="erros.nome">
        <input
          id="forn-nome"
          v-model="nome"
          class="input"
          maxlength="120"
          autocomplete="off"
          :aria-invalid="!!erros.nome || undefined"
        />
      </FormField>
      <FormField
        rotulo="CPF ou CNPJ"
        para="forn-doc"
        opcional
        :erro="erros.documento"
        dica="Aceita o CNPJ novo, com letras. Vale preencher: é por ele que o gasto casa com o título no Sienge."
      >
        <input
          id="forn-doc"
          v-model="documento"
          class="input tnum"
          maxlength="20"
          autocomplete="off"
          placeholder="00.000.000/0000-00"
          :aria-invalid="!!erros.documento || undefined"
        />
      </FormField>

      <div
        v-if="erroGeral"
        class="rounded-lg border border-neg/25 bg-neg-soft px-3 py-2.5 text-[12.5px] text-ink"
      >
        {{ erroGeral }}
        <button
          v-if="existente"
          type="button"
          class="mt-2 flex font-semibold text-accent-text hover:underline"
          @click="emit('criado', existente)"
        >
          Usar {{ existente.nome }} ({{ formatarDocumento(existente.documento) }})
        </button>
      </div>
    </form>

    <template #rodape>
      <button type="button" class="btn btn-secondary" @click="emit('fechar')">Cancelar</button>
      <button type="submit" form="form-fornecedor" class="btn btn-primary" :disabled="salvando">
        <Loader2 v-if="salvando" :size="15" class="animate-spin" />
        Cadastrar
      </button>
    </template>
  </ModalDialog>
</template>
