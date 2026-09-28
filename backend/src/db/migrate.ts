import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { env } from '../config/env.js'
import { conectar } from './client.js'

/** Idempotente: o Drizzle registra o que já aplicou e pula na próxima vez. */
const { db, pool } = conectar(env.DATABASE_URL)

try {
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('migrations aplicadas')
} finally {
  await pool.end()
}
