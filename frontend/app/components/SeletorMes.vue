<script setup lang="ts">
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { somarMesesAoMes } from '#contracts'
import { mesPorExtenso, nomeMes } from '~/composables/useFormat'

/*
  Escolha do mês ("AAAA-MM"): as setas andam um mês e o nome do mês abre a
  grade do ano, para saltar direto. Não passa de `max` (o mês corrente).
*/
const props = defineProps<{ modelValue: string; max: string }>()
const emit = defineEmits<{ 'update:modelValue': [mes: string] }>()

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function escolher(mes: string) {
  if (mes <= props.max && mes !== props.modelValue) emit('update:modelValue', mes)
}

// ---------- grade do ano ----------

const aberta = ref(false)
const ano = ref(Number(props.modelValue.slice(0, 4)))
const anoMax = computed(() => Number(props.max.slice(0, 4)))
const raiz = ref<HTMLElement | null>(null)
const gatilho = ref<HTMLButtonElement | null>(null)
const grade = ref<HTMLElement | null>(null)

const chave = (i: number) => `${ano.value}-${String(i + 1).padStart(2, '0')}`

async function abrir() {
  ano.value = Number(props.modelValue.slice(0, 4))
  aberta.value = true
  await nextTick()
  grade.value?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
}

function fechar(devolverFoco = false) {
  aberta.value = false
  if (devolverFoco) gatilho.value?.focus()
}

function alternar() {
  if (aberta.value) fechar()
  else void abrir()
}

function escolherNaGrade(i: number) {
  escolher(chave(i))
  fechar(true)
}

function irParaCorrente() {
  escolher(props.max)
  fechar(true)
}

function tecla(evento: KeyboardEvent) {
  if (evento.key !== 'Escape' || !aberta.value) return
  evento.stopPropagation()
  fechar(true)
}

// Fecha ao clicar fora ou quando o foco sai do seletor (Tab).
function cliqueFora(evento: PointerEvent) {
  if (aberta.value && raiz.value && !raiz.value.contains(evento.target as Node)) fechar()
}
function focoSaiu(evento: FocusEvent) {
  const destino = evento.relatedTarget as Node | null
  if (aberta.value && destino && raiz.value && !raiz.value.contains(destino)) fechar()
}

onMounted(() => document.addEventListener('pointerdown', cliqueFora))
onBeforeUnmount(() => document.removeEventListener('pointerdown', cliqueFora))
</script>

<template>
  <div
    ref="raiz"
    class="relative max-sm:w-full"
    :data-lista-aberta="aberta || undefined"
    @keydown="tecla"
    @focusout="focoSaiu"
  >
    <div class="flex h-9 items-stretch rounded-lg border border-line bg-surface shadow-card">
      <button
        type="button"
        class="grid w-9 place-items-center rounded-l-[7px] text-muted transition-colors hover:bg-surface-alt hover:text-ink"
        aria-label="Mês anterior"
        title="Mês anterior"
        @click="escolher(somarMesesAoMes(modelValue, -1))"
      >
        <ChevronLeft :size="16" />
      </button>
      <button
        ref="gatilho"
        type="button"
        class="flex min-w-[168px] flex-1 items-center justify-center gap-2 border-x border-line px-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-alt"
        aria-haspopup="dialog"
        :aria-expanded="aberta"
        title="Escolher o mês"
        @click="alternar"
      >
        <CalendarDays :size="15" class="text-faint" />
        {{ mesPorExtenso(modelValue) }}
      </button>
      <button
        type="button"
        class="grid w-9 place-items-center rounded-r-[7px] text-muted transition-colors hover:bg-surface-alt hover:text-ink disabled:text-ghost disabled:hover:bg-transparent"
        aria-label="Próximo mês"
        title="Próximo mês"
        :disabled="modelValue >= max"
        @click="escolher(somarMesesAoMes(modelValue, 1))"
      >
        <ChevronRight :size="16" />
      </button>
    </div>

    <div
      v-if="aberta"
      ref="grade"
      role="dialog"
      aria-label="Escolher o mês"
      tabindex="-1"
      class="card absolute top-[calc(100%+6px)] left-0 z-30 w-[264px] p-3 shadow-float outline-none sm:right-0 sm:left-auto"
    >
      <div class="mb-2 flex items-center justify-between">
        <button
          type="button"
          class="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
          aria-label="Ano anterior"
          @click="ano--"
        >
          <ChevronLeft :size="16" />
        </button>
        <span class="tnum text-[13.5px] font-semibold text-ink" aria-live="polite">{{ ano }}</span>
        <button
          type="button"
          class="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink disabled:text-ghost disabled:hover:bg-transparent"
          aria-label="Próximo ano"
          :disabled="ano >= anoMax"
          @click="ano++"
        >
          <ChevronRight :size="16" />
        </button>
      </div>

      <div class="grid grid-cols-3 gap-1">
        <button
          v-for="(nome, i) in MESES"
          :key="nome"
          type="button"
          class="h-9 rounded-md text-[13px] capitalize transition-colors disabled:cursor-not-allowed disabled:text-ghost"
          :class="
            chave(i) === modelValue
              ? 'bg-accent font-semibold text-white'
              : chave(i) === max
                ? 'font-semibold text-accent-text ring-1 ring-line ring-inset hover:bg-sunken'
                : 'text-ink hover:bg-sunken disabled:hover:bg-transparent'
          "
          :aria-pressed="chave(i) === modelValue"
          :aria-current="chave(i) === max ? 'date' : undefined"
          :aria-label="`${nomeMes(chave(i))} de ${ano}`"
          :disabled="chave(i) > max"
          @click="escolherNaGrade(i)"
        >
          {{ nome }}
        </button>
      </div>

      <button
        v-if="modelValue !== max"
        type="button"
        class="mt-2 w-full border-t border-line-soft pt-2.5 text-[12.5px] font-medium text-accent-text hover:underline"
        @click="irParaCorrente"
      >
        Voltar para o mês atual
      </button>
    </div>
  </div>
</template>
