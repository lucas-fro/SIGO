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

  it('recusa valor zero, data inválida e campo obrigatório ausente, com mensagem por campo', () => {
    const r = criarLancamentoSchema.safeParse({
      ...valido,
      valorCentavos: 0,
      dataGasto: '2026-02-30',
      categoriaId: null,
    })
    expect(r.success).toBe(false)
    const campos = r.error?.issues.map((i) => i.path.join('.'))
    expect(campos).toEqual(expect.arrayContaining(['valorCentavos', 'dataGasto', 'categoriaId']))
    const categoria = r.error?.issues.find((i) => i.path[0] === 'categoriaId')
    expect(categoria?.message).toBe('Escolha a categoria')
  })
})

describe('listarLancamentosSchema', () => {
  it('converte a query string e aplica os padrões', () => {
    const r = listarLancamentosSchema.parse({ categoriaId: '3', pagina: '2', busca: '  ' })
    expect(r).toMatchObject({ categoriaId: 3, pagina: 2, porPagina: 50, situacao: 'ativo' })
    expect(r.busca).toBeUndefined()
  })
})
