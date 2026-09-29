<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { Loader2 } from 'lucide-vue-next'
import {
  editarGastoFixoSchema,
  gastoFixoSchema,
  type Cartao,
  type Fornecedor,
  type GastoFixo,
} from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { opcoesAtivas, useCadastros, useFornecedores } from '~/composables/useCadastros'
import { paraDia } from '~/composables/useFormat'
import { useToast } from '~/composables/useToast'

/** Cadastro e edição de um gasto fixo do cartão. */
const props = defineProps<{ open: boolean; cartao: Cartao | null; fixo?: GastoFixo | null }>()
const emit = defineEmits<{ fechar: [] }>()

const { data: cadastros } = useCadastros()
const { data: fornecedores } = useFornecedores()
const api = useApi()
const qc = useQueryClient()
const toast = useToast()

const editando = computed(() => !!props.fixo)

const campos = reactive({
  descricao: '',
  valorCentavos: null as number | null,
  diaCobranca: '' as string | number,
  fornecedorId: null as number | null,
  categoriaId: null as number | null,
  empreendimentoId: null as number | null,
})
const erros = ref<Record<string, string>>({})
const erroGeral = ref<string | null>(null)
const salvando = ref(false)

const categorias = computed(() =>
  opcoesAtivas(
    cadastros.value?.categorias.filter((c) => c.setorId === props.cartao?.setorId),
    campos.categoriaId,
  ),
)
const empreendimentos = computed(() =>
  opcoesAtivas(cadastros.value?.empreendimentos, campos.empreendimentoId),
)

watch(
  () => props.open,
  (aberto) => {
    if (!aberto) return
    const f = props.fixo
    const institucional = cadastros.value?.empreendimentos.find((e) => e.institucional && e.ativo)
    Object.assign(campos, {
      descricao: f?.descricao ?? '',
      valorCentavos: f?.valorCentavos ?? null,
      diaCobranca: f ? String(f.diaCobranca) : '',
      fornecedorId: f?.fornecedor.id ?? null,
      categoriaId: f?.categoria.id ?? null,
      // Assinatura e ferramenta costumam ser da marca: "Institucional" já vem escolhido.
      empreendimentoId: f?.empreendimento.id ?? institucional?.id ?? null,
    })
    erros.value = {}
    erroGeral.value = null
  },
)

// Fornecedor novo sem sair do cadastro do gasto fixo.
const modalFornecedor = ref(false)
const nomeFornecedor = ref('')

function abrirNovoFornecedor(nome: string) {
  nomeFornecedor.value = nome
  modalFornecedor.value = true
}

function aoCriarFornecedor(fornecedor: Fornecedor) {
  campos.fornecedorId = fornecedor.id
  modalFornecedor.value = false
}

async function salvar() {
  if (!props.cartao) return
  erroGeral.value = null
  const dados = {
    descricao: campos.descricao,
    valorCentavos: campos.valorCentavos,
    diaCobranca: paraDia(campos.diaCobranca),
    fornecedorId: campos.fornecedorId,
    categoriaId: campos.categoriaId,
    empreendimentoId: campos.empreendimentoId,
  }
  const r = editando.value
    ? editarGastoFixoSchema.safeParse(dados)
    : gastoFixoSchema.safeParse({ ...dados, cartaoId: props.cartao.id })
  if (!r.success) {
    const saida: Record<string, string> = {}
    for (const i of r.error.issues) saida[i.path.map(String).join('.')] ??= i.message
    erros.value = saida
    return
  }
  erros.value = {}
  salvando.value = true
  try {
    if (editando.value) await api.patch(`/gastos-fixos/${props.fixo!.id}`, r.data)
    else await api.post('/gastos-fixos', r.data)
    await qc.invalidateQueries({ queryKey: ['cadastros'] })
    void qc.invalidateQueries({ queryKey: ['painel'] })
    toast.sucesso(editando.value ? 'Gasto fixo atualizado' : 'Gasto fixo adicionado')
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
    :titulo="editando ? 'Editar gasto fixo' : 'Novo gasto fixo'"
    :descricao="`${cartao?.nome ?? ''}: cobrança que se repete todo mês, como assinatura ou ferramenta.`"
    largura="560px"
    @fechar="emit('fechar')"
  >
    <form id="form-fixo" class="grid gap-4 sm:grid-cols-3" novalidate @submit.prevent="salvar">
      <FormField
        rotulo="Descrição"
        para="fixo-descricao"
        :erro="erros.descricao"
        class="sm:col-span-3"
      >
        <input
          id="fixo-descricao"
          v-model="campos.descricao"
          class="input"
          maxlength="200"
          placeholder="Ex.: Canva Pro"
          :aria-invalid="!!erros.descricao || undefined"
        />
      </FormField>

      <FormField
        rotulo="Valor por mês"
        para="fixo-valor"
        :erro="erros.valorCentavos"
        class="sm:col-span-2"
      >
        <MoneyInput
          id="fixo-valor"
          v-model="campos.valorCentavos"
          :invalid="!!erros.valorCentavos"
        />
      </FormField>
      <FormField rotulo="Dia da cobrança" para="fixo-dia" :erro="erros.diaCobranca">
        <input
          id="fixo-dia"
          v-model="campos.diaCobranca"
          type="number"
          min="1"
          max="31"
          class="input tnum"
          :aria-invalid="!!erros.diaCobranca || undefined"
        />
      </FormField>

      <FormField
        rotulo="Fornecedor"
        para="fixo-fornecedor"
        :erro="erros.fornecedorId"
        class="sm:col-span-3"
      >
        <FornecedorPicker
          id="fixo-fornecedor"
          v-model="campos.fornecedorId"
          :fornecedores="fornecedores ?? []"
          :invalid="!!erros.fornecedorId"
          pode-criar
          @criar="abrirNovoFornecedor"
        />
      </FormField>

      <FormField
        rotulo="Categoria"
        para="fixo-categoria"
        :erro="erros.categoriaId"
        class="sm:col-span-3 lg:col-span-1"
      >
        <select
          id="fixo-categoria"
          v-model="campos.categoriaId"
          class="input"
          :aria-invalid="!!erros.categoriaId || undefined"
        >
          <option :value="null" disabled>Escolha</option>
          <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
        </select>
      </FormField>
      <FormField
        rotulo="Empreendimento"
        para="fixo-emp"
        :erro="erros.empreendimentoId"
        class="sm:col-span-3 lg:col-span-2"
      >
        <select
          id="fixo-emp"
          v-model="campos.empreendimentoId"
          class="input"
          :aria-invalid="!!erros.empreendimentoId || undefined"
        >
          <option :value="null" disabled>Escolha</option>
          <option v-for="e in empreendimentos" :key="e.id" :value="e.id">{{ e.nome }}</option>
        </select>
      </FormField>

      <p
        v-if="erroGeral"
        class="rounded-lg border border-neg/20 bg-neg-soft px-3 py-2 text-[12.5px] text-ink sm:col-span-3"
      >
        {{ erroGeral }}
      </p>
    </form>

    <template #rodape>
      <button type="button" class="btn btn-secondary" @click="emit('fechar')">Cancelar</button>
      <button type="submit" form="form-fixo" class="btn btn-primary" :disabled="salvando">
        <Loader2 v-if="salvando" :size="15" class="animate-spin" />
        {{ editando ? 'Salvar' : 'Adicionar' }}
      </button>
    </template>
  </ModalDialog>

  <NovoFornecedorModal
    :open="modalFornecedor"
    :nome-inicial="nomeFornecedor"
    @fechar="modalFornecedor = false"
    @criado="aoCriarFornecedor"
  />
</template>
