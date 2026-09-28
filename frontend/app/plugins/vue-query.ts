import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

export default defineNuxtPlugin((nuxt) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Os dados mudam por lançamento de gente, não em lote: 30s evita buscar
        // de novo a cada troca de tela sem deixar a lista velha por muito tempo.
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        // Voltar para a aba traz o que outra pessoa lançou enquanto isso.
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  })

  nuxt.vueApp.use(VueQueryPlugin, { queryClient })
})
