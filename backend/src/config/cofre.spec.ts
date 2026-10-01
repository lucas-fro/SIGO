import { chaveDoCofre, cifrar, decifrar } from './cofre.js'

describe('cofre', () => {
  const chave = chaveDoCofre('segredo-do-servidor-de-teste')

  it('cifra e decifra; o texto guardado não contém a chave', () => {
    const guardado = cifrar('sk-proj-abc123', chave)
    expect(guardado).not.toContain('abc123')
    expect(guardado.startsWith('v1.')).toBe(true)
    expect(decifrar(guardado, chave)).toBe('sk-proj-abc123')
  })

  it('cada cifragem sai diferente (iv novo)', () => {
    expect(cifrar('x', chave)).not.toBe(cifrar('x', chave))
  })

  it('outro segredo ou texto adulterado não abre', () => {
    const guardado = cifrar('sk-proj-abc123', chave)
    expect(decifrar(guardado, chaveDoCofre('outro-segredo-qualquer'))).toBeNull()
    const partes = guardado.split('.')
    partes[3] = Buffer.from('outra coisa').toString('base64url')
    expect(decifrar(partes.join('.'), chave)).toBeNull()
    expect(decifrar('lixo', chave)).toBeNull()
  })
})
