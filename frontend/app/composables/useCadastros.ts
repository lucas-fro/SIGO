import type { Cadastros, Fornecedor } from '#contracts'
import { useApiQuery } from '~/composables/useApi'

/** As listas do formulário. Mudam pouco: a tela de cadastros invalida a chave quando altera algo. */
export const useCadastros = () => useApiQuery<Cadastros>('cadastros', '/cadastros')

export const useFornecedores = () => useApiQuery<Fornecedor[]>('fornecedores', '/fornecedores')

/** Opções de um select: as ativas, mais a já escolhida mesmo se desativada (lançamento antigo). */
export function opcoesAtivas<T extends { id: number; ativo: boolean }>(
  lista: readonly T[] | undefined,
  selecionado?: number | null,
): T[] {
  return (lista ?? []).filter((item) => item.ativo || item.id === selecionado)
}
