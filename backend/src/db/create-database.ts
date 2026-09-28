import pg from 'pg'
import { env } from '../config/env.js'

/**
 * Cria o banco caso ainda não exista. Conecta na base administrativa
 * (normalmente `postgres`) porque não dá para criar um banco estando dentro dele.
 */
const nome = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ''))
if (!nome) throw new Error('DATABASE_URL não contém o nome do banco')

const client = new pg.Client({ connectionString: env.ADMIN_DATABASE_URL })
await client.connect()

try {
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [nome])
  if (rowCount) {
    console.log(`banco "${nome}" já existe`)
  } else {
    // Identificador não pode ser parametrizado; o nome vem do .env, não de entrada externa.
    await client.query(`create database "${nome.replace(/"/g, '""')}"`)
    console.log(`banco "${nome}" criado`)
  }
} finally {
  await client.end()
}
