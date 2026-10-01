/**
 * Freio de força bruta, por conta e por IP.
 *
 * A tentativa entra "em andamento" antes de a senha ser conferida e conta para
 * o limite: pedidos em paralelo passam pela checagem um de cada vez e não
 * escapam todos do bloqueio. Errou, vira falha; acertou, sai sem contar (e sem
 * apagar as falhas de antes, senão quem tem uma conta zeraria o contador do IP
 * entrando nela).
 *
 * A conta é o limite apertado (adivinhar a senha de alguém, de qualquer IP; IPv6
 * troca de endereço à vontade). O IP é folgado: o escritório inteiro sai pelo
 * mesmo IP público, e alguns erros de digitação da equipe numa manhã não podem
 * trancar todo mundo. Ele segura quem tenta muitas contas a partir de um lugar.
 *
 * O contador vive em memória: reiniciar o container zera, o que é aceitável
 * porque o custo do ataque continua alto e não vale uma tabela para isto.
 */
const BLOQUEIO_MS = 15 * 60_000
/** Falhas que contam: as dos últimos 15 minutos. */
const JANELA_MS = 15 * 60_000
const LIMITE = { conta: 10, ip: 30 } as const

interface Entrada {
  falhas: number
  /** Tentativas cuja senha ainda está sendo conferida. */
  andamento: number
  bloqueadoAte: number
  ultima: number
}

const tentativas = new Map<string, Entrada>()

/** O endereço como unidade de contagem: IPv6 pela rede /64 (o que um provedor entrega a um cliente). */
export function chaveDoIp(ip: string): string {
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapeado) return mapeado[1]!
  if (!ip.includes(':')) return ip
  const [antes, depois = ''] = ip.split('::')
  const inicio = antes ? antes.split(':') : []
  const fim = depois ? depois.split(':') : []
  const grupos = [
    ...inicio,
    ...Array(Math.max(0, 8 - inicio.length - fim.length)).fill('0'),
    ...fim,
  ]
  return `${grupos.slice(0, 4).join(':')}::/64`
}

export type Chave = `ip:${string}` | `conta:${string}`

const limiteDe = (chave: Chave) => (chave.startsWith('ip:') ? LIMITE.ip : LIMITE.conta)

function entradaDe(chave: Chave, agora: number): Entrada {
  const atual = tentativas.get(chave)
  if (atual && (agora - atual.ultima < JANELA_MS || atual.bloqueadoAte > agora)) return atual
  const nova = { falhas: 0, andamento: 0, bloqueadoAte: 0, ultima: agora }
  tentativas.set(chave, nova)
  return nova
}

/**
 * Milissegundos que faltam para poder tentar de novo (o maior entre as chaves);
 * 0 quando livre. Limite tomado por tentativas ainda em andamento também
 * segura (um instante): é o que barra a rajada em paralelo.
 */
export function tempoBloqueado(...chaves: Chave[]): number {
  const agora = Date.now()
  let espera = 0
  for (const chave of chaves) {
    const e = tentativas.get(chave)
    if (!e) continue
    if (e.bloqueadoAte > agora) espera = Math.max(espera, e.bloqueadoAte - agora)
    else if (agora - e.ultima < JANELA_MS && e.falhas + e.andamento >= limiteDe(chave)) {
      espera = Math.max(espera, 1_000)
    }
  }
  return espera
}

/** A senha vai ser conferida: a tentativa já ocupa lugar no limite. */
export function iniciarTentativa(...chaves: Chave[]): void {
  const agora = Date.now()
  for (const chave of chaves) {
    const e = entradaDe(chave, agora)
    e.andamento++
    e.ultima = agora
  }
  if (tentativas.size > 5000) limparVencidas(agora)
}

/** Errou: vira falha, e a que completa o limite bloqueia por 15 minutos. */
export function tentativaFalhou(...chaves: Chave[]): void {
  const agora = Date.now()
  for (const chave of chaves) {
    const e = entradaDe(chave, agora)
    e.andamento = Math.max(0, e.andamento - 1)
    e.falhas++
    e.ultima = agora
    if (e.falhas >= limiteDe(chave)) {
      e.bloqueadoAte = agora + BLOQUEIO_MS
      e.falhas = 0
    }
  }
}

/** Acertou (ou não chegou a conferir): sai do andamento sem contar como falha. */
export function tentativaEncerrada(...chaves: Chave[]): void {
  for (const chave of chaves) {
    const e = tentativas.get(chave)
    if (e) e.andamento = Math.max(0, e.andamento - 1)
  }
}

function limparVencidas(agora: number): void {
  for (const [chave, e] of tentativas) {
    if (e.bloqueadoAte <= agora && e.andamento === 0 && agora - e.ultima >= JANELA_MS) {
      tentativas.delete(chave)
    }
  }
}

/** Só para os testes. */
export const zerarFreio = (): void => tentativas.clear()

/**
 * Atraso curto após recusa. Não impede ataque sozinho: serve para que o tempo de
 * resposta não distinga "e-mail inexistente" de "senha errada", o que entregaria
 * quais contas existem.
 */
export const atrasoDeFalha = (): Promise<void> => new Promise((r) => setTimeout(r, 300))
