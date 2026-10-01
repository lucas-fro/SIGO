import { z } from 'zod'

/*
  Configurações do sistema que o administrador altera pela tela (Cadastros).
  Por ora, só a leitura de comprovante por IA: qual API, qual modelo e a chave.
  A chave vai para o banco cifrada e nunca volta inteira: a tela só vê o final.
*/

export const PROVEDORES_IA = ['openai', 'anthropic'] as const
export type ProvedorIa = (typeof PROVEDORES_IA)[number]

export const ROTULO_PROVEDOR_IA: Record<ProvedorIa, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
}

/**
 * Modelos oferecidos na tela; outro qualquer da API entra por "Outro modelo".
 * O primeiro de cada lista é o sugerido. OpenAI: o gpt-6-luna lê imagem e PDF
 * e custava US$ 0,10 / 0,50 por milhão de tokens (entrada / saída) em set/2026,
 * contra US$ 0,75 / 4,50 do gpt-5.4-mini.
 */
export const MODELOS_IA: Record<ProvedorIa, string[]> = {
  openai: ['gpt-6-luna', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4', 'gpt-5.5'],
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-5-5'],
}

/** Onde a pessoa cria a chave. */
export const PAINEL_CHAVES_IA: Record<ProvedorIa, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
}

export const salvarLeituraIaSchema = z.object({
  provedor: z.enum(PROVEDORES_IA, { error: 'Escolha a API' }),
  modelo: z
    .string()
    .trim()
    .min(1, 'Informe o modelo')
    .max(80, 'Nome de modelo longo demais')
    .regex(/^[\w.:-]+$/, 'Use o nome do modelo como a API escreve (ex.: gpt-5.4-mini)'),
  /** Em branco mantém a chave guardada (só vale sem trocar de API). */
  chave: z
    .string()
    .trim()
    .max(400, 'Chave longa demais')
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || (v.length >= 20 && !/\s/.test(v)), {
      message: 'Cole a chave inteira, sem espaços',
    }),
})
export type SalvarLeituraIa = z.infer<typeof salvarLeituraIaSchema>

export interface ConfiguracaoLeituraIa {
  /** A leitura está pronta para uso (chave guardada e legível). */
  ligada: boolean
  provedor: ProvedorIa | null
  modelo: string | null
  /** Últimos 4 caracteres da chave guardada. */
  chaveFinal: string | null
  /**
   * A chave guardada não abre mais: o segredo do servidor (AUTH_SECRET, ou a
   * senha do admin sem ele) mudou depois que ela foi salva. Precisa colar de novo.
   */
  chaveIlegivel: boolean
  atualizadoEm: string | null
  atualizadoPor: { id: number; nome: string } | null
}
