<script setup lang="ts">
import { X } from 'lucide-vue-next'

/*
  Painel flutuante à direita: o detalhe abre sem tirar a pessoa da lista, e
  clicar em outra linha só troca o conteúdo. Não escurece o fundo nem fecha no
  clique fora — a lista continua usável ao lado. No celular ocupa a tela.
*/
const props = defineProps<{ open: boolean; titulo: string }>()
const emit = defineEmits<{ fechar: [] }>()

const painel = ref<HTMLElement | null>(null)
let focoAnterior: HTMLElement | null = null

function tecla(evento: KeyboardEvent) {
  if (evento.key !== 'Escape' || evento.defaultPrevented) return
  // Modal ou lista aberta por cima trata o próprio Esc.
  if (document.querySelector('[data-modal-aberto]')) return
  emit('fechar')
}

watch(
  () => props.open,
  async (aberto) => {
    if (aberto) {
      focoAnterior = document.activeElement as HTMLElement | null
      window.addEventListener('keydown', tecla)
      await nextTick()
      painel.value?.focus({ preventScroll: true })
    } else {
      window.removeEventListener('keydown', tecla)
      focoAnterior?.focus?.({ preventScroll: true })
      focoAnterior = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => window.removeEventListener('keydown', tecla))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-x-4 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="translate-x-4 opacity-0"
    >
      <aside
        v-if="open"
        ref="painel"
        tabindex="-1"
        role="dialog"
        :aria-label="titulo"
        class="fixed inset-0 z-40 flex flex-col overflow-hidden border-line bg-surface shadow-float outline-none sm:inset-y-2 sm:right-2 sm:left-auto sm:w-[460px] sm:rounded-xl sm:border"
      >
        <header class="flex h-[52px] shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
          <slot name="icone" />
          <h2 class="flex-1 truncate text-[13.5px] font-semibold text-ink">{{ titulo }}</h2>
          <slot name="acoes" />
          <button type="button" class="btn-icon" aria-label="Fechar painel" @click="emit('fechar')">
            <X :size="17" />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <slot />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
