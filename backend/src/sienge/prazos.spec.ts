import { ESPERA_APOS_ERRO_MS, PRAZO_ANTIGO_MS, PRAZO_RECENTE_MS, precisaBuscar } from './prazos.js'

const AGORA = new Date('2026-09-29T15:00:00Z').getTime()
const antes = (ms: number) => new Date(AGORA - ms)

describe('precisaBuscar', () => {
  it('busca o mês que nunca foi buscado', () => {
    expect(precisaBuscar(undefined, '2026-09', '2026-09', AGORA)).toBe(true)
    expect(precisaBuscar({ buscadoEm: null, erroEm: null }, '2026-09', '2026-09', AGORA)).toBe(true)
  })

  it('mês corrente e o anterior vencem em 30 minutos', () => {
    const recente = { buscadoEm: antes(PRAZO_RECENTE_MS - 1000), erroEm: null }
    const vencido = { buscadoEm: antes(PRAZO_RECENTE_MS + 1000), erroEm: null }
    expect(precisaBuscar(recente, '2026-09', '2026-09', AGORA)).toBe(false)
    expect(precisaBuscar(vencido, '2026-09', '2026-09', AGORA)).toBe(true)
    expect(precisaBuscar(vencido, '2026-08', '2026-09', AGORA)).toBe(true)
  })

  it('mês mais antigo vale um dia', () => {
    const horas = { buscadoEm: antes(PRAZO_RECENTE_MS * 4), erroEm: null }
    const umDia = { buscadoEm: antes(PRAZO_ANTIGO_MS + 1000), erroEm: null }
    expect(precisaBuscar(horas, '2026-07', '2026-09', AGORA)).toBe(false)
    expect(precisaBuscar(umDia, '2026-07', '2026-09', AGORA)).toBe(true)
  })

  it('depois de uma falha, espera antes de tentar de novo', () => {
    const agoraMesmo = { buscadoEm: null, erroEm: antes(60_000) }
    const faz10Min = { buscadoEm: null, erroEm: antes(ESPERA_APOS_ERRO_MS * 2) }
    expect(precisaBuscar(agoraMesmo, '2026-09', '2026-09', AGORA)).toBe(false)
    expect(precisaBuscar(faz10Min, '2026-09', '2026-09', AGORA)).toBe(true)
  })

  it('falha antiga, já superada por uma busca completa, não segura nada', () => {
    const estado = {
      buscadoEm: antes(PRAZO_RECENTE_MS + 1000),
      erroEm: antes(PRAZO_RECENTE_MS * 2),
    }
    expect(precisaBuscar(estado, '2026-09', '2026-09', AGORA)).toBe(true)
  })
})
