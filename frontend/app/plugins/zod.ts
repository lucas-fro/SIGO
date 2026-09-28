import { z } from 'zod'

// Mensagens padrão do zod em português, para o que o contrato não personalizou.
export default defineNuxtPlugin(() => {
  z.config(z.locales.ptBR())
})
