import { useToast } from '~/composables/useToast'

/**
 * Erro inesperado num clique ou numa tela não pode passar em silêncio: sem
 * isto, o botão simplesmente não faz nada e a pessoa não sabe se salvou. O
 * erro pode ter acontecido antes ou depois de gravar, então o aviso pede para
 * conferir em vez de afirmar. O erro continua no console para quem investigar.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const toast = useToast()
  nuxtApp.hook('vue:error', () => {
    toast.erro('Algo deu errado nesta ação. Recarregue a página e confira se ela foi concluída.')
  })
})
