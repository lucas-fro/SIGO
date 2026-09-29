import { ForbiddenException } from '@nestjs/common'
import { eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { UsuarioSessao } from '../contracts/auth.js'

/*
  Permissão = papel + setor. O papel diz o que a pessoa pode fazer; o setor diz
  onde. O admin enxerga todos os setores. Estas checagens ficam nos serviços,
  e não só na guarda, porque o setor vem do dado (do lançamento, do corpo da
  requisição), não da rota.
*/

export const enxergaSetor = (usuario: UsuarioSessao, setorId: number): boolean =>
  usuario.papel === 'admin' || usuario.setores.some((s) => s.id === setorId)

export function exigirEdicaoNoSetor(usuario: UsuarioSessao, setorId: number): void {
  if (usuario.papel === 'leitor') throw new ForbiddenException('Seu acesso é só de consulta')
  if (!enxergaSetor(usuario, setorId)) {
    throw new ForbiddenException('Você não tem acesso a este setor')
  }
}

/** Ids dos setores visíveis, ou `null` quando a pessoa vê tudo (admin). */
export const setoresVisiveis = (usuario: UsuarioSessao): number[] | null =>
  usuario.papel === 'admin' ? null : usuario.setores.map((s) => s.id)

/**
 * Condição SQL que restringe uma consulta aos setores que a pessoa enxerga;
 * com `setorId`, só a ele (e nada, se ela não o enxerga). `undefined` quando
 * não há o que restringir (admin sem setor escolhido).
 */
export function escopoDeSetor(
  usuario: UsuarioSessao,
  coluna: AnyPgColumn,
  setorId?: number,
): SQL | undefined {
  const visiveis = setoresVisiveis(usuario)
  if (setorId !== undefined) {
    if (visiveis !== null && !visiveis.includes(setorId)) return sql`false`
    return eq(coluna, setorId)
  }
  if (visiveis === null) return undefined
  return visiveis.length ? inArray(coluna, visiveis) : sql`false`
}
