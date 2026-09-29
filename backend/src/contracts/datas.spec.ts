import { mesQuery } from './comum.js'
import { janelaDe12Meses, somarMesesAoMes } from './datas.js'

describe('somarMesesAoMes', () => {
  it('anda para trás e para a frente, virando o ano', () => {
    expect(somarMesesAoMes('2026-01', -1)).toBe('2025-12')
    expect(somarMesesAoMes('2026-09', 11)).toBe('2027-08')
    expect(somarMesesAoMes('2026-09', 0)).toBe('2026-09')
  })
})

describe('janelaDe12Meses', () => {
  it('no mês corrente, termina nele', () => {
    expect(janelaDe12Meses('2026-09', '2026-09')).toEqual({ inicio: '2025-10', fim: '2026-09' })
  })

  it('nos últimos 12 meses a janela não se mexe', () => {
    expect(janelaDe12Meses('2026-03', '2026-09')).toEqual({ inicio: '2025-10', fim: '2026-09' })
    expect(janelaDe12Meses('2025-10', '2026-09')).toEqual({ inicio: '2025-10', fim: '2026-09' })
  })

  it('antes disso, o mês escolhido é o primeiro da janela', () => {
    expect(janelaDe12Meses('2025-09', '2026-09')).toEqual({ inicio: '2025-09', fim: '2026-08' })
    expect(janelaDe12Meses('2024-02', '2026-09')).toEqual({ inicio: '2024-02', fim: '2025-01' })
  })

  it('mês futuro termina nele', () => {
    expect(janelaDe12Meses('2026-12', '2026-09')).toEqual({ inicio: '2026-01', fim: '2026-12' })
  })
})

describe('mesQuery', () => {
  it('aceita AAAA-MM e recusa o resto', () => {
    expect(mesQuery.safeParse('2026-08').success).toBe(true)
    expect(mesQuery.safeParse('2026-13').success).toBe(false)
    expect(mesQuery.safeParse('2026-8').success).toBe(false)
    expect(mesQuery.safeParse('2026-08-01').success).toBe(false)
  })
})
