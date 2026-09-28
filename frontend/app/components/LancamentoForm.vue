<script setup lang="ts">
import { CircleAlert, Loader2, TriangleAlert } from 'lucide-vue-next'
import {
  criarLancamentoSchema,
  gerarParcelas,
  hoje,
  lancamentoSchema,
  somarMeses,
  type Fornecedor,
  type LancamentoDetalhe,
  type PossivelDuplicado,
  type RespostaDuplicidade,
} from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { opcoesAtivas, useCadastros, useFornecedores } from '~/composables/useCadastros'
import { data, reais } from '~/composables/useFormat'
import { useSincronizarLancamento } from '~/composables/useLancamentos'

/*
  Formulário único de lançamento, para criar e para editar.

  A validação roda duas vezes com o mesmo esquema: aqui, antes de enviar,
  para apontar o campo na hora; e na API, que é quem manda. O erro que vier de
  lá (cadastro desativado, pagamento no futuro) cai no mesmo lugar do campo.
*/
const props = defineProps<{ inicial?: LancamentoDetalhe | null }>()
const emit = defineEmits<{ salvo: [LancamentoDetalhe]; cancelar: [] }>()

const editando = computed(() => !!props.inicial)
const { user } = useAuth()
const { data: cadastros } = useCadastros()
const { data: fornecedores } = useFornecedores()
const api = useApi()
const sincronizar = useSincronizarLancamento()

interface ParcelaForm {
  valorCentavos: number | null
  vencimento: string
  pagoEm: string | null
}

const form = reactive({
  setorId: null as number | null,
  descricao: '',
  valorCentavos: null as number | null,
  dataGasto: hoje(),
  categoriaId: null as number | null,
  formaPagamentoId: null as number | null,
  empreendimentoId: null as number | null,
  fornecedorId: null as number | null,
  campanhaId: null as number | null,
  codigoIdentificacao: '',
  observacao: '',
})
const quantidade = ref(1)
const primeiroVencimento = ref(hoje())
/** Enquanto a pessoa não mexe no vencimento, ele acompanha a data do gasto. */
const vencimentoTocado = ref(false)
const parcelas = ref<ParcelaForm[]>([{ valorCentavos: null, vencimento: hoje(), pagoEm: null }])

function preencher(l: LancamentoDetalhe) {
  Object.assign(form, {
    setorId: l.setor.id,
    descricao: l.descricao,
    valorCentavos: l.valorCentavos,
    dataGasto: l.dataGasto,
    categoriaId: l.categoria.id,
    formaPagamentoId: l.formaPagamento.id,
    empreendimentoId: l.empreendimento.id,
    fornecedorId: l.fornecedor.id,
    campanhaId: l.campanha?.id ?? null,
    codigoIdentificacao: l.codigoIdentificacao ?? '',
    observacao: l.observacao ?? '',
  })
  quantidade.value = l.parcelas.length
  primeiroVencimento.value = l.parcelas[0]?.vencimento ?? l.dataGasto
  vencimentoTocado.value = true
  parcelas.value = l.parcelas.map((p) => ({
    valorCentavos: p.valorCentavos,
    vencimento: p.vencimento,
    pagoEm: p.pagoEm,
  }))
}

watch(
  () => props.inicial,
  (l) => {
    if (l) preencher(l)
  },
  { immediate: true },
)

// Setor padrão: o primeiro que a pessoa enxerga (hoje, na prática, o Marketing).
watch(
  cadastros,
  (c) => {
    if (form.setorId === null && c?.setores.length) {
      form.setorId = user.value?.setores[0]?.id ?? c.setores[0]!.id
    }
  },
  { immediate: true },
)

/**
 * Refaz as parcelas a partir do total, da quantidade e do 1º vencimento. As
 * datas de pagamento já marcadas ficam onde estavam.
 */
function regenerar() {
  const pagos = parcelas.value.map((p) => p.pagoEm)
  const n = Math.min(60, Math.max(1, Math.floor(quantidade.value) || 1))
  const novas: Array<{ valorCentavos: number | null; vencimento: string }> = form.valorCentavos
    ? gerarParcelas(form.valorCentavos, n, primeiroVencimento.value)
    : Array.from({ length: n }, (_, i) => ({
        valorCentavos: null,
        vencimento: somarMeses(primeiroVencimento.value, i),
      }))
  parcelas.value = novas.map((p, i) => ({ ...p, pagoEm: pagos[i] ?? null }))
}

function aoMudarTotal(valor: number | null) {
  form.valorCentavos = valor
  regenerar()
}

function aoMudarQuantidade() {
  quantidade.value = Math.min(60, Math.max(1, Math.floor(quantidade.value) || 1))
  regenerar()
}

function aoMudarPrimeiroVencimento() {
  vencimentoTocado.value = true
  regenerar()
}

function aoMudarDataGasto() {
  if (vencimentoTocado.value || !form.dataGasto) return
  primeiroVencimento.value = form.dataGasto
  regenerar()
}

/** À vista: "já foi pago" marca o pagamento na data do gasto (ou hoje, se o gasto é futuro). */
const jaPago = computed({
  get: () => !!parcelas.value[0]?.pagoEm,
  set: (marcado: boolean) => {
    const primeira = parcelas.value[0]
    if (!primeira) return
    const dia = hoje()
    primeira.pagoEm = marcado
      ? form.dataGasto && form.dataGasto <= dia
        ? form.dataGasto
        : dia
      : null
  },
})

const pagoEmUnica = computed({
  get: () => parcelas.value[0]?.pagoEm ?? '',
  set: (valor: string) => {
    const primeira = parcelas.value[0]
    if (primeira) primeira.pagoEm = valor || null
  },
})

// ---------- listas ----------

const setores = computed(() => cadastros.value?.setores ?? [])
const categorias = computed(() =>
  opcoesAtivas(
    cadastros.value?.categorias.filter((c) => c.setorId === form.setorId),
    form.categoriaId,
  ),
)
const campanhas = computed(() =>
  opcoesAtivas(
    cadastros.value?.campanhas.filter((c) => c.setorId === form.setorId),
    form.campanhaId,
  ),
)
const formas = computed(() => opcoesAtivas(cadastros.value?.formasPagamento, form.formaPagamentoId))
const empreendimentos = computed(() =>
  opcoesAtivas(cadastros.value?.empreendimentos, form.empreendimentoId),
)
const categoriaEscolhida = computed(() =>
  cadastros.value?.categorias.find((c) => c.id === form.categoriaId),
)

const nome = (lista: Array<{ id: number; nome: string }> | undefined, id: number | null) =>
  lista?.find((i) => i.id === id)?.nome ?? '—'

// ---------- resumo ----------

const somaParcelas = computed(() =>
  parcelas.value.reduce((total, p) => total + (p.valorCentavos ?? 0), 0),
)
const diferenca = computed(() => (form.valorCentavos ?? 0) - somaParcelas.value)

const textoParcelas = computed(() => {
  const primeira = parcelas.value[0]
  if (!primeira) return ''
  if (parcelas.value.length === 1) {
    return primeira.pagoEm
      ? `À vista · pago em ${data(primeira.pagoEm)}`
      : `À vista · vence em ${data(primeira.vencimento)}`
  }
  const pagas = parcelas.value.filter((p) => p.pagoEm).length
  return `${parcelas.value.length}× · 1ª em ${data(primeira.vencimento)}${pagas ? ` · ${pagas} paga(s)` : ''}`
})

// ---------- fornecedor novo ----------

const modalFornecedor = ref(false)
const nomeFornecedor = ref('')

function abrirNovoFornecedor(nomeSugerido: string) {
  nomeFornecedor.value = nomeSugerido
  modalFornecedor.value = true
}

function aoCriarFornecedor(fornecedor: Fornecedor) {
  form.fornecedorId = fornecedor.id
  modalFornecedor.value = false
}

// ---------- gravar ----------

const erros = ref<Record<string, string>>({})
const erroGeral = ref<string | null>(null)
const duplicados = ref<PossivelDuplicado[] | null>(null)
const salvando = ref(false)

const erro = (campo: string): string | undefined => erros.value[campo]

async function focarPrimeiroErro() {
  await nextTick()
  document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

async function salvar(confirmarDuplicidade = false) {
  erroGeral.value = null
  const payload = {
    ...form,
    parcelas: parcelas.value.map((p) => ({
      valorCentavos: p.valorCentavos,
      vencimento: p.vencimento,
      pagoEm: p.pagoEm || null,
    })),
    ...(editando.value ? {} : { confirmarDuplicidade }),
  }

  const resultado = (editando.value ? lancamentoSchema : criarLancamentoSchema).safeParse(payload)
  if (!resultado.success) {
    const saida: Record<string, string> = {}
    for (const issue of resultado.error.issues)
      saida[issue.path.map(String).join('.')] ??= issue.message
    erros.value = saida
    erroGeral.value = 'Confira os campos destacados.'
    await focarPrimeiroErro()
    return
  }

  erros.value = {}
  salvando.value = true
  try {
    const detalhe = editando.value
      ? await api.put<LancamentoDetalhe>(`/lancamentos/${props.inicial!.id}`, resultado.data)
      : await api.post<LancamentoDetalhe>('/lancamentos', resultado.data)
    duplicados.value = null
    sincronizar(detalhe)
    emit('salvo', detalhe)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    const corpo = e.data as RespostaDuplicidade | null
    if (e.status === 409 && Array.isArray(corpo?.duplicados)) {
      duplicados.value = corpo.duplicados
      return
    }
    if (e.status === 400 && e.issues.length) {
      erros.value = e.porCampo
      await focarPrimeiroErro()
    }
    erroGeral.value = e.message
  } finally {
    salvando.value = false
  }
}
</script>

<template>
  <form
    class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"
    novalidate
    @submit.prevent="salvar()"
  >
    <div class="flex min-w-0 flex-col gap-5">
      <!-- O gasto -->
      <section class="card">
        <header class="border-b border-line px-5 py-3.5">
          <h2 class="text-[14px] font-semibold text-ink">O gasto</h2>
          <p class="hint">O que foi comprado ou contratado, de quem e quando.</p>
        </header>
        <div class="grid gap-4 p-5 sm:grid-cols-2">
          <FormField
            rotulo="Descrição"
            para="f-descricao"
            :erro="erro('descricao')"
            class="sm:col-span-2"
          >
            <input
              id="f-descricao"
              v-model="form.descricao"
              class="input"
              maxlength="300"
              placeholder="Ex.: Impulsionamento no Instagram — lançamento do residencial"
              :aria-invalid="!!erro('descricao') || undefined"
            />
          </FormField>

          <FormField rotulo="Valor total" para="f-valor" :erro="erro('valorCentavos')">
            <MoneyInput
              id="f-valor"
              :model-value="form.valorCentavos"
              :invalid="!!erro('valorCentavos')"
              @update:model-value="aoMudarTotal"
            />
          </FormField>

          <FormField
            rotulo="Data do gasto"
            para="f-data"
            :erro="erro('dataGasto')"
            dica="Define o mês em que o gasto entra nos totais."
          >
            <input
              id="f-data"
              v-model="form.dataGasto"
              type="date"
              class="input tnum"
              :aria-invalid="!!erro('dataGasto') || undefined"
              @change="aoMudarDataGasto"
            />
          </FormField>

          <FormField
            rotulo="Fornecedor"
            para="f-fornecedor"
            :erro="erro('fornecedorId')"
            dica="Quem prestou o serviço ou vendeu — não a operadora do cartão."
            class="sm:col-span-2"
          >
            <FornecedorPicker
              id="f-fornecedor"
              v-model="form.fornecedorId"
              :fornecedores="fornecedores ?? []"
              :invalid="!!erro('fornecedorId')"
              pode-criar
              @criar="abrirNovoFornecedor"
            />
          </FormField>

          <FormField
            rotulo="Código de identificação"
            para="f-codigo"
            opcional
            :erro="erro('codigoIdentificacao')"
            dica="Nº da nota, do boleto, do pedido ou da transação no cartão. Ajuda a achar duplicidade."
            class="sm:col-span-2"
          >
            <input
              id="f-codigo"
              v-model="form.codigoIdentificacao"
              class="input"
              maxlength="100"
              autocomplete="off"
            />
          </FormField>
        </div>
      </section>

      <!-- Classificação -->
      <section class="card">
        <header class="border-b border-line px-5 py-3.5">
          <h2 class="text-[14px] font-semibold text-ink">Classificação</h2>
          <p class="hint">
            É por aqui que o gasto aparece nos totais por categoria e empreendimento.
          </p>
        </header>
        <div class="grid gap-4 p-5 sm:grid-cols-2">
          <FormField
            v-if="setores.length > 1"
            rotulo="Setor"
            para="f-setor"
            :erro="erro('setorId')"
            class="sm:col-span-2"
          >
            <select
              id="f-setor"
              v-model="form.setorId"
              class="input"
              :aria-invalid="!!erro('setorId') || undefined"
            >
              <option v-for="s in setores" :key="s.id" :value="s.id">{{ s.nome }}</option>
            </select>
          </FormField>

          <FormField
            rotulo="Categoria"
            para="f-categoria"
            :erro="erro('categoriaId')"
            :dica="categoriaEscolhida?.descricao ?? undefined"
          >
            <select
              id="f-categoria"
              v-model="form.categoriaId"
              class="input [&>option]:text-ink"
              :class="{ 'text-ghost': form.categoriaId === null }"
              :aria-invalid="!!erro('categoriaId') || undefined"
            >
              <option :value="null" disabled>Escolha a categoria</option>
              <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
            </select>
          </FormField>

          <FormField rotulo="Empreendimento" para="f-emp" :erro="erro('empreendimentoId')">
            <select
              id="f-emp"
              v-model="form.empreendimentoId"
              class="input [&>option]:text-ink"
              :class="{ 'text-ghost': form.empreendimentoId === null }"
              :aria-invalid="!!erro('empreendimentoId') || undefined"
            >
              <option :value="null" disabled>Escolha o empreendimento</option>
              <option v-for="e in empreendimentos" :key="e.id" :value="e.id">{{ e.nome }}</option>
            </select>
          </FormField>

          <FormField
            rotulo="Campanha"
            para="f-campanha"
            opcional
            :erro="erro('campanhaId')"
            class="sm:col-span-2"
          >
            <select id="f-campanha" v-model="form.campanhaId" class="input">
              <option :value="null">Sem campanha</option>
              <option v-for="c in campanhas" :key="c.id" :value="c.id">{{ c.nome }}</option>
            </select>
          </FormField>
        </div>
      </section>

      <!-- Pagamento -->
      <section class="card">
        <header class="border-b border-line px-5 py-3.5">
          <h2 class="text-[14px] font-semibold text-ink">Pagamento</h2>
          <p class="hint">
            Como e quando o gasto é pago. Parcelado no cartão? Informe as parcelas.
          </p>
        </header>
        <div class="grid gap-4 p-5 sm:grid-cols-3">
          <FormField
            rotulo="Forma de pagamento"
            para="f-forma"
            :erro="erro('formaPagamentoId')"
            class="sm:col-span-3"
          >
            <select
              id="f-forma"
              v-model="form.formaPagamentoId"
              class="input [&>option]:text-ink"
              :class="{ 'text-ghost': form.formaPagamentoId === null }"
              :aria-invalid="!!erro('formaPagamentoId') || undefined"
            >
              <option :value="null" disabled>Escolha a forma de pagamento</option>
              <option v-for="f in formas" :key="f.id" :value="f.id">{{ f.nome }}</option>
            </select>
          </FormField>

          <FormField rotulo="Parcelas" para="f-qtd">
            <input
              id="f-qtd"
              v-model.number="quantidade"
              type="number"
              min="1"
              max="60"
              class="input tnum"
              @change="aoMudarQuantidade"
            />
          </FormField>

          <FormField
            :rotulo="quantidade > 1 ? '1º vencimento' : 'Vencimento'"
            para="f-venc"
            :erro="erro('parcelas.0.vencimento')"
          >
            <input
              id="f-venc"
              v-model="primeiroVencimento"
              type="date"
              class="input tnum"
              :aria-invalid="!!erro('parcelas.0.vencimento') || undefined"
              @change="aoMudarPrimeiroVencimento"
            />
          </FormField>

          <!-- À vista: marcar o pagamento direto -->
          <div v-if="parcelas.length === 1" class="flex flex-col justify-end gap-1.5">
            <label class="flex h-9 items-center gap-2 text-[13px] text-ink">
              <input v-model="jaPago" type="checkbox" class="size-4" />
              Já foi pago
            </label>
          </div>
          <FormField
            v-if="parcelas.length === 1 && jaPago"
            rotulo="Pago em"
            para="f-pago"
            :erro="erro('parcelas.0.pagoEm')"
            class="sm:col-start-3"
          >
            <input
              id="f-pago"
              v-model="pagoEmUnica"
              type="date"
              class="input tnum"
              :aria-invalid="!!erro('parcelas.0.pagoEm') || undefined"
            />
          </FormField>
        </div>

        <!-- Parcelado: uma linha por parcela -->
        <div v-if="parcelas.length > 1" class="border-t border-line">
          <table class="table">
            <thead>
              <tr>
                <th class="w-12">Nº</th>
                <th>Vencimento</th>
                <th class="text-right">Valor</th>
                <th>Pago em</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in parcelas" :key="i">
                <td class="tnum text-muted">{{ i + 1 }}</td>
                <td>
                  <input
                    v-model="p.vencimento"
                    type="date"
                    class="input input-sm tnum max-w-[170px]"
                    :aria-label="`Vencimento da parcela ${i + 1}`"
                    :aria-invalid="!!erro(`parcelas.${i}.vencimento`) || undefined"
                  />
                </td>
                <td>
                  <MoneyInput
                    v-model="p.valorCentavos"
                    compacto
                    class="ml-auto max-w-[160px]"
                    :invalid="!!erro(`parcelas.${i}.valorCentavos`)"
                  />
                </td>
                <td>
                  <input
                    v-model="p.pagoEm"
                    type="date"
                    class="input input-sm tnum max-w-[170px]"
                    :aria-label="`Pagamento da parcela ${i + 1}`"
                    :aria-invalid="!!erro(`parcelas.${i}.pagoEm`) || undefined"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p
          v-if="erro('parcelas')"
          class="mx-5 mb-4 flex items-center gap-1.5 text-[12px] text-neg"
          :class="parcelas.length > 1 ? 'mt-3' : ''"
        >
          <CircleAlert :size="14" /> {{ erro('parcelas') }}
        </p>
      </section>

      <!-- Observação -->
      <section class="card p-5">
        <FormField rotulo="Observação" para="f-obs" opcional :erro="erro('observacao')">
          <textarea
            id="f-obs"
            v-model="form.observacao"
            class="input"
            maxlength="2000"
            placeholder="Contexto que ajuda quem consultar depois: aprovação, negociação, pendência…"
          />
        </FormField>
      </section>
    </div>

    <!-- Resumo e ações -->
    <aside class="flex flex-col gap-4 xl:sticky xl:top-5">
      <div
        v-if="duplicados?.length"
        class="rounded-xl border border-warn/30 bg-warn-soft p-4"
        role="alert"
      >
        <div class="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <TriangleAlert :size="16" class="text-warn" /> Possível duplicidade
        </div>
        <p class="mt-1 text-[12.5px] text-muted">
          Já existe gasto parecido com este fornecedor. Confira se não é o mesmo.
        </p>
        <ul class="mt-3 flex flex-col gap-1.5">
          <li v-for="d in duplicados" :key="d.id" class="text-[12.5px]">
            <NuxtLink
              :to="`/lancamentos/${d.id}`"
              target="_blank"
              class="font-medium text-accent-text hover:underline"
              >#{{ d.id }}</NuxtLink
            >
            <span class="text-muted">
              · {{ data(d.dataGasto) }} · {{ reais(d.valorCentavos) }}</span
            >
            <div class="truncate text-faint">{{ d.descricao }}</div>
          </li>
        </ul>
        <div class="mt-3 flex gap-2">
          <button
            type="button"
            class="btn btn-sm btn-secondary"
            :disabled="salvando"
            @click="salvar(true)"
          >
            Salvar mesmo assim
          </button>
          <button type="button" class="btn btn-sm btn-ghost" @click="duplicados = null">
            Revisar
          </button>
        </div>
      </div>

      <div class="card p-5">
        <div class="eyebrow">Resumo</div>
        <div class="mt-2 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          {{ reais(form.valorCentavos ?? 0) }}
        </div>
        <div class="mt-0.5 text-[12.5px] text-muted">{{ textoParcelas }}</div>

        <dl class="mt-4 flex flex-col gap-2.5 border-t border-line pt-4 text-[12.5px]">
          <div class="flex justify-between gap-3">
            <dt class="text-faint">Fornecedor</dt>
            <dd class="truncate text-right text-ink">
              {{ nome(fornecedores, form.fornecedorId) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-faint">Categoria</dt>
            <dd class="truncate text-right text-ink">
              {{ nome(cadastros?.categorias, form.categoriaId) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-faint">Empreendimento</dt>
            <dd class="truncate text-right text-ink">
              {{ nome(cadastros?.empreendimentos, form.empreendimentoId) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-faint">Pagamento</dt>
            <dd class="truncate text-right text-ink">
              {{ nome(cadastros?.formasPagamento, form.formaPagamentoId) }}
            </dd>
          </div>
        </dl>

        <p
          v-if="form.valorCentavos && diferenca !== 0"
          class="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-ink"
        >
          As parcelas somam {{ reais(somaParcelas) }}: {{ diferenca > 0 ? 'faltam' : 'sobram' }}
          {{ reais(Math.abs(diferenca)) }}.
        </p>

        <p
          v-if="erroGeral && !duplicados?.length"
          class="mt-4 rounded-lg bg-neg-soft px-3 py-2 text-[12px] text-ink"
          role="alert"
        >
          {{ erroGeral }}
        </p>

        <div class="mt-5 flex flex-col gap-2">
          <button type="submit" class="btn btn-primary w-full" :disabled="salvando">
            <Loader2 v-if="salvando" :size="15" class="animate-spin" />
            {{ editando ? 'Salvar alterações' : 'Registrar lançamento' }}
          </button>
          <button type="button" class="btn btn-secondary w-full" @click="emit('cancelar')">
            Cancelar
          </button>
        </div>
      </div>
    </aside>

    <NovoFornecedorModal
      :open="modalFornecedor"
      :nome-inicial="nomeFornecedor"
      @fechar="modalFornecedor = false"
      @criado="aoCriarFornecedor"
    />
  </form>
</template>
