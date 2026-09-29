import { hoje } from './datas.js'
import { criarLancamentoSchema, listarLancamentosSchema } from './lancamentos.js'

const valido = {
  setorId: 1,
  descricao: 'Impulsionamento Meta — setembro',
  valorCentavos: 150_000,
  dataGasto: '2026-09-10',
  categoriaId: 1,
  formaPagamentoId: 1,
  empreendimentoId: 1,
  fornecedorId: 1,
  codigoIdentificacao: '',
  parcelas: [{ valorCentavos: 150_000, vencimento: '2026-10-05' }],
}

describe('criarLancamentoSchema', () => {
  it('aceita um lançamento válido e normaliza os opcionais', () => {
    const r = criarLancamentoSchema.safeParse(valido)
    expect(r.success).toBe(true)
    expect(r.data?.codigoIdentificacao).toBeNull()
    expect(r.data?.observacao).toBeNull()
    expect(r.data?.campanhaId).toBeNull()
    expect(r.data?.parcelas[0]?.pagoEm).toBeNull()
  })

  it('recusa quando as parcelas não fecham com o total', () => {
    const r = criarLancamentoSchema.safeParse({
      ...valido,
      parcelas: [{ valorCentavos: 100_000, vencimento: '2026-10-05' }],
    })
    expect(r.success).toBe(false)
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('parcelas')
  })

  it('só descrição e valor são obrigatórios: o resto vira null e a data vazia vale hoje', () => {
    const r = criarLancamentoSchema.safeParse({
      setorId: 1,
      descricao: 'Anúncio em rádio',
      valorCentavos: 50_000,
      dataGasto: null,
      parcelas: [{ valorCentavos: 50_000, vencimento: '2026-10-05' }],
    })
    expect(r.success).toBe(true)
    expect(r.data?.dataGasto).toBe(hoje())
    expect(r.data).toMatchObject({
      categoriaId: null,
      formaPagamentoId: null,
      empreendimentoId: null,
      fornecedorId: null,
      campanhaId: null,
      cartaoId: null,
    })
  })

  it('recusa valor zero, data inválida e descrição vazia, com mensagem por campo', () => {
    const r = criarLancamentoSchema.safeParse({
      ...valido,
      descricao: '  ',
      valorCentavos: 0,
      dataGasto: '2026-02-30',
    })
    expect(r.success).toBe(false)
    const campos = r.error?.issues.map((i) => i.path.join('.'))
    expect(campos).toEqual(expect.arrayContaining(['descricao', 'valorCentavos', 'dataGasto']))
    const descricao = r.error?.issues.find((i) => i.path[0] === 'descricao')
    expect(descricao?.message).toBe('Descreva o gasto em poucas palavras (mínimo 3 letras)')
  })
})

describe('listarLancamentosSchema', () => {
  it('converte a query string e aplica os padrões', () => {
    const r = listarLancamentosSchema.parse({ categoriaId: '3', pagina: '2', busca: '  ' })
    expect(r).toMatchObject({ categoriaId: 3, pagina: 2, porPagina: 50, situacao: 'ativo' })
    expect(r.busca).toBeUndefined()
  })
})
