import { existsSync } from 'node:fs'
import { z } from 'zod'

/*
  Em desenvolvimento as variáveis vêm do `.env` desta pasta. Em produção o
  arquivo não existe dentro do container: o compose injeta as variáveis pelo
  `env_file`. O que já está no ambiente nunca é sobrescrito pelo arquivo.
*/
if (existsSync('.env')) process.loadEnvFile('.env')

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
   * Chave que assina o cookie de sessão. Em branco, é derivada da senha do
   * administrador, e trocar aquela senha derruba as sessões abertas.
   */
  AUTH_SECRET: z.string().min(16).optional(),
  AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(7),

  /* 3340 para não disputar porta com o Painel Sienge (3333) na mesma máquina. */
  PORT: z.coerce.number().int().positive().default(3340),
  HOST: z.string().default('0.0.0.0'),
  /** Origens liberadas no CORS, separadas por vírgula. */
  CORS_ORIGIN: z.string().default('http://localhost:3040'),
})

const parsed = schema.safeParse(process.env)

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
