<script setup lang="ts">
import type { Component } from 'vue'
import {
  CirclePlus,
  CreditCard,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  MoreHorizontal,
  Settings2,
  Sun,
  X,
} from 'lucide-vue-next'
import { ROTULO_PAPEL } from '#contracts'
import { useIndicadores } from '~/composables/useLancamentos'

const open = useNavOpen()
const { user, canEdit, logout } = useAuth()
const { theme, toggle } = useTheme()
const route = useRoute()

// O número de parcelas vencidas aparece ao lado de "Histórico": é o que pede ação.
const { data: indicadores } = useIndicadores()
const vencidas = computed(() => indicadores.value?.vencido.parcelas ?? 0)

interface Item {
  to: string
  rotulo: string
  icone: Component
  contagem?: number
}

const grupos = computed<Array<{ rotulo: string; itens: Item[] }>>(() => [
  {
    rotulo: 'Operação',
    itens: [
      { to: '/', rotulo: 'Dashboard', icone: LayoutDashboard },
      {
        to: '/historico',
        rotulo: 'Histórico',
        icone: History,
        contagem: vencidas.value || undefined,
      },
      { to: '/cartao', rotulo: 'Cartão', icone: CreditCard },
      ...(canEdit.value
        ? [{ to: '/lancamentos/novo', rotulo: 'Novo lançamento', icone: CirclePlus }]
        : []),
    ],
  },
  {
    rotulo: 'Configuração',
    itens: [{ to: '/cadastros', rotulo: 'Cadastros', icone: Settings2 }],
  },
])

/** O detalhe e a edição de um lançamento fazem parte do Histórico. */
function ativo(to: string): boolean {
  if (to === '/') return route.path === '/'
  if (to === '/historico') {
    return route.path === '/historico' || /^\/lancamentos\/\d+/.test(route.path)
  }
  return route.path === to || route.path.startsWith(`${to}/`)
}

// ---------- menu da pessoa ----------

const menuAberto = ref(false)
const menu = ref<HTMLElement | null>(null)

function cliqueFora(evento: PointerEvent) {
  if (menuAberto.value && menu.value && !menu.value.contains(evento.target as Node)) {
    menuAberto.value = false
  }
}

onMounted(() => document.addEventListener('pointerdown', cliqueFora))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', cliqueFora)
})

function alternarTema() {
  toggle()
  menuAberto.value = false
}

/* Ao abrir a gaveta no celular, o foco vai para o botão de fechar. */
const botaoFechar = ref<HTMLButtonElement | null>(null)
watch(open, async (aberta) => {
  if (!aberta) return
  await nextTick()
  botaoFechar.value?.focus({ preventScroll: true })
})
</script>

<template>
  <aside
    id="sigo-nav"
    class="fixed inset-y-0 left-0 z-50 flex w-[272px] max-w-[86vw] shrink-0 flex-col bg-canvas lg:static lg:z-auto lg:w-[248px] lg:max-w-none"
    :class="
      open
        ? 'max-lg:translate-x-0 max-lg:shadow-2xl max-lg:[transition:translate_200ms_ease-out,visibility_0s]'
        : 'max-lg:invisible max-lg:-translate-x-full max-lg:[transition:translate_200ms_ease-out,visibility_0s_linear_200ms]'
    "
  >
    <div class="flex items-start gap-2 px-5 pt-5 pb-5">
      <div class="min-w-0 flex-1">
        <div class="text-[20px] leading-tight font-semibold tracking-[-0.03em] text-ink">SIGO</div>
        <div class="mt-1 text-[11px] leading-[1.35] text-faint">
          Sistema Integrado de Gestão Orçamentária
        </div>
      </div>
      <button
        ref="botaoFechar"
        type="button"
        class="btn-icon lg:hidden"
        aria-label="Fechar menu"
        @click="open = false"
      >
        <X :size="18" />
      </button>
    </div>

    <nav class="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-2" aria-label="Principal">
      <div v-for="grupo in grupos" :key="grupo.rotulo" class="flex flex-col gap-0.5">
        <div class="eyebrow px-2.5 pb-1.5">{{ grupo.rotulo }}</div>
        <NuxtLink
          v-for="item in grupo.itens"
          :key="item.to"
          :to="item.to"
          class="flex h-9 items-center gap-2.5 border-l-2 border-transparent px-2.5 text-[13.5px] transition-colors"
          :class="
            ativo(item.to)
              ? 'border-accent bg-sunken font-medium text-ink'
              : 'text-muted hover:bg-sunken hover:text-ink'
          "
          :aria-current="ativo(item.to) ? 'page' : undefined"
        >
          <component
            :is="item.icone"
            :size="17"
            class="shrink-0"
            :class="ativo(item.to) ? 'text-accent' : ''"
          />
          <span class="flex-1 truncate">{{ item.rotulo }}</span>
          <span
            v-if="item.contagem"
            class="count !bg-neg-soft !text-neg"
            :title="`${item.contagem} parcela(s) vencida(s)`"
            >{{ item.contagem }}</span
          >
        </NuxtLink>
      </div>
    </nav>

    <div ref="menu" class="relative border-t border-line p-3">
      <div
        v-if="menuAberto"
        class="card absolute right-3 bottom-[calc(100%-6px)] left-3 z-10 p-1 shadow-float"
        role="menu"
      >
        <button
          type="button"
          role="menuitem"
          class="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink hover:bg-sunken"
          @click="alternarTema"
        >
          <Moon v-if="theme === 'light'" :size="16" class="text-muted" />
          <Sun v-else :size="16" class="text-muted" />
          {{ theme === 'light' ? 'Tema escuro' : 'Tema claro' }}
        </button>
        <button
          type="button"
          role="menuitem"
          class="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-neg hover:bg-neg-soft"
          @click="logout"
        >
          <LogOut :size="16" /> Sair
        </button>
      </div>

      <button
        type="button"
        class="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sunken"
        aria-haspopup="menu"
        :aria-expanded="menuAberto"
        @click="menuAberto = !menuAberto"
      >
        <UserAvatar :nome="user?.nome ?? '?'" :size="32" />
        <div class="min-w-0 flex-1 leading-tight">
          <div class="truncate text-[13px] font-medium text-ink">{{ user?.nome }}</div>
          <div class="truncate text-[11.5px] text-faint">
            {{ user ? ROTULO_PAPEL[user.papel] : '' }} · {{ user?.email }}
          </div>
        </div>
        <MoreHorizontal :size="16" class="shrink-0 text-faint" />
      </button>
    </div>
  </aside>
</template>
