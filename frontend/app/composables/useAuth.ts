import { useQueryClient } from '@tanstack/vue-query'
import { podeEditar, type UsuarioSessao } from '#contracts'

/**
 * Quem está logado, espelhado do backend.
 *
 * O cookie de sessão é httpOnly, então o JavaScript não o enxerga: este estado
 * existe só para a interface decidir o que mostrar. Quem manda é a API, que
 * responde 401 sem sessão e 403 quando o papel ou o setor não permitem.
 */
export const useAuthUser = () => useState<UsuarioSessao | null>('auth-user', () => null)

/** Separado do usuário para distinguir "ainda não perguntei" de "não tem sessão". */
export const useAuthChecked = () => useState<boolean>('auth-checked', () => false)

export function useAuth() {
  const { apiBase } = useRuntimeConfig().public
  const user = useAuthUser()
  const checked = useAuthChecked()
  const router = useRouter()
  // O cache de consultas é da pessoa logada: na troca de sessão ele sai inteiro,
  // para ninguém ver por um instante a lista de quem usou a tela antes.
  const queryClient = useQueryClient()

  const isAdmin = computed(() => user.value?.papel === 'admin')
  const canEdit = computed(() => podeEditar(user.value))

  async function login(email: string, senha: string): Promise<void> {
    const res = await $fetch<{ usuario: UsuarioSessao }>(`${apiBase}/auth/login`, {
      method: 'POST',
      body: { email, senha },
      credentials: 'include',
    })
    queryClient.clear()
    user.value = res.usuario
    checked.value = true
  }

  async function logout(): Promise<void> {
    try {
      await $fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' })
    } finally {
      // Mesmo que a chamada falhe, sair da sessão local é o que a pessoa pediu.
      user.value = null
      checked.value = true
      queryClient.clear()
      await router.push('/login')
    }
  }

  return { user, isAdmin, canEdit, login, logout }
}
