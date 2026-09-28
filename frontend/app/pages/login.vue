<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { ApiError } from '~/composables/useApi'

definePageMeta({ layout: 'blank' })
useHead({ title: 'Entrar · SIGO' })

const { login } = useAuth()
const route = useRoute()
const router = useRouter()

const email = ref('')
const senha = ref('')
const enviando = ref(false)
const erro = ref<string | null>(null)
const campoEmail = ref<HTMLInputElement | null>(null)
const campoSenha = ref<HTMLInputElement | null>(null)

onMounted(() => campoEmail.value?.focus())

async function entrar() {
  if (enviando.value || !email.value || !senha.value) return
  enviando.value = true
  erro.value = null
  try {
    await login(email.value, senha.value)
    // Volta para onde a pessoa queria ir. Só caminho interno: URL absoluta aqui
    // viraria redirecionamento aberto.
    const next = route.query.next
    const destino =
      typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/'
    await router.replace(destino)
  } catch (e) {
    const res = e as { statusCode?: number; status?: number; data?: { message?: string } }
    const status = e instanceof ApiError ? e.status : (res.statusCode ?? res.status)
    erro.value =
      res.data?.message ??
      (status === 401 ? 'E-mail ou senha incorretos' : 'Não foi possível entrar. Tente de novo.')
    senha.value = ''
    campoSenha.value?.focus()
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center px-5 py-10">
    <div class="w-full max-w-[380px]">
      <div class="mb-6 flex flex-col items-center text-center">
        <LogoMark :size="44" />
        <h1 class="mt-4 text-[20px] font-semibold tracking-[-0.015em] text-ink">Entrar no SIGO</h1>
        <p class="mt-1 text-[13px] text-muted">Sistema Integrado de Gestão Orçamentária</p>
      </div>

      <form class="card flex flex-col gap-4 p-6 shadow-float" novalidate @submit.prevent="entrar">
        <FormField rotulo="E-mail" para="login-email">
          <input
            id="login-email"
            ref="campoEmail"
            v-model="email"
            type="email"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            class="input"
            placeholder="nome@smart.com.br"
            :disabled="enviando"
          />
        </FormField>

        <FormField rotulo="Senha" para="login-senha">
          <input
            id="login-senha"
            ref="campoSenha"
            v-model="senha"
            type="password"
            autocomplete="current-password"
            class="input"
            :disabled="enviando"
          />
        </FormField>

        <p
          v-if="erro"
          class="rounded-lg border border-neg/20 bg-neg-soft px-3 py-2 text-[12.5px] text-ink"
          role="alert"
        >
          {{ erro }}
        </p>

        <button
          type="submit"
          class="btn btn-primary mt-1 w-full"
          :disabled="enviando || !email || !senha"
        >
          <Loader2 v-if="enviando" :size="15" class="animate-spin" />
          {{ enviando ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>

      <p class="mt-4 text-center text-[12px] leading-relaxed text-faint">
        A sessão vale por alguns dias neste navegador. Depois de várias tentativas erradas, o acesso
        fica bloqueado por 15 minutos.
      </p>
    </div>
  </div>
</template>
