import { documentoValido, formatarDocumento, normalizarDocumento } from './documento.js'

describe('documento (CPF/CNPJ)', () => {
  it('aceita CPF válido, com ou sem pontuação', () => {
    expect(documentoValido('529.982.247-25')).toBe(true)
    expect(documentoValido('52998224725')).toBe(true)
  })

  it('recusa CPF com dígito errado ou repetido', () => {
    expect(documentoValido('529.982.247-26')).toBe(false)
    expect(documentoValido('111.111.111-11')).toBe(false)
  })

  it('aceita CNPJ numérico válido', () => {
    expect(documentoValido('11.222.333/0001-81')).toBe(true)
  })

  it('aceita o CNPJ alfanumérico do exemplo da Receita', () => {
    expect(documentoValido('12.ABC.345/01DE-35')).toBe(true)
    expect(documentoValido('12abc34501de35')).toBe(true)
  })

  it('recusa CNPJ com dígito errado, repetido ou tamanho estranho', () => {
    expect(documentoValido('11.222.333/0001-82')).toBe(false)
    expect(documentoValido('12.ABC.345/01DE-36')).toBe(false)
    expect(documentoValido('00.000.000/0000-00')).toBe(false)
    expect(documentoValido('123')).toBe(false)
  })

  it('normaliza e formata', () => {
    expect(normalizarDocumento(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35')
    expect(formatarDocumento('12ABC34501DE35')).toBe('12.ABC.345/01DE-35')
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25')
    expect(formatarDocumento(null)).toBe('')
  })
})
