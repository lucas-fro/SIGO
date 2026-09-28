/**
 * Freio de força bruta por IP.
 *
 * O contador vive em memória: reiniciar o container zera, o que é aceitável
 * porque o custo do ataque continua alto e não vale uma tabela para isto.
 */
const MAX_FALHAS = 8
const BLOQUEIO_MS = 15 * 60_000

const tentativas = new Map<string, { falhas: number; bloqueadoAte: number }>()

/** Milissegundos que faltam para o IP poder tentar de novo; 0 quando está livre. */
export const tempoBloqueado = (ip: string): number =>
  Math.max(0, (tentativas.get(ip)?.bloqueadoAte ?? 0) - Date.now())

export function registrarFalha(ip: string): void {
  const entrada = tentativas.get(ip) ?? { falhas: 0, bloqueadoAte: 0 }
  entrada.falhas++
  if (entrada.falhas >= MAX_FALHAS) {
    entrada.bloqueadoAte = Date.now() + BLOQUEIO_MS
    entrada.falhas = 0
  }
  tentativas.set(ip, entrada)
}

export const limparFalhas = (ip: string): void => {
  tentativas.delete(ip)
}

/**
 * Atraso curto após recusa. Não impede ataque sozinho: serve para que o tempo de
 * resposta não distinga "e-mail inexistente" de "senha errada", o que entregaria
 * quais contas existem.
 */
export const atrasoDeFalha = (): Promise<void> => new Promise((r) => setTimeout(r, 300))
