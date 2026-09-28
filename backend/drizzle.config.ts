import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// `generate` não precisa de banco; `migrate` e `studio` usam o DATABASE_URL do .env.
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
})
