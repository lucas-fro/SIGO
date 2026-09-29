<script setup lang="ts">
import { Menu } from 'lucide-vue-next'

const navOpen = useNavOpen()
const route = useRoute()

/* Trocar de tela fecha a gaveta. Só o caminho conta: filtro e painel mexem na query o tempo todo. */
watch(
  () => route.path,
  () => {
    navOpen.value = false
  },
)

function tecla(evento: KeyboardEvent) {
  if (evento.key === 'Escape' && navOpen.value) navOpen.value = false
}

onMounted(() => window.addEventListener('keydown', tecla))
onBeforeUnmount(() => window.removeEventListener('keydown', tecla))
</script>

<template>
  <!-- `dvh`, e não `vh`: no celular `100vh` conta a altura sem a barra de endereço. -->
  <div class="flex h-dvh overflow-hidden bg-canvas">
    <AppSidebar />

    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="navOpen"
        class="fixed inset-0 z-40 bg-black/40 lg:hidden"
        aria-hidden="true"
        @click="navOpen = false"
      />
    </Transition>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 lg:hidden"
      >
        <button
          type="button"
          class="btn-icon"
          aria-label="Abrir menu"
          aria-controls="sigo-nav"
          :aria-expanded="navOpen"
          @click="navOpen = true"
        >
          <Menu :size="19" />
        </button>
        <span class="text-[16px] font-semibold tracking-[-0.02em] text-ink">SIGO</span>
      </header>

      <!-- O conteúdo ocupa toda a altura e a largura disponível; a divisória marca a navegação. -->
      <main
        id="conteudo"
        class="min-h-0 flex-1 overflow-y-auto bg-surface lg:border-l lg:border-line"
      >
        <slot />
      </main>
    </div>

    <ToastHost />
  </div>
</template>
