export type Theme = 'light' | 'dark'

export const THEME_KEY = 'sigo-theme'

/**
 * O tema mora no atributo `data-theme` do `<html>`, aplicado por um script
 * inline antes da primeira pintura (ver `nuxt.config.ts`).
 */
export function useTheme() {
  const theme = useState<Theme>('theme', () => 'light')

  onMounted(() => {
    theme.value = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  })

  function set(next: Theme) {
    theme.value = next
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Navegador com armazenamento bloqueado: o tema vale só nesta visita.
    }
  }

  const toggle = () => set(theme.value === 'dark' ? 'light' : 'dark')

  return { theme: computed(() => theme.value), set, toggle }
}
