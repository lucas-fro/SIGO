import { useQueryClient } from '@tanstack/vue-query'
import type { Indicadores, LancamentoDetalhe } from '#contracts'
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

export const useIndicadores = () =>
  useApiQuery<Indicadores>('indicadores', '/lancamentos/indicadores')

/**
 * Depois de gravar: o detalhe devolvido pela API entra direto no cache (o
 * painel atualiza sem nova busca) e lista e indicadores são refeitos.
 */
export function useSincronizarLancamento() {
  const qc = useQueryClient()
  return (detalhe: LancamentoDetalhe) => {
    qc.setQueryData(chaveDetalhe(detalhe.id), detalhe)
    void qc.invalidateQueries({ queryKey: ['lancamentos'] })
    void qc.invalidateQueries({ queryKey: ['indicadores'] })
  }
}
