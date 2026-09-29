<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { Check, Loader2, Pencil, Plus, Power, PowerOff, X } from 'lucide-vue-next'
import {
  editarFornecedorSchema,
  editarItemSchema,
  formatarDocumento,
  fornecedorSchema,
  novoItemSchema,
} from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { useCadastros, useFornecedores } from '~/composables/useCadastros'
import { useToast } from '~/composables/useToast'

definePageMeta({ title: 'Cadastros' })
useHead({ title: 'Cadastros · SIGO' })

const route = useRoute()
const router = useRouter()
const { isAdmin, canEdit } = useAuth()
const { data: cadastros, isPending } = useCadastros()
const { data: fornecedores, isPending: carregandoFornecedores } = useFornecedores()
const api = useApi()
const qc = useQueryClient()
const toast = useToast()

const LISTAS = [
  { valor: 'categorias', rotulo: 'Categorias', singular: 'categoria' },
  { valor: 'formas-pagamento', rotulo: 'Formas de pagamento', singular: 'forma de pagamento' },
  { valor: 'cartoes', rotulo: 'Cartões e orçamento', singular: 'cartão' },
  { valor: 'empreendimentos', rotulo: 'Empreendimentos', singular: 'empreendimento' },
  { valor: 'campanhas', rotulo: 'Campanhas', singular: 'campanha' },
  { valor: 'fornecedores', rotulo: 'Fornecedores', singular: 'fornecedor' },
] as const
type Lista = (typeof LISTAS)[number]['valor']

const lista = computed<Lista>(
  () => LISTAS.find((l) => l.valor === route.query.lista)?.valor ?? 'categorias',
)
const info = computed(() => LISTAS.find((l) => l.valor === lista.value)!)

function trocarLista(valor: Lista) {
  cancelarEdicao()
  erroNovo.value = null
  void router.replace({ query: valor === 'categorias' ? {} : { lista: valor } })
}

const setores = computed(() => cadastros.value?.setores ?? [])
const nomeSetor = (id: number) => setores.value.find((s) => s.id === id)?.nome ?? ''
const porSetor = computed(() => lista.value === 'categorias' || lista.value === 'campanhas')

interface Linha {
  id: number
  nome: string
  ativo: boolean
  descricao?: string | null
  documento?: string | null
  setor?: string
  institucional?: boolean
  cartao?: boolean
}

const linhas = computed<Linha[]>(() => {
  const c = cadastros.value
  switch (lista.value) {
    case 'categorias':
      return (c?.categorias ?? []).map((i) => ({ ...i, setor: nomeSetor(i.setorId) }))
    case 'formas-pagamento':
      return c?.formasPagamento ?? []
    case 'empreendimentos':
      return c?.empreendimentos ?? []
    case 'campanhas':
      return (c?.campanhas ?? []).map((i) => ({ ...i, setor: nomeSetor(i.setorId) }))
    case 'fornecedores':
      return fornecedores.value ?? []
    case 'cartoes':
      return []
  }
})

const carregando = computed(() =>
  lista.value === 'fornecedores' ? carregandoFornecedores.value : isPending.value,
)

/*
  Quem pode o quê (a API confere de novo): categorias, formas de pagamento e
  empreendimentos valem para todos e só o admin altera; campanha nasce no dia
  a dia do setor; fornecedor novo qualquer pessoa que lança pode cadastrar,
  mas corrigir ou desativar é do admin.
*/
const podeCriar = computed(() =>
  lista.value === 'campanhas' || lista.value === 'fornecedores' ? canEdit.value : isAdmin.value,
)
const podeAlterar = computed(() => (lista.value === 'campanhas' ? canEdit.value : isAdmin.value))

const invalidar = () =>
  qc.invalidateQueries({
    queryKey: [lista.value === 'fornecedores' ? 'fornecedores' : 'cadastros'],
  })

const mensagensPorCampo = (issues: Array<{ path: PropertyKey[]; message: string }>) =>
  issues.map((i) => i.message).join(' · ')

// ---------- novo item ----------

const novo = reactive({
  nome: '',
  descricao: '',
  documento: '',
  cartao: false,
  setorId: null as number | null,
})
const erroNovo = ref<string | null>(null)
const salvandoNovo = ref(false)

watch(
  setores,
  (lista) => {
    if (novo.setorId === null && lista.length) novo.setorId = lista[0]!.id
  },
  { immediate: true },
)

async function adicionar() {
  erroNovo.value = null
  const fornecedor = lista.value === 'fornecedores'
  const r = fornecedor
    ? fornecedorSchema.safeParse({ nome: novo.nome, documento: novo.documento })
    : novoItemSchema.safeParse({
        nome: novo.nome,
        descricao: lista.value === 'categorias' ? novo.descricao : undefined,
        cartao: lista.value === 'formas-pagamento' ? novo.cartao : undefined,
        setorId: porSetor.value ? (novo.setorId ?? undefined) : undefined,
      })
  if (!r.success) {
    erroNovo.value = mensagensPorCampo(r.error.issues)
    return
  }

  salvandoNovo.value = true
  try {
    await api.post(fornecedor ? '/fornecedores' : `/cadastros/${lista.value}`, r.data)
    await invalidar()
    toast.sucesso(
      `${info.value.singular[0]!.toUpperCase()}${info.value.singular.slice(1)} “${novo.nome.trim()}” cadastrado(a)`,
    )
    novo.nome = ''
    novo.descricao = ''
    novo.documento = ''
    novo.cartao = false
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    erroNovo.value = e.issues.length ? e.issues.map((i) => i.message).join(' · ') : e.message
  } finally {
    salvandoNovo.value = false
  }
}

// ---------- edição na linha ----------

const edicao = reactive({
  id: null as number | null,
  nome: '',
  descricao: '',
  documento: '',
  cartao: false,
})
const salvandoEdicao = ref(false)

function editar(linha: Linha) {
  edicao.id = linha.id
  edicao.nome = linha.nome
  edicao.descricao = linha.descricao ?? ''
  edicao.documento = linha.documento ? formatarDocumento(linha.documento) : ''
  edicao.cartao = !!linha.cartao
}

function cancelarEdicao() {
  edicao.id = null
}

async function salvarEdicao() {
  if (edicao.id === null) return
  const fornecedor = lista.value === 'fornecedores'
  const r = fornecedor
    ? editarFornecedorSchema.safeParse({ nome: edicao.nome, documento: edicao.documento })
    : editarItemSchema.safeParse({
        nome: edicao.nome,
        ...(lista.value === 'categorias' ? { descricao: edicao.descricao } : {}),
        ...(lista.value === 'formas-pagamento' ? { cartao: edicao.cartao } : {}),
      })
  if (!r.success) {
    toast.erro(mensagensPorCampo(r.error.issues))
    return
  }
  salvandoEdicao.value = true
  try {
    await api.patch(
      fornecedor ? `/fornecedores/${edicao.id}` : `/cadastros/${lista.value}/${edicao.id}`,
      r.data,
    )
    await invalidar()
    cancelarEdicao()
    toast.sucesso('Alteração salva')
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    toast.erro(e.issues.length ? e.issues.map((i) => i.message).join(' · ') : e.message)
  } finally {
    salvandoEdicao.value = false
  }
}

async function alternarAtivo(linha: Linha) {
  try {
    await api.patch(
      lista.value === 'fornecedores'
        ? `/fornecedores/${linha.id}`
        : `/cadastros/${lista.value}/${linha.id}`,
      { ativo: !linha.ativo },
    )
    await invalidar()
    toast.sucesso(`“${linha.nome}” ${linha.ativo ? 'desativado(a)' : 'reativado(a)'}`)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    toast.erro(e.message)
  }
}
</script>

<template>
  <div>
    <PageHeader
      titulo="Cadastros"
      subtitulo="As listas do formulário de lançamento. Nada é apagado: o que for desativado some das opções, mas continua nos lançamentos antigos."
    />

    <div class="px-5 sm:px-6">
      <div class="tabs" role="tablist" aria-label="Listas">
        <button
          v-for="l in LISTAS"
          :key="l.valor"
          type="button"
          role="tab"
          class="tab"
          :aria-selected="lista === l.valor"
          @click="trocarLista(l.valor)"
        >
          {{ l.rotulo }}
        </button>
      </div>
    </div>

    <CartoesCadastro v-if="lista === 'cartoes'" />

    <template v-else>
      <!-- novo item -->
      <form
        v-if="podeCriar"
        class="flex flex-wrap items-start gap-2 px-5 py-4 sm:px-6"
        novalidate
        @submit.prevent="adicionar"
      >
        <select
          v-if="porSetor && setores.length > 1"
          v-model="novo.setorId"
          class="input input-sm w-auto"
          aria-label="Setor"
        >
          <option v-for="s in setores" :key="s.id" :value="s.id">{{ s.nome }}</option>
        </select>
        <input
          v-model="novo.nome"
          class="input input-sm w-full sm:w-64"
          maxlength="120"
          :placeholder="`Nome da ${info.singular}`"
          :aria-label="`Nome da ${info.singular}`"
        />
        <input
          v-if="lista === 'categorias'"
          v-model="novo.descricao"
          class="input input-sm w-full sm:w-80"
          maxlength="300"
          placeholder="O que entra nela (aparece como ajuda no formulário)"
          aria-label="Descrição"
        />
        <input
          v-if="lista === 'fornecedores'"
          v-model="novo.documento"
          class="input input-sm tnum w-full sm:w-52"
          maxlength="20"
          placeholder="CPF ou CNPJ (opcional)"
          aria-label="CPF ou CNPJ"
        />
        <label
          v-if="lista === 'formas-pagamento'"
          class="flex h-8 items-center gap-2 px-1 text-[13px] text-ink"
          title="O lançamento com esta forma pede qual cartão, e a fatura dele define o vencimento"
        >
          <input v-model="novo.cartao" type="checkbox" class="size-4" />
          É cartão
        </label>
        <button type="submit" class="btn btn-sm btn-primary" :disabled="salvandoNovo">
          <Loader2 v-if="salvandoNovo" :size="14" class="animate-spin" />
          <Plus v-else :size="15" />
          Adicionar
        </button>
        <p v-if="erroNovo" class="error-text w-full">{{ erroNovo }}</p>
      </form>
      <p v-else class="px-5 py-4 text-[12.5px] text-faint sm:px-6">
        Só administradores alteram esta lista.
      </p>

      <!-- lista -->
      <div class="overflow-x-auto border-t border-line">
        <table class="table stack-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th v-if="lista === 'categorias'">Descrição</th>
              <th v-if="lista === 'fornecedores'">CPF / CNPJ</th>
              <th v-if="porSetor && setores.length > 1">Setor</th>
              <th class="w-[120px]">Situação</th>
              <th class="w-[210px] text-right"><span class="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            <template v-if="carregando">
              <tr v-for="n in 5" :key="n">
                <td colspan="5"><div class="skeleton h-3.5 w-48" /></td>
              </tr>
            </template>

            <template v-else>
              <tr v-for="linha in linhas" :key="linha.id">
                <!-- editando -->
                <template v-if="edicao.id === linha.id">
                  <td data-titulo>
                    <input
                      v-model="edicao.nome"
                      class="input input-sm"
                      maxlength="120"
                      aria-label="Nome"
                      @keydown.enter.prevent="salvarEdicao"
                      @keydown.esc="cancelarEdicao"
                    />
                  </td>
                  <td v-if="lista === 'categorias'" data-label="Descrição">
                    <input
                      v-model="edicao.descricao"
                      class="input input-sm"
                      maxlength="300"
                      aria-label="Descrição"
                    />
                  </td>
                  <td v-if="lista === 'fornecedores'" data-label="CPF / CNPJ">
                    <input
                      v-model="edicao.documento"
                      class="input input-sm tnum"
                      maxlength="20"
                      aria-label="CPF ou CNPJ"
                    />
                  </td>
                  <td v-if="porSetor && setores.length > 1" data-label="Setor" class="text-muted">
                    {{ linha.setor }}
                  </td>
                  <td>
                    <label
                      v-if="lista === 'formas-pagamento'"
                      class="flex items-center gap-2 text-[13px] text-ink"
                    >
                      <input v-model="edicao.cartao" type="checkbox" class="size-4" />
                      É cartão
                    </label>
                  </td>
                  <td class="text-right">
                    <div class="flex justify-end gap-1.5">
                      <button
                        type="button"
                        class="btn btn-sm btn-primary"
                        :disabled="salvandoEdicao"
                        @click="salvarEdicao"
                      >
                        <Check :size="14" /> Salvar
                      </button>
                      <button type="button" class="btn btn-sm btn-ghost" @click="cancelarEdicao">
                        <X :size="14" /> Cancelar
                      </button>
                    </div>
                  </td>
                </template>

                <!-- leitura -->
                <template v-else>
                  <td data-titulo>
                    <span class="font-medium" :class="linha.ativo ? 'text-ink' : 'text-faint'">{{
                      linha.nome
                    }}</span>
                    <span v-if="linha.institucional" class="badge ml-2">Institucional</span>
                    <span v-if="linha.cartao" class="badge ml-2">Cartão</span>
                  </td>
                  <td v-if="lista === 'categorias'" data-label="Descrição" class="text-muted">
                    <div class="max-w-[420px] truncate">{{ linha.descricao || '—' }}</div>
                  </td>
                  <td
                    v-if="lista === 'fornecedores'"
                    data-label="CPF / CNPJ"
                    class="tnum text-muted"
                  >
                    {{ linha.documento ? formatarDocumento(linha.documento) : '—' }}
                  </td>
                  <td v-if="porSetor && setores.length > 1" data-label="Setor" class="text-muted">
                    {{ linha.setor }}
                  </td>
                  <td data-label="Situação">
                    <span class="badge">
                      <span
                        class="size-1.5 rounded-full"
                        :class="linha.ativo ? 'bg-pos' : 'bg-ghost'"
                      />
                      {{ linha.ativo ? 'Ativo' : 'Inativo' }}
                    </span>
                  </td>
                  <td class="text-right">
                    <div v-if="podeAlterar" class="flex justify-end gap-1.5">
                      <button type="button" class="btn btn-sm btn-ghost" @click="editar(linha)">
                        <Pencil :size="13" /> Editar
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost"
                        @click="alternarAtivo(linha)"
                      >
                        <PowerOff v-if="linha.ativo" :size="13" />
                        <Power v-else :size="13" />
                        {{ linha.ativo ? 'Desativar' : 'Reativar' }}
                      </button>
                    </div>
                  </td>
                </template>
              </tr>

              <tr v-if="!linhas.length">
                <td colspan="5" class="py-10 text-center text-[13px] text-faint">
                  Nenhum item cadastrado ainda.
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
