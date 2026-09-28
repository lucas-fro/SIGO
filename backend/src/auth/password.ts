import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

/**
 * Hash de senha com scrypt, da biblioteca padrão do Node — o mesmo formato do
 * Painel Sienge, o que deixa a porta aberta para um login único mais adiante.
 *
 * scrypt e não bcrypt porque bcrypt exige módulo nativo compilado, e dependência
 * com binário é o tipo de coisa que quebra build de imagem por arquitetura
 * errada.
 *
 * `maxmem` é explícito porque o padrão do Node é 32 MB e os parâmetros abaixo
 * pedem 16: sem margem declarada, subir N no futuro falharia em runtime com um
 * erro que não explica o motivo.
 */
const PARAMS = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
const KEY_LENGTH = 32

/** Formato: scrypt$N$r$p$salt$hash — os parâmetros viajam com o hash para poder mudá-los sem invalidar os antigos. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(plain, salt, KEY_LENGTH, PARAMS)
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts
  if (!rawN || !rawR || !rawP || !rawSalt || !rawKey) return false

  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  const expected = Buffer.from(rawKey, 'base64url')
  const salt = Buffer.from(rawSalt, 'base64url')

  let actual: Buffer
  try {
    actual = await scrypt(plain, salt, expected.length, { N, r, p, maxmem: PARAMS.maxmem })
  } catch {
    // Parâmetros gravados fora do que este processo aceita: recusa, não explode.
    return false
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
