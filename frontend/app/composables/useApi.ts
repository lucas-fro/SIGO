import { keepPreviousData, useQuery, type UseQueryReturnType } from '@tanstack/vue-query'
import type { ErroValidacao } from '#contracts'
import { useAuthChecked, useAuthUser } from '~/composables/useAuth'

export type QueryParams = Record<string, string | number | boolean | undefined | null>

/** Remove chaves vazias para a URL não carregar filtros inertes. */
function clean(params: QueryParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = String(v)
  }
  return out
}

/**
 * Erro da API já destrinchado: o status, a mensagem para mostrar e, no 400,
 * o problema de cada campo (as mesmas chaves do contrato).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ErroValidacao['issues'] = [],
    readonly data: unknown = null,
  ) {
    super(message)
  }

  /** Erros por campo, no formato que os formulários usam: `{ 'parcelas.0.vencimento': 'mensagem' }`. */
  get porCampo(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const issue of this.issues) out[issue.path] ??= issue.message
    return out
  }
}

function paraApiError(err: unknown): ApiError {
  const res = err as {
    statusCode?: number
    status?: number
    data?: { message?: string | string[]; issues?: ErroValidacao['issues'] }
  }
  const status = res.statusCode ?? res.status ?? 0
  const raw = res.data?.message
  const message =
    (Array.isArray(raw) ? raw.join('; ') : raw) ??
    (status === 0
      ? 'Sem resposta do servidor. Confira a conexão e tente de novo.'
      : 'Não foi possível concluir. Tente de novo.')
  return new ApiError(status, message, res.data?.issues ?? [], res.data ?? null)
}

/**
 * Envia o cookie de sessão e trata o 401 num lugar só.
 *
 * Sessão vencida acontece com a tela aberta: sem isto, cada tela mostraria um
 * erro genérico e a pessoa não saberia que só precisa entrar de novo. O router
 * é capturado aqui, durante o setup, porque o `queryFn` do TanStack roda depois
 * e fora do contexto do Nuxt.
 */
function useRequester() {
  const { apiBase } = useRuntimeConfig().public
  const user = useAuthUser()
  const checked = useAuthChecked()
  const router = useRouter()

  return async function request<T>(path: string, init: Record<string, unknown> = {}): Promise<T> {
    try {
      return await $fetch<T>(`${apiBase}${path}`, { ...init, credentials: 'include' })
    } catch (err) {
      const erro = paraApiError(err)
      if (erro.status === 401) {
        user.value = null
        checked.value = true
        const atual = router.currentRoute.value
        if (atual.path !== '/login') {
          await router.push({ path: '/login', query: { next: atual.fullPath } })
        }
      }
      throw erro
    }
  }
}

/** Chamadas avulsas (gravar, cancelar...), fora do cache do TanStack. Capture no setup e use nas ações. */
export function useApi() {
  const request = useRequester()
  const { apiBase } = useRuntimeConfig().public
  return {
    get: <T>(path: string, params: QueryParams = {}) => request<T>(path, { query: clean(params) }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    /** Envio de arquivo: o navegador monta o multipart (e o boundary) a partir do FormData. */
    enviar: <T>(path: string, dados: FormData) => request<T>(path, { method: 'POST', body: dados }),
    /**
     * Endereço completo de uma rota, para `<a href>`, `<img>` e `<iframe>`: o
     * cookie de sessão vai junto (mesma origem em produção, mesmo site no
     * desenvolvimento), sem precisar baixar o arquivo por JavaScript.
     */
    url: (path: string) => `${apiBase}${path}`,
  }
}

export interface QueryOptions<T = unknown> {
  /** Segura a busca enquanto a condição for falsa. */
  enabled?: MaybeRefOrGetter<boolean>
  /** Mantém o resultado anterior na tela enquanto o novo carrega (listas com filtro). */
  keepPrevious?: boolean
  /** Refaz a busca a cada tantos ms enquanto a função devolver um número (ex.: trabalho em andamento no servidor). */
  refetchInterval?: (dados: T | undefined) => number | false
}

/**
 * Envolve o TanStack Query padronizando a chave de cache: quando o caminho ou
 * os filtros mudam, a chave muda e a busca acontece sozinha.
 */
export function useApiQuery<T>(
  key: string,
  path: MaybeRefOrGetter<string>,
  params: MaybeRefOrGetter<QueryParams> = {},
  options: QueryOptions<T> = {},
): UseQueryReturnType<T, ApiError> {
  const request = useRequester()

  const resolvedPath = computed(() => toValue(path))
  const resolvedParams = computed(() => clean(toValue(params)))
  const enabled = computed(() => toValue(options.enabled) ?? true)

  return useQuery<T, ApiError>({
    queryKey: [key, resolvedPath, resolvedParams],
    queryFn: () => request<T>(resolvedPath.value, { query: resolvedParams.value }),
    enabled,
    ...(options.keepPrevious ? { placeholderData: keepPreviousData } : {}),
    ...(options.refetchInterval
      ? { refetchInterval: (query) => options.refetchInterval!(query.state.data) }
      : {}),
  })
}
