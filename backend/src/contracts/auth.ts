import { z } from 'zod'

/**
 * Papéis do sistema.
 *
 * - `admin`: tudo, em todos os setores, inclusive cadastros.
 * - `editor`: registra e corrige lançamentos nos setores a que tem acesso.
 * - `leitor`: consulta os setores a que tem acesso, sem alterar nada.
 *
 * O setor é a outra metade da permissão: fora o admin, cada pessoa só enxerga
 * os setores ligados a ela.
 */
export const PAPEIS = ['admin', 'editor', 'leitor'] as const
export type Papel = (typeof PAPEIS)[number]

export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: 'Administrador',
  editor: 'Lançamentos',
  leitor: 'Consulta',
}

export const loginSchema = z.object({
  email: z.string({ error: 'Informe o e-mail' }).trim().min(1, { error: 'Informe o e-mail' }),
  senha: z.string({ error: 'Informe a senha' }).min(1, { error: 'Informe a senha' }),
})

export interface SetorRef {
  id: number
  nome: string
  slug: string
}

/** Quem está logado, do jeito que a API devolve em `/auth/me`. O hash da senha nunca sai do backend. */
export interface UsuarioSessao {
  id: number
  nome: string
  email: string
  papel: Papel
  /** Setores que a pessoa enxerga. Para o admin, todos os ativos. */
  setores: SetorRef[]
}

export const podeEditar = (usuario: Pick<UsuarioSessao, 'papel'> | null | undefined): boolean =>
  usuario?.papel === 'admin' || usuario?.papel === 'editor'
