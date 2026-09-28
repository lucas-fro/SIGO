import { fimDoMes, hoje, inicioDoMes, somarDias, somarMeses } from './datas.js'
import { gerarParcelas, situacaoPagamento, somaCentavos } from './parcelas.js'

describe('gerarParcelas', () => {
  it('põe os centavos que sobram na primeira parcela e fecha com o total', () => {
    const parcelas = gerarParcelas(10_000, 3, '2026-10-10')
    expect(parcelas.map((p) => p.valorCentavos)).toEqual([3_334, 3_333, 3_333])
    expect(somaCentavos(parcelas)).toBe(10_000)
  })

  it('vence mês a mês, caindo no último dia quando o mês é curto', () => {
    const parcelas = gerarParcelas(3_000, 3, '2026-01-31')
    expect(parcelas.map((p) => p.vencimento)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  it('à vista é uma parcela só com o valor inteiro', () => {
    expect(gerarParcelas(12_345, 1, '2026-09-28')).toEqual([
      { valorCentavos: 12_345, vencimento: '2026-09-28' },
    ])
  })

  it('não gera nada sem valor', () => {
    expect(gerarParcelas(0, 3, '2026-09-28')).toEqual([])
  })
})

describe('situacaoPagamento', () => {
  it('distingue pago, parcial, em aberto e vencido', () => {
    expect(situacaoPagamento({ parcelas: 2, pagas: 2, vencidas: 0 })).toBe('pago')
    expect(situacaoPagamento({ parcelas: 3, pagas: 1, vencidas: 0 })).toBe('parcial')
    expect(situacaoPagamento({ parcelas: 1, pagas: 0, vencidas: 0 })).toBe('em_aberto')
  })

  it('vencido pesa mais que parcial', () => {
    expect(situacaoPagamento({ parcelas: 3, pagas: 1, vencidas: 1 })).toBe('vencido')
  })
})

describe('datas', () => {
  it('soma meses e dias sem cair em fuso', () => {
    expect(somarMeses('2024-01-31', 1)).toBe('2024-02-29')
    expect(somarMeses('2026-12-15', 1)).toBe('2027-01-15')
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('início e fim do mês', () => {
    expect(inicioDoMes('2026-09-28')).toBe('2026-09-01')
    expect(fimDoMes('2026-09-28')).toBe('2026-09-30')
    expect(fimDoMes('2028-02-10')).toBe('2028-02-29')
  })

  it('"hoje" é o dia em São Paulo, não em UTC', () => {
    // 02:30 UTC do dia 29 ainda é 23:30 do dia 28 em Brasília.
    expect(hoje(new Date('2026-09-29T02:30:00Z'))).toBe('2026-09-28')
  })
})
