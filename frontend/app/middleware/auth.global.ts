import type { UsuarioSessao } from '#contracts'
import { useAuthChecked, useAuthUser } from '~/composables/useAuth'

/**
 * Manda para a tela de entrada quem não tem sessão.
 *
 * Não protege dado nenhum — a proteção é o 401 da API. Serve para a pessoa
 * cair na tela certa em vez de numa tela de esqueletos vazios.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return

  const user = useAuthUser()
  const checked = useAuthChecked()

  if (!checked.value) {
    const { apiBase } = useRuntimeConfig().public
    try {
      const res = await $fetch<{ usuario: UsuarioSessao }>(`${apiBase}/auth/me`, {
        credentials: 'include',
      })
      user.value = res.usuario
    } catch {
      user.value = null
    } finally {
      checked.value = true
    }
  }

  if (!user.value) {
    // `next` preserva onde a pessoa queria chegar, inclusive link colado.
    return navigateTo({ path: '/login', query: { next: to.fullPath } })
  }
})
