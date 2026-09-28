import { and, asc, eq, inArray } from 'drizzle-orm'
import { PAPEIS, type Papel, type SetorRef, type UsuarioSessao } from '../contracts/auth.js'
import type { Database } from '../db/client.js'
import { setores, usuarioSetores, usuarios } from '../db/schema.js'
import { hashPassword } from './password.js'

/** O e-mail é normalizado na escrita e na leitura; sem isso o índice único deixaria passar duplicata por maiúscula. */
export const normalizarEmail = (email: string): string => email.trim().toLowerCase()

export const ehPapel = (valor: string): valor is Papel =>
  (PAPEIS as readonly string[]).includes(valor)

/** Papel desconhecido no banco é rebaixado para leitor: errar aqui tem que ser para menos acesso, não para mais. */
const paraPapel = (valor: string): Papel => (ehPapel(valor) ? valor : 'leitor')

export interface UsuarioComSenha {
  id: number
  nome: string
  email: string
  papel: Papel
  senhaHash: string
}

export async function buscarAtivoPorEmail(
  db: Database,
  email: string,
): Promise<UsuarioComSenha | undefined> {
  const [row] = await db
    .select()
    .from(usuarios)
    .where(eq(usuarios.email, normalizarEmail(email)))
    .limit(1)
  if (!row || !row.ativo) return undefined
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    papel: paraPapel(row.papel),
    senhaHash: row.senhaHash,
  }
}

/**
 * O usuário da sessão com os setores que ele enxerga.
 *
 * Roda a cada requisição, pela guarda. São duas consultas por chave pequena, e
 * o preço delas é o que faz desativar alguém ou tirar um setor valer na
 * requisição seguinte, em vez de só quando a sessão vencer.
 */
export async function carregarSessao(db: Database, id: number): Promise<UsuarioSessao | undefined> {
  const [row] = await db
    .select({
      id: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      papel: usuarios.papel,
      ativo: usuarios.ativo,
    })
    .from(usuarios)
    .where(eq(usuarios.id, id))
    .limit(1)
  if (!row || !row.ativo) return undefined

  const papel = paraPapel(row.papel)
  const campos = { id: setores.id, nome: setores.nome, slug: setores.slug }

  const visiveis: SetorRef[] =
    papel === 'admin'
      ? await db
          .select(campos)
          .from(setores)
          .where(eq(setores.ativo, true))
          .orderBy(asc(setores.nome))
      : await db
          .select(campos)
          .from(usuarioSetores)
          .innerJoin(setores, eq(setores.id, usuarioSetores.setorId))
          .where(and(eq(usuarioSetores.usuarioId, id), eq(setores.ativo, true)))
          .orderBy(asc(setores.nome))

  return { id: row.id, nome: row.nome, email: row.email, papel, setores: visiveis }
}

export const registrarAcesso = (db: Database, id: number): Promise<unknown> =>
  db.update(usuarios).set({ ultimoAcessoEm: new Date() }).where(eq(usuarios.id, id))

/**
 * Cria ou atualiza pelo e-mail. Com `setores` (slugs), a lista de setores da
 * pessoa passa a ser exatamente essa.
 */
export async function salvarUsuario(
  db: Database,
  entrada: { email: string; senha?: string; papel: Papel; nome: string; setores?: string[] },
): Promise<{ email: string; criado: boolean }> {
  const email = normalizarEmail(entrada.email)
  const senhaHash = entrada.senha ? await hashPassword(entrada.senha) : undefined

  return db.transaction(async (tx) => {
    const [existente] = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, email))
      .limit(1)

    let id: number
    if (existente) {
      await tx
        .update(usuarios)
        .set({
          nome: entrada.nome,
          papel: entrada.papel,
          ativo: true,
          atualizadoEm: new Date(),
          ...(senhaHash ? { senhaHash } : {}),
        })
        .where(eq(usuarios.id, existente.id))
      id = existente.id
    } else {
      if (!senhaHash) throw new Error('usuário novo precisa de senha')
      const [novo] = await tx
        .insert(usuarios)
        .values({ email, senhaHash, papel: entrada.papel, nome: entrada.nome })
        .returning({ id: usuarios.id })
      id = novo!.id
    }

    if (entrada.setores) {
      const encontrados = entrada.setores.length
        ? await tx
            .select({ id: setores.id, slug: setores.slug })
            .from(setores)
            .where(inArray(setores.slug, entrada.setores))
        : []
      const faltando = entrada.setores.filter((s) => !encontrados.some((e) => e.slug === s))
      if (faltando.length) throw new Error(`setor não encontrado: ${faltando.join(', ')}`)

      await tx.delete(usuarioSetores).where(eq(usuarioSetores.usuarioId, id))
      if (encontrados.length) {
        await tx
          .insert(usuarioSetores)
          .values(encontrados.map((s) => ({ usuarioId: id, setorId: s.id })))
      }
    }

    return { email, criado: !existente }
  })
}

export async function trocarSenha(db: Database, email: string, senha: string): Promise<boolean> {
  const result = await db
    .update(usuarios)
    .set({ senhaHash: await hashPassword(senha), atualizadoEm: new Date() })
    .where(eq(usuarios.email, normalizarEmail(email)))
    .returning({ id: usuarios.id })
  return result.length > 0
}

export async function definirAtivo(db: Database, email: string, ativo: boolean): Promise<boolean> {
  const result = await db
    .update(usuarios)
    .set({ ativo, atualizadoEm: new Date() })
    .where(eq(usuarios.email, normalizarEmail(email)))
    .returning({ id: usuarios.id })
  return result.length > 0
}

export async function listarUsuarios(db: Database) {
  const linhas = await db
    .select({
      id: usuarios.id,
      email: usuarios.email,
      nome: usuarios.nome,
      papel: usuarios.papel,
      ativo: usuarios.ativo,
      ultimoAcessoEm: usuarios.ultimoAcessoEm,
    })
    .from(usuarios)
    .orderBy(asc(usuarios.email))

  const vinculos = await db
    .select({ usuarioId: usuarioSetores.usuarioId, slug: setores.slug })
    .from(usuarioSetores)
    .innerJoin(setores, eq(setores.id, usuarioSetores.setorId))

  return linhas.map((u) => ({
    ...u,
    setores: vinculos.filter((v) => v.usuarioId === u.id).map((v) => v.slug),
  }))
}
