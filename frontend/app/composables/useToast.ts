export interface Aviso {
  id: number
  texto: string
  tom: 'ok' | 'erro'
  /** Atalho opcional junto do aviso, ex.: "Registrar outro". */
  acao?: { rotulo: string; to: string }
}

export const useAvisos = () => useState<Aviso[]>('avisos', () => [])

let sequencia = 0

/** Avisos curtos no rodapé da tela, que somem sozinhos. */
export function useToast() {
  const avisos = useAvisos()

  function remover(id: number) {
    avisos.value = avisos.value.filter((a) => a.id !== id)
  }

  function mostrar(texto: string, tom: Aviso['tom'], acao?: Aviso['acao']) {
    const id = ++sequencia
    avisos.value = [...avisos.value.slice(-2), { id, texto, tom, acao }]
    setTimeout(() => remover(id), tom === 'erro' ? 7000 : 5000)
  }

  return {
    sucesso: (texto: string, acao?: Aviso['acao']) => mostrar(texto, 'ok', acao),
    erro: (texto: string) => mostrar(texto, 'erro'),
    remover,
  }
}
