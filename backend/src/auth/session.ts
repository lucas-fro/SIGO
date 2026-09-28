import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

/**
 * Cookie de sessão assinado, sem tabela de sessões (o mesmo desenho do Painel Sienge).
 *
 * O token carrega apenas o id do usuário e a validade. Papel, setores e
 * situação ficam fora dele de propósito: são lidos do banco a cada requisição,
 * então desativar alguém ou mudar seu acesso vale na hora, em vez de esperar a
 * sessão vencer.
 *
 * Sem estado no servidor a sessão sobrevive ao restart do container, que aqui
 * acontece a cada deploy — ninguém é deslogado quando sobe código.
 */
const COOKIE = 'sigo_sessao'

/**
 * Chave de assinatura. `AUTH_SECRET` quando existir; senão, derivada da senha do
 * administrador, que é obrigatória. Trocar aquela senha invalida as sessões abertas.
 */
const signingKey = createHash('sha256')
  .update(`${env.AUTH_SECRET ?? env.ADMIN_PASSWORD}::sigo-sessao-v1`)
  .digest()

const b64 = (b: Buffer) => b.toString('base64url')

function sameDigest(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

const sign = (payload: string): string =>
  b64(createHmac('sha256', signingKey).update(payload).digest())

export function issueToken(userId: number): string {
  const payload = b64(
    Buffer.from(
      JSON.stringify({ uid: userId, exp: Date.now() + env.AUTH_SESSION_DAYS * 86_400_000 }),
    ),
  )
  return `${payload}.${sign(payload)}`
}

/** Devolve o id do usuário quando o token é válido, e undefined em qualquer outro caso. */
export function userIdFromToken(token: string | undefined): number | undefined {
  if (!token) return undefined

  const dot = token.lastIndexOf('.')
  if (dot <= 0) return undefined

  const payload = token.slice(0, dot)
  if (!sameDigest(token.slice(dot + 1), sign(payload))) return undefined

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      uid?: number
      exp?: number
    }
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return undefined
    return typeof data.uid === 'number' ? data.uid : undefined
  } catch {
    return undefined
  }
}

/** Lê o cookie do cabeçalho cru: não vale uma dependência para uma linha de parse. */
export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === COOKIE) return part.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * `Secure` só em produção: o navegador recusa cookie seguro em http e o
 * desenvolvimento roda em localhost. `SameSite=Lax` porque front e API saem no
 * mesmo domínio pelo Caddy.
 */
function attributes(maxAgeSeconds: number): string {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

export const sessionCookie = (token: string): string =>
  `${COOKIE}=${token}; ${attributes(env.AUTH_SESSION_DAYS * 86_400)}`

export const clearedCookie = (): string => `${COOKIE}=; ${attributes(0)}`
