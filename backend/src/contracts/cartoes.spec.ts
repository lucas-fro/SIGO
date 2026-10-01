import { cartaoSchema } from './cadastros.js'
import { diaDoMes, vencimentoDaFatura } from './datas.js'

describe('vencimentoDaFatura', () => {
  it('fecha 3, vence 10: antes do fechamento vence no mesmo mês', () => {
    expect(vencimentoDaFatura('2026-09-02', 3, 10)).toBe('2026-09-10')
  })

  it('no dia do fechamento ou depois, vai para a fatura seguinte', () => {
    expect(vencimentoDaFatura('2026-09-03', 3, 10)).toBe('2026-10-10')
    expect(vencimentoDaFatura('2026-09-28', 3, 10)).toBe('2026-10-10')
  })

  it('fecha 25, vence 5: o vencimento cai no mês depois do fechamento', () => {
    expect(vencimentoDaFatura('2026-09-20', 25, 5)).toBe('2026-10-05')
    expect(vencimentoDaFatura('2026-09-26', 25, 5)).toBe('2026-11-05')
  })

  it('virada de ano e mês curto', () => {
    expect(vencimentoDaFatura('2026-12-15', 10, 20)).toBe('2027-01-20')
    expect(vencimentoDaFatura('2027-01-29', 28, 31)).toBe('2027-02-28')
  })

  it('fechamento 30 ou 31 num mês curto fecha no último dia dele', () => {
    // Fevereiro fecha no dia 28: a compra do dia 28 já vai para a fatura seguinte.
    expect(vencimentoDaFatura('2027-02-27', 30, 7)).toBe('2027-03-07')
    expect(vencimentoDaFatura('2027-02-28', 30, 7)).toBe('2027-04-07')
    // Abril fecha no dia 30 quando o fechamento é 31.
    expect(vencimentoDaFatura('2026-04-29', 31, 10)).toBe('2026-05-10')
    expect(vencimentoDaFatura('2026-04-30', 31, 10)).toBe('2026-06-10')
  })
})

describe('diaDoMes', () => {
  it('não estoura o fim do mês', () => {
    expect(diaDoMes('2026-02', 31)).toBe('2026-02-28')
    expect(diaDoMes('2028-02-10', 30)).toBe('2028-02-29')
    expect(diaDoMes('2026-09', 5)).toBe('2026-09-05')
  })
})

describe('cartaoSchema', () => {
  const base = {
    setorId: 1,
    nome: 'Cartão Marketing',
    formaPagamentoId: 1,
    orcamentoMensalCentavos: 3_200_000,
  }

  it('aceita cartão sem fatura (pré-pago) e com fechamento e vencimento', () => {
    expect(cartaoSchema.safeParse(base).success).toBe(true)
    expect(
      cartaoSchema.safeParse({ ...base, final: '4821', diaFechamento: 3, diaVencimento: 10 })
        .success,
    ).toBe(true)
  })

  it('recusa só um dos dias da fatura e final que não seja de 4 dígitos', () => {
    const r = cartaoSchema.safeParse({ ...base, final: '48', diaFechamento: 3 })
    expect(r.success).toBe(false)
    const campos = r.error?.issues.map((i) => i.path.join('.'))
    expect(campos).toEqual(expect.arrayContaining(['final']))
    const soUmDia = cartaoSchema.safeParse({ ...base, diaFechamento: 3 })
    expect(soUmDia.error?.issues[0]?.path).toEqual(['diaVencimento'])
  })
})
