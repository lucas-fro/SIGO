import pg from 'pg'
import { env } from '../config/env.js'

/**
 * Cria o banco caso ainda não exista. Primeiro tenta entrar no próprio banco:
 * se ele já existe, não precisa da base administrativa (num Postgres
 * compartilhado o usuário do SIGO pode nem ter acesso a ela). Só quando não
 * existe conecta na base administrativa (normalmente `postgres`), porque não
 * dá para criar um banco estando dentro dele.
 */
const nome = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ''))
if (!nome) throw new Error('DATABASE_URL não contém o nome do banco')

async function bancoJaExiste(): Promise<boolean> {
  const direto = new pg.Client({ connectionString: env.DATABASE_URL })
  try {
    await direto.connect()
    return true
  } catch (erro) {
    // 3D000: o banco não existe. Qualquer outra falha (senha, rede) é para aparecer.
    if ((erro as { code?: string }).code === '3D000') return false
    throw erro
  } finally {
    await direto.end().catch(() => {})
  }
}

if (await bancoJaExiste()) {
  console.log(`banco "${nome}" já existe`)
} else {
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
}
