import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

/**
 * Abre o pool e o Drizzle em cima dele.
 *
 * A API recebe a conexão pela injeção do Nest (`DatabaseModule`); as rotinas de
 * linha de comando (migrations, seed, usuários) chamam isto direto, sem subir o
 * Nest inteiro para uma tarefa de segundos.
 */
export function conectar(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10 })
  const db = drizzle(pool, { schema })
  return { pool, db }
}

export type Conexao = ReturnType<typeof conectar>
export type Database = Conexao['db']
/** O `tx` recebido dentro de `db.transaction(...)`. */
export type Transacao = Parameters<Parameters<Database['transaction']>[0]>[0]
