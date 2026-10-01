import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/*
  Cifra de segredos guardados no banco (chave da IA), AES-256-GCM.

  A chave de cifra sai do segredo do servidor (AUTH_SECRET, ou a senha do
  admin sem ele), que fica no .env e não no banco: um backup do banco sozinho
  não revela a chave da IA. Trocar esse segredo deixa o que foi cifrado antes
  ilegível; a tela avisa e pede a chave de novo.

  Formato: "v1.<iv>.<tag>.<cifrado>", cada parte em base64url.
*/

const VERSAO = 'v1'

export function chaveDoCofre(segredo: string): Buffer {
  return createHash('sha256').update(`${segredo}::sigo-cofre-v1`).digest()
}

export function cifrar(texto: string, chave: Buffer): string {
  const iv = randomBytes(12)
  const cifra = createCipheriv('aes-256-gcm', chave, iv)
  const cifrado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
  return [VERSAO, iv, cifra.getAuthTag(), cifrado]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.')
}

/** `null` quando não abre (outro segredo, ou texto adulterado). */
export function decifrar(guardado: string, chave: Buffer): string | null {
  const [versao, iv, tag, cifrado] = guardado.split('.')
  if (versao !== VERSAO || !iv || !tag || cifrado === undefined) return null
  try {
    const decifra = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64url'))
    decifra.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decifra.update(Buffer.from(cifrado, 'base64url')),
      decifra.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}
