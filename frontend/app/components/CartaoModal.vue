<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { Loader2 } from 'lucide-vue-next'
import { cartaoSchema, editarCartaoSchema, type Cartao } from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { opcoesAtivas, useCadastros } from '~/composables/useCadastros'
import { paraDia } from '~/composables/useFormat'
import { useToast } from '~/composables/useToast'

/** Cadastro e edição de cartão: nome, forma, orçamento do mês e dias da fatura. */
const props = defineProps<{ open: boolean; cartao?: Cartao | null }>()
const emit = defineEmits<{ fechar: [] }>()

const { data: cadastros } = useCadastros()
const api = useApi()
const qc = useQueryClient()
const toast = useToast()

const editando = computed(() => !!props.cartao)
const setores = computed(() => cadastros.value?.setores ?? [])
/** Só as formas marcadas como cartão servem (a atual continua, mesmo desativada). */
const formas = computed(() =>
  opcoesAtivas(
    cadastros.value?.formasPagamento.filter((f) => f.cartao),
    props.cartao?.formaPagamentoId,
  ),
)

const campos = reactive({
  setorId: null as number | null,
  nome: '',
  final: '',
  formaPagamentoId: null as number | null,
  orcamentoMensalCentavos: null as number | null,
  diaFechamento: '' as string | number,
  diaVencimento: '' as string | number,
})
const erros = ref<Record<string, string>>({})
const erroGeral = ref<string | null>(null)
const salvando = ref(false)

watch(
  () => props.open,
  (aberto) => {
    if (!aberto) return
    const c = props.cartao
    Object.assign(campos, {
      setorId: c?.setorId ?? setores.value[0]?.id ?? null,
      nome: c?.nome ?? '',
      final: c?.final ?? '',
      formaPagamentoId:
        c?.formaPagamentoId ?? (formas.value.length === 1 ? formas.value[0]!.id : null),
      orcamentoMensalCentavos: c?.orcamentoMensalCentavos ?? null,
      diaFechamento: c?.diaFechamento ? String(c.diaFechamento) : '',
      diaVencimento: c?.diaVencimento ? String(c.diaVencimento) : '',
    })
    erros.value = {}
    erroGeral.value = null
  },
)

async function salvar() {
  erroGeral.value = null
  const dados = {
    nome: campos.nome,
    final: campos.final,
    formaPagamentoId: campos.formaPagamentoId,
    orcamentoMensalCentavos: campos.orcamentoMensalCentavos ?? 0,
    diaFechamento: paraDia(campos.diaFechamento),
    diaVencimento: paraDia(campos.diaVencimento),
  }
  const r = editando.value
    ? editarCartaoSchema.safeParse(dados)
    : cartaoSchema.safeParse({ ...dados, setorId: campos.setorId })
  if (!r.success) {
    const saida: Record<string, string> = {}
    for (const i of r.error.issues) saida[i.path.map(String).join('.')] ??= i.message
    erros.value = saida
    return
  }
  erros.value = {}
  salvando.value = true
  try {
    if (editando.value) await api.patch(`/cartoes/${props.cartao!.id}`, r.data)
    else await api.post('/cartoes', r.data)
    await qc.invalidateQueries({ queryKey: ['cadastros'] })
    void qc.invalidateQueries({ queryKey: ['painel'] })
    toast.sucesso(
      editando.value ? 'Cartão atualizado' : `Cartão “${campos.nome.trim()}” cadastrado`,
    )
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
    :titulo="editando ? 'Editar cartão' : 'Novo cartão'"
    descricao="O orçamento vale por mês. Com o fechamento e o vencimento da fatura, cada compra no cartão já nasce com o vencimento certo."
    largura="520px"
    @fechar="emit('fechar')"
  >
    <form id="form-cartao" class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="salvar">
      <FormField
        v-if="!editando && setores.length > 1"
        rotulo="Setor"
        para="cartao-setor"
        :erro="erros.setorId"
        class="sm:col-span-2"
      >
        <select id="cartao-setor" v-model="campos.setorId" class="input">
          <option v-for="s in setores" :key="s.id" :value="s.id">{{ s.nome }}</option>
        </select>
      </FormField>

      <FormField rotulo="Nome" para="cartao-nome" :erro="erros.nome" class="sm:col-span-2">
        <input
          id="cartao-nome"
          v-model="campos.nome"
          class="input"
          maxlength="120"
          placeholder="Ex.: Cartão Marketing"
          :aria-invalid="!!erros.nome || undefined"
        />
      </FormField>

      <FormField rotulo="Forma de pagamento" para="cartao-forma" :erro="erros.formaPagamentoId">
        <select
          id="cartao-forma"
          v-model="campos.formaPagamentoId"
          class="input"
          :aria-invalid="!!erros.formaPagamentoId || undefined"
        >
          <option :value="null" disabled>Escolha</option>
          <option v-for="f in formas" :key="f.id" :value="f.id">{{ f.nome }}</option>
        </select>
      </FormField>

      <FormField rotulo="Final" para="cartao-final" opcional :erro="erros.final">
        <input
          id="cartao-final"
          v-model="campos.final"
          class="input tnum"
          inputmode="numeric"
          maxlength="4"
          placeholder="4 últimos dígitos"
          :aria-invalid="!!erros.final || undefined"
        />
      </FormField>

      <FormField
        rotulo="Orçamento do mês"
        para="cartao-orcamento"
        :erro="erros.orcamentoMensalCentavos"
        class="sm:col-span-2"
      >
        <MoneyInput
          id="cartao-orcamento"
          v-model="campos.orcamentoMensalCentavos"
          :invalid="!!erros.orcamentoMensalCentavos"
        />
      </FormField>

      <FormField
        rotulo="Fatura fecha no dia"
        para="cartao-fecha"
        opcional
        :erro="erros.diaFechamento"
      >
        <input
          id="cartao-fecha"
          v-model="campos.diaFechamento"
          type="number"
          min="1"
          max="31"
          class="input tnum"
          :aria-invalid="!!erros.diaFechamento || undefined"
        />
      </FormField>
      <FormField
        rotulo="Fatura vence no dia"
        para="cartao-vence"
        opcional
        :erro="erros.diaVencimento"
        dica="Pré-pago: deixe os dois em branco."
      >
        <input
          id="cartao-vence"
          v-model="campos.diaVencimento"
          type="number"
          min="1"
          max="31"
          class="input tnum"
          :aria-invalid="!!erros.diaVencimento || undefined"
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
      <button type="submit" form="form-cartao" class="btn btn-primary" :disabled="salvando">
        <Loader2 v-if="salvando" :size="15" class="animate-spin" />
        {{ editando ? 'Salvar' : 'Cadastrar cartão' }}
      </button>
    </template>
  </ModalDialog>
</template>
