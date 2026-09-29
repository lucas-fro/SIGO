<script setup lang="ts">
import { Check, ChevronsUpDown, Plus, Search, X } from 'lucide-vue-next'
import { formatarDocumento, normalizarDocumento, type Fornecedor } from '#contracts'

/*
  Escolha de fornecedor com busca por nome (sem acento) ou por CPF/CNPJ, e
  atalho para cadastrar quando não existe. Teclado: setas, Enter e Esc.
  Com `opcional`, dá para voltar a deixar sem fornecedor.
*/
const model = defineModel<number | null>({ required: true })
const props = defineProps<{
  id?: string
  fornecedores: Fornecedor[]
  invalid?: boolean
  podeCriar?: boolean
  opcional?: boolean
}>()
const emit = defineEmits<{ criar: [nome: string] }>()

const aberto = ref(false)
const busca = ref('')
const destaque = ref(0)
const raiz = ref<HTMLElement | null>(null)
const campo = ref<HTMLInputElement | null>(null)
const lista = ref<HTMLElement | null>(null)

const semAcento = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

const selecionado = computed(() => props.fornecedores.find((f) => f.id === model.value) ?? null)

const opcoes = computed(() => {
  const termo = semAcento(busca.value.trim())
  const doc = normalizarDocumento(busca.value)
  const disponiveis = props.fornecedores.filter((f) => f.ativo || f.id === model.value)
  if (!termo) return disponiveis.slice(0, 60)
  return disponiveis
    .filter(
      (f) =>
        semAcento(f.nome).includes(termo) || (doc.length >= 3 && (f.documento ?? '').includes(doc)),
    )
    .slice(0, 60)
})

const mostrarCriar = computed(
  () =>
    !!props.podeCriar &&
    busca.value.trim().length >= 2 &&
    !opcoes.value.some((o) => semAcento(o.nome) === semAcento(busca.value.trim())),
)
const total = computed(() => opcoes.value.length + (mostrarCriar.value ? 1 : 0))

async function abrir() {
  aberto.value = true
  busca.value = ''
  destaque.value = Math.max(
    0,
    opcoes.value.findIndex((o) => o.id === model.value),
  )
  await nextTick()
  campo.value?.focus()
}

function fechar() {
  aberto.value = false
}

function escolher(fornecedor: Fornecedor) {
  model.value = fornecedor.id
  fechar()
}

function criar() {
  emit('criar', busca.value.trim())
  fechar()
}

function limpar() {
  model.value = null
  fechar()
}

function tecla(evento: KeyboardEvent) {
  const n = Math.max(total.value, 1)
  if (evento.key === 'ArrowDown') {
    evento.preventDefault()
    destaque.value = (destaque.value + 1) % n
  } else if (evento.key === 'ArrowUp') {
    evento.preventDefault()
    destaque.value = (destaque.value - 1 + n) % n
  } else if (evento.key === 'Enter') {
    evento.preventDefault()
    const opcao = opcoes.value[destaque.value]
    if (opcao) escolher(opcao)
    else if (mostrarCriar.value) criar()
  } else if (evento.key === 'Escape') {
    evento.preventDefault()
    evento.stopPropagation()
    fechar()
  }
}

watch(busca, () => {
  destaque.value = 0
})

watch(destaque, async () => {
  await nextTick()
  lista.value?.querySelector('[data-destaque="true"]')?.scrollIntoView({ block: 'nearest' })
})

function cliqueFora(evento: PointerEvent) {
  if (aberto.value && raiz.value && !raiz.value.contains(evento.target as Node)) fechar()
}

onMounted(() => document.addEventListener('pointerdown', cliqueFora))
onBeforeUnmount(() => document.removeEventListener('pointerdown', cliqueFora))
</script>

<template>
  <div ref="raiz" class="relative" :data-lista-aberta="aberto || undefined">
    <button
      :id="id"
      type="button"
      class="input flex items-center gap-2 text-left"
      :aria-invalid="invalid || undefined"
      aria-haspopup="listbox"
      :aria-expanded="aberto"
      @click="aberto ? fechar() : abrir()"
    >
      <span v-if="selecionado" class="min-w-0 flex-1 truncate">
        {{ selecionado.nome }}
        <span v-if="selecionado.documento" class="tnum text-faint">
          · {{ formatarDocumento(selecionado.documento) }}
        </span>
      </span>
      <span v-else class="flex-1 truncate text-ghost">{{
        opcional ? 'Sem fornecedor' : 'Escolha ou cadastre o fornecedor'
      }}</span>
      <ChevronsUpDown :size="15" class="shrink-0 text-faint" />
    </button>

    <div
      v-if="aberto"
      class="card absolute inset-x-0 top-[calc(100%+4px)] z-30 overflow-hidden shadow-float"
    >
      <div class="relative border-b border-line">
        <Search
          :size="15"
          class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ghost"
        />
        <input
          ref="campo"
          v-model="busca"
          type="text"
          class="h-10 w-full bg-transparent pr-3 pl-9 text-[13.5px] text-ink outline-none placeholder:text-ghost"
          placeholder="Buscar por nome ou CPF/CNPJ"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          @keydown="tecla"
        />
      </div>

      <ul ref="lista" role="listbox" class="max-h-64 overflow-y-auto p-1">
        <li
          v-for="(f, i) in opcoes"
          :key="f.id"
          role="option"
          :aria-selected="f.id === model"
          :data-destaque="i === destaque"
          class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2"
          :class="i === destaque ? 'bg-sunken' : ''"
          @pointerenter="destaque = i"
          @click="escolher(f)"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13px] text-ink">{{ f.nome }}</div>
            <div v-if="f.documento" class="tnum text-[11.5px] text-faint">
              {{ formatarDocumento(f.documento) }}
            </div>
          </div>
          <Check v-if="f.id === model" :size="15" class="shrink-0 text-accent" />
        </li>

        <li v-if="!opcoes.length && !mostrarCriar" class="px-2.5 py-3 text-[12.5px] text-faint">
          Nenhum fornecedor encontrado.
        </li>

        <li
          v-if="mostrarCriar"
          role="option"
          :aria-selected="false"
          :data-destaque="destaque === opcoes.length"
          class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-accent-text"
          :class="destaque === opcoes.length ? 'bg-sunken' : ''"
          @pointerenter="destaque = opcoes.length"
          @click="criar"
        >
          <Plus :size="15" /> Cadastrar “{{ busca.trim() }}”
        </li>
      </ul>

      <div
        v-if="(podeCriar && !mostrarCriar) || (opcional && model !== null)"
        class="border-t border-line p-1"
      >
        <button
          v-if="podeCriar && !mostrarCriar"
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-accent-text hover:bg-sunken"
          @click="criar"
        >
          <Plus :size="15" /> Cadastrar novo fornecedor
        </button>
        <button
          v-if="opcional && model !== null"
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted hover:bg-sunken hover:text-ink"
          @click="limpar"
        >
          <X :size="15" /> Deixar sem fornecedor
        </button>
      </div>
    </div>
  </div>
</template>
