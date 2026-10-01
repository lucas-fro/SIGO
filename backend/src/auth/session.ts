import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

/**
 * Cookie de sessão assinado, sem tabela de sessões (o mesmo desenho do Painel Sienge).
 *
 * O token carrega o id do usuário, a versão das sessões dele e a validade.
 * Papel, setores e situação ficam fora de propósito: são lidos do banco a cada
 * requisição, então desativar alguém ou mudar seu acesso vale na hora. A
 * versão (`usuarios.sessao_versao`) é o que derruba as sessões abertas: sair,
 * trocar a senha ou ser desativado aumenta o número no banco.
 *
 * Sem estado no servidor a sessão sobrevive ao restart do container, que aqui
 * acontece a cada deploy — ninguém é deslogado quando sobe código.
 */
const producao = process.env.NODE_ENV === 'production'

/**
 * Em produção, `__Host-`: o navegador só aceita o cookie com `Secure`, `Path=/`
 * e sem `Domain`, então outro serviço em *.smartinterno.com não consegue
 * plantar um cookie com o mesmo nome. Em localhost (http) o prefixo não vale.
 */
const COOKIE = producao ? '__Host-sigo_sessao' : 'sigo_sessao'

/** Chave de assinatura: só do segredo do servidor, nunca de uma senha de login. */
const signingKey = createHash('sha256').update(`${env.AUTH_SECRET}::sigo-sessao-v1`).digest()

const b64 = (b: Buffer) => b.toString('base64url')

function sameDigest(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

const sign = (payload: string): string =>
  b64(createHmac('sha256', signingKey).update(payload).digest())

export function issueToken(userId: number, versao: number): string {
  const payload = b64(
    Buffer.from(
      JSON.stringify({
        uid: userId,
        v: versao,
        exp: Date.now() + env.AUTH_SESSION_DAYS * 86_400_000,
      }),
    ),
  )
  return `${payload}.${sign(payload)}`
}

/** O usuário e a versão de sessão quando o token é válido; undefined em qualquer outro caso. */
export function lerToken(token: string | undefined): { uid: number; versao: number } | undefined {
  if (!token) return undefined

  const dot = token.lastIndexOf('.')
  if (dot <= 0) return undefined

  const payload = token.slice(0, dot)
  if (!sameDigest(token.slice(dot + 1), sign(payload))) return undefined

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      uid?: number
      v?: number
      exp?: number
    }
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return undefined
    if (typeof data.uid !== 'number') return undefined
    // Token emitido antes da versão existir vale como versão 0.
    return { uid: data.uid, versao: typeof data.v === 'number' ? data.v : 0 }
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
  if (producao) attrs.push('Secure')
  return attrs.join('; ')
}

export const sessionCookie = (token: string): string =>
  `${COOKIE}=${token}; ${attributes(env.AUTH_SESSION_DAYS * 86_400)}`

export const clearedCookie = (): string => `${COOKIE}=; ${attributes(0)}`
