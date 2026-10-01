import { existsSync } from 'node:fs'
import { z } from 'zod'

/*
  Em desenvolvimento as variáveis vêm do `.env` desta pasta. Em produção o
  arquivo não existe dentro do container: o compose injeta as variáveis pelo
  `env_file`. O que já está no ambiente nunca é sobrescrito pelo arquivo.
*/
if (existsSync('.env')) process.loadEnvFile('.env')

/** `VAR=` no arquivo chega como texto vazio: para o que é opcional, vale como não informada. */
const vazioComoAusente = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined)

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /**
   * Opcional. Só o `create-database` usa, porque não dá para criar um banco
   * estando conectado nele. Vazio, sai do DATABASE_URL trocando o nome do banco
   * por `postgres`: mesmo servidor, mesmas credenciais.
   */
  ADMIN_DATABASE_URL: z.string().optional(),

  /*
    Administrador garantido a cada subida do container. Os demais usuários são
    cadastrados pela linha de comando e existem só no banco, com a senha em hash.
    A senha daqui é reaplicada a cada subida: é a forma de recuperar o acesso.
  */
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD: z.string().min(6, 'use pelo menos 6 caracteres'),
  ADMIN_NAME: z.string().default('Administrador'),

  /**
   * Segredo do servidor: assina o cookie de sessão e cifra a chave da IA no
   * banco. Obrigatório e aleatório (openssl rand -base64 48). Nunca derivado da
   * senha de login: quem tem um cookie poderia adivinhar a senha fora do ar.
   * Trocar derruba as sessões e pede a chave da IA de novo.
   */
  AUTH_SECRET: z
    .string({ error: 'obrigatório: gere com  openssl rand -base64 48' })
    .trim()
    .min(32, { error: 'use pelo menos 32 caracteres aleatórios (openssl rand -base64 48)' }),
  AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(7),

  /* 3340 para não disputar porta com o Painel Sienge (3333) na mesma máquina. */
  PORT: z.coerce.number().int().positive().default(3340),
  HOST: z.string().default('0.0.0.0'),
  /** Origens liberadas no CORS, separadas por vírgula. */
  CORS_ORIGIN: z.string().default('http://localhost:3040'),

  /*
    API do Sienge (títulos a pagar), para comparar o gasto do setor com o que
    foi lançado lá. Opcional: sem as três, o dashboard mostra o quadro do Sienge
    como não configurado e nada é chamado.
  */
  SIENGE_SUBDOMAIN: vazioComoAusente,
  SIENGE_USER: vazioComoAusente,
  SIENGE_PASSWORD: vazioComoAusente,
  /**
   * Teto de requisições por minuto deste sistema. O limite do Sienge (200/min)
   * vale para o subdomínio inteiro e é dividido com o Painel Sienge, que usa até 150.
   */
  SIENGE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(40),
  /**
   * Horários (São Paulo) em que as parcelas em aberto são conferidas no Sienge
   * e marcadas como pagas. Vazio desliga a conferência automática.
   */
  SIENGE_CONFERENCIA_HORARIOS: z
    .string()
    .default('00:00,12:00')
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
          error: 'use horários HH:MM separados por vírgula',
        }),
      ),
    ),

  /**
   * Pasta dos comprovantes. Relativa ao diretório do backend; no container é
   * `/app/dados/comprovantes`, montada como volume (ver DEPLOY.md).
   */
  COMPROVANTES_DIR: z.string().default('dados/comprovantes'),
})

const parsed = schema
  .superRefine((v, ctx) => {
    // A senha de exemplo do .env.example não pode ir para produção.
    if (process.env.NODE_ENV === 'production' && v.ADMIN_PASSWORD === 'troque-esta-senha') {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_PASSWORD'],
        message: 'troque a senha de exemplo do .env.example',
      })
    }
  })
  .safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.map(String).join('.')}: ${i.message}`)
    .join('\n')
  throw new Error(`Variáveis de ambiente inválidas:\n${issues}`)
}

/** A mesma conexão do DATABASE_URL, apontando para a base administrativa. */
function adminUrlFrom(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.pathname = '/postgres'
  return url.toString()
}

export const env = {
  ...parsed.data,
  ADMIN_DATABASE_URL: parsed.data.ADMIN_DATABASE_URL || adminUrlFrom(parsed.data.DATABASE_URL),
}
