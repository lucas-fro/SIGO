/**
 * A gaveta da navegação no celular. Abaixo de 1024px a barra lateral sai da
 * tela; quem abre é o botão do cabeçalho e quem fecha é a própria gaveta.
 */
export const useNavOpen = () => useState<boolean>('nav-open', () => false)

/**
 * Título e subtítulo vêm de `definePageMeta`, lidos de `route.meta`: o
 * cabeçalho do layout mostra o que a página declarou.
 */
export function usePageHeaderState() {
  const route = useRoute()
  return computed(() => ({
    title: (route.meta.title as string | undefined) ?? 'SIGO',
    subtitle: (route.meta.subtitle as string | undefined) ?? '',
  }))
}
