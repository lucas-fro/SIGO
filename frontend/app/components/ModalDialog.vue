<script setup lang="ts">
/*
  Modal centralizado para decisões curtas (cancelar com motivo, registrar
  pagamento, cadastrar fornecedor). Teleporta para o body para escapar de
  qualquer ancestral com overflow, e o Esc é tratado aqui antes de chegar ao
  painel lateral que possa estar aberto por baixo.
*/
const props = withDefaults(
  defineProps<{ open: boolean; titulo: string; descricao?: string; largura?: string }>(),
  { largura: '440px' },
)
const emit = defineEmits<{ fechar: [] }>()

const caixa = ref<HTMLElement | null>(null)
let focoAnterior: HTMLElement | null = null
let overflowAnterior: string | null = null

function tecla(evento: KeyboardEvent) {
  if (evento.key !== 'Escape') return
  evento.preventDefault()
  evento.stopPropagation()
  emit('fechar')
}

watch(
  () => props.open,
  async (aberto) => {
    if (aberto) {
      focoAnterior = document.activeElement as HTMLElement | null
      overflowAnterior = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', tecla, true)
      await nextTick()
      const alvo = caixa.value?.querySelector<HTMLElement>(
        '[autofocus], input:not([type=hidden]), select, textarea, .btn-primary',
      )
      ;(alvo ?? caixa.value)?.focus()
    } else {
      document.removeEventListener('keydown', tecla, true)
      if (overflowAnterior !== null) document.body.style.overflow = overflowAnterior
      overflowAnterior = null
      focoAnterior?.focus?.({ preventScroll: true })
      focoAnterior = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', tecla, true)
  if (overflowAnterior !== null) document.body.style.overflow = overflowAnterior
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        data-modal-aberto
        class="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 px-4 pt-[10vh] pb-8"
        @pointerdown.self="emit('fechar')"
      >
        <div
          ref="caixa"
          class="card w-full shadow-float outline-none"
          :style="{ maxWidth: largura }"
          role="dialog"
          aria-modal="true"
          :aria-label="titulo"
          tabindex="-1"
        >
          <div class="px-5 pt-5">
            <h2 class="text-[15px] font-semibold text-ink">{{ titulo }}</h2>
            <p v-if="descricao" class="mt-1 text-[13px] text-muted">{{ descricao }}</p>
          </div>
          <div class="px-5 py-4">
            <slot />
          </div>
          <div
            v-if="$slots.rodape"
            class="flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-line bg-surface-alt px-5 py-3"
          >
            <slot name="rodape" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
