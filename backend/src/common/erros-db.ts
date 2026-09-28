/**
 * Violação de índice único do Postgres (23505).
 *
 * O Drizzle embrulha o erro do driver e guarda o original em `cause`, então o
 * código pode estar em um nível ou no outro.
 */
export function ehViolacaoUnica(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}
