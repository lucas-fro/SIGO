import { useQueryClient } from '@tanstack/vue-query'
import type { Indicadores, LancamentoDetalhe, Painel } from '#contracts'
import { useApiQuery } from '~/composables/useApi'

/** Chave de cache do detalhe: a mesma que `useApiQuery` monta para `/lancamentos/:id`. */
const chaveDetalhe = (id: number) => ['lancamento', `/lancamentos/${id}`, {}]

export function useLancamento(id: MaybeRefOrGetter<number | null>) {
  return useApiQuery<LancamentoDetalhe>(
    'lancamento',
    () => `/lancamentos/${toValue(id) ?? 0}`,
    {},
    { enabled: () => toValue(id) !== null },
  )
}

/**
 * Indicadores e dashboard de um mês ("AAAA-MM"); sem mês, o corrente. Ao
 * trocar de mês, o anterior fica na tela até o novo chegar.
 */
export const useIndicadores = (mes?: MaybeRefOrGetter<string | undefined>) =>
  useApiQuery<Indicadores>(
    'indicadores',
    '/lancamentos/indicadores',
    () => ({ mes: toValue(mes) }),
    { keepPrevious: true },
  )

export const usePainel = (mes?: MaybeRefOrGetter<string | undefined>) =>
  useApiQuery<Painel>('painel', '/painel', () => ({ mes: toValue(mes) }), { keepPrevious: true })

/** O que depende dos lançamentos (e do orçamento dos cartões) e precisa ser refeito quando algo muda. */
export function invalidarTotais(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['lancamentos'] })
  void qc.invalidateQueries({ queryKey: ['indicadores'] })
  void qc.invalidateQueries({ queryKey: ['painel'] })
}

/**
 * Depois de gravar: o detalhe devolvido pela API entra direto no cache (o
 * painel atualiza sem nova busca) e lista, indicadores e dashboard são refeitos.
 */
export function useSincronizarLancamento() {
  const qc = useQueryClient()
  return (detalhe: LancamentoDetalhe) => {
    qc.setQueryData(chaveDetalhe(detalhe.id), detalhe)
    invalidarTotais(qc)
  }
}
