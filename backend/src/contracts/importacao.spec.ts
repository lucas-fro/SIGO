import {
  FORMATO_IMPORTACAO,
  importacaoSchema,
  prepararImportacao,
  type CadastrosDaImportacao,
} from './importacao.js'

const HOJE = '2026-10-02'

const cadastros: CadastrosDaImportacao = {
  setores: [{ id: 1, nome: 'Marketing' }],
  categorias: [
    { id: 10, nome: 'Criação e produção', setorId: 1, ativo: true },
    { id: 11, nome: 'Stand de vendas', setorId: 1, ativo: true },
  ],
  empreendimentos: [
    { id: 20, nome: 'Institucional', ativo: true },
    { id: 21, nome: 'Residencial Jardim Aurora', ativo: true },
    { id: 22, nome: 'Vista Verde Residence', ativo: true },
    { id: 23, nome: 'Condomínio Vista Verde', ativo: true },
  ],
  formasPagamento: [
    { id: 1, nome: 'Cartão de crédito', cartao: true, ativo: true },
    { id: 2, nome: 'Cartão pré-pago', cartao: true, ativo: true },
    { id: 3, nome: 'Boleto', cartao: false, ativo: true },
  ],
  cartoes: [
    {
      id: 30,
      nome: 'Cartão Marketing',
      final: '4821',
      setorId: 1,
      formaPagamentoId: 1,
      recarga: 'mensal',
      diaFechamento: 3,
      diaVencimento: 10,
      ativo: true,
      recargas: [],
    },
    {
      id: 31,
      nome: 'Cartão do Plantão',
      final: '7730',
      setorId: 1,
      formaPagamentoId: 2,
      recarga: 'avulsa',
      diaFechamento: null,
      diaVencimento: null,
      ativo: true,
      recargas: [
        { id: 1, cartaoId: 31, data: '2026-09-05', valorCentavos: 300_000, observacao: null },
      ],
    },
  ],
  fornecedores: [
    { id: 40, nome: 'ESTUDIO EXEMPLO ARQUITETURA LTDA', documento: '11444777000161', ativo: true },
    { id: 41, nome: 'Canva', documento: null, ativo: true },
    { id: 42, nome: 'Gráfica Antiga', documento: null, ativo: false },
  ],
}

const lerArquivo = (dados: Record<string, unknown>) =>
  importacaoSchema.parse({ formato: FORMATO_IMPORTACAO, ...dados })

const boleto = {
  descricao: 'Revisão de imagens – contrato 77',
  valorCentavos: 250_000,
  dataGasto: '2026-10-01',
  fornecedor: { nome: 'ESTUDIO EXEMPLO ARQUITETURA LTDA', documento: '11.444.777/0001-61' },
  codigoIdentificacao: 'NFS-e 123',
  categoria: 'criacao e producao',
  empreendimento: 'Jardim Aurora',
  formaPagamento: 'Boleto',
  vencimento: '2026-10-15',
  comprovantes: ['NF 400.pdf', 'Boleto NF 400.pdf'],
}

describe('importacaoSchema', () => {
  it('aceita um boleto e completa listas vazias', () => {
    const r = importacaoSchema.safeParse({ formato: FORMATO_IMPORTACAO, lancamentos: [boleto] })
    expect(r.success).toBe(true)
    expect(r.data?.recargas).toEqual([])
    expect(r.data?.lancamentos[0]?.avisos).toEqual([])
  })

  it('recusa outro formato, arquivo vazio e parcelas que não fecham', () => {
    expect(importacaoSchema.safeParse({ formato: 'outro', lancamentos: [boleto] }).success).toBe(
      false,
    )
    expect(importacaoSchema.safeParse({ formato: FORMATO_IMPORTACAO }).success).toBe(false)
    const parcelas = [{ valorCentavos: 100, vencimento: '2026-10-15' }]
    const r = importacaoSchema.safeParse({
      formato: FORMATO_IMPORTACAO,
      lancamentos: [{ ...boleto, vencimento: null, parcelas }],
    })
    expect(r.error?.issues[0]?.path).toEqual(['lancamentos', 0, 'parcelas'])
  })

  it('recusa parcelas junto com vencimento da parcela única', () => {
    const parcelas = [{ valorCentavos: 250_000, vencimento: '2026-10-15' }]
    const r = importacaoSchema.safeParse({
      formato: FORMATO_IMPORTACAO,
      lancamentos: [{ ...boleto, parcelas }],
    })
    expect(r.success).toBe(false)
  })
})

describe('prepararImportacao', () => {
  it('boleto: acha fornecedor pelo CNPJ e cadastros pelo nome, sem acento e por parte', () => {
    const p = prepararImportacao(lerArquivo({ lancamentos: [boleto] }), cadastros, 1, HOJE)
    const [l] = p.lancamentos
    expect(l?.problemas).toEqual([])
    expect(l?.fornecedorNovo).toBeNull()
    expect(l?.dados).toMatchObject({
      setorId: 1,
      fornecedorId: 40,
      categoriaId: 10,
      empreendimentoId: 21,
      formaPagamentoId: 3,
      cartaoId: null,
      parcelas: [{ valorCentavos: 250_000, vencimento: '2026-10-15', pagoEm: null }],
    })
  })

  it('nome que bate com mais de um cadastro fica em branco, com aviso', () => {
    const arquivo = lerArquivo({ lancamentos: [{ ...boleto, empreendimento: 'Vista Verde' }] })
    const [l] = prepararImportacao(arquivo, cadastros, 1, HOJE).lancamentos
    expect(l?.dados.empreendimentoId).toBeNull()
    expect(l?.problemas).toEqual([{ nivel: 'aviso', texto: expect.stringContaining('mais de um') }])
  })

  it('compra no pré-pago: cartão pelo final, forma do cartão e vencimento no dia', () => {
    const arquivo = lerArquivo({
      lancamentos: [
        {
          descricao: 'Gasolina',
          valorCentavos: 7_000,
          dataGasto: '2026-09-17',
          fornecedor: { nome: 'AUTO POSTO EXEMPLO LTDA', documento: '11.222.333/0001-81' },
          formaPagamento: 'Cartão de crédito',
          cartao: '7730',
          pagoEm: '2026-09-17',
        },
      ],
    })
    const [l] = prepararImportacao(arquivo, cadastros, 1, HOJE).lancamentos
    expect(l?.dados).toMatchObject({
      cartaoId: 31,
      formaPagamentoId: 2,
      fornecedorId: null,
      parcelas: [{ valorCentavos: 7_000, vencimento: '2026-09-17', pagoEm: '2026-09-17' }],
    })
    expect(l?.fornecedorNovo).toEqual({
      nome: 'AUTO POSTO EXEMPLO LTDA',
      documento: '11222333000181',
    })
    expect(l?.problemas.map((p) => p.texto)).toEqual([
      expect.stringContaining('ajustada para “Cartão pré-pago”'),
    ])
  })

  it('cartão com fatura vence na fatura; forma de cartão com um cartão só escolhe o cartão', () => {
    const arquivo = lerArquivo({
      lancamentos: [
        { descricao: 'Canva', valorCentavos: 4_990, dataGasto: '2026-09-28', cartao: '4821' },
        {
          descricao: 'Lanche do plantão',
          valorCentavos: 15_000,
          dataGasto: '2026-09-29',
          formaPagamento: 'Cartão pré-pago',
          pagoEm: '2026-09-29',
        },
      ],
    })
    const [fatura, unico] = prepararImportacao(arquivo, cadastros, 1, HOJE).lancamentos
    expect(fatura?.dados.parcelas[0]?.vencimento).toBe('2026-10-10')
    expect(unico?.dados.cartaoId).toBe(31)
  })

  it('cartão que não existe é erro; pré-pago sem pagamento e pagamento no futuro também avisam', () => {
    const arquivo = lerArquivo({
      lancamentos: [
        { descricao: 'Compra', valorCentavos: 100, cartao: '9999' },
        { descricao: 'Compra', valorCentavos: 100, dataGasto: '2026-09-01', cartao: '7730' },
        { descricao: 'Compra', valorCentavos: 100, dataGasto: '2026-09-01', pagoEm: '2026-10-03' },
      ],
    })
    const [inexistente, semPagamento, futuro] = prepararImportacao(
      arquivo,
      cadastros,
      1,
      HOJE,
    ).lancamentos
    expect(inexistente?.problemas[0]?.nivel).toBe('erro')
    expect(semPagamento?.problemas).toEqual([
      { nivel: 'aviso', texto: expect.stringContaining('vencida') },
    ])
    expect(futuro?.problemas).toEqual([{ nivel: 'erro', texto: 'Pagamento com data no futuro' }])
  })

  it('fornecedor sem documento pelo nome; desativado fica em branco', () => {
    const arquivo = lerArquivo({
      lancamentos: [
        { descricao: 'Canva Pro', valorCentavos: 4_990, fornecedor: { nome: 'canva' } },
        { descricao: 'Folhetos', valorCentavos: 9_000, fornecedor: { nome: 'Gráfica Antiga' } },
      ],
    })
    const [ativo, desativado] = prepararImportacao(arquivo, cadastros, 1, HOJE).lancamentos
    expect(ativo?.dados.fornecedorId).toBe(41)
    expect(desativado?.dados.fornecedorId).toBeNull()
    expect(desativado?.fornecedorNovo).toBeNull()
    expect(desativado?.problemas[0]?.texto).toContain('desativado')
  })

  it('recargas: repetida fica marcada; cartão mensal e data futura não servem', () => {
    const arquivo = lerArquivo({
      recargas: [
        { cartao: '7730', data: '2026-09-05', valorCentavos: 300_000 },
        { cartao: 'Cartão do Plantão', data: '2026-10-01', valorCentavos: 100_000 },
        { cartao: '4821', data: '2026-10-01', valorCentavos: 100_000 },
        { cartao: '7730', data: '2026-10-05', valorCentavos: 100_000 },
      ],
    })
    const [repetida, nova, mensal, futura] = prepararImportacao(
      arquivo,
      cadastros,
      1,
      HOJE,
    ).recargas
    expect(repetida?.jaRegistrada).toBe(true)
    expect(nova?.dados).toEqual({
      cartaoId: 31,
      data: '2026-10-01',
      valorCentavos: 100_000,
      observacao: null,
    })
    expect(mensal?.dados).toBeNull()
    expect(futura?.dados).toBeNull()
  })

  it('setor do arquivo que não existe impede tudo', () => {
    const p = prepararImportacao(
      lerArquivo({ setor: 'Obras', lancamentos: [boleto] }),
      cadastros,
      1,
      HOJE,
    )
    expect(p.setorId).toBeNull()
    expect(p.problemas[0]?.nivel).toBe('erro')
    expect(p.lancamentos).toEqual([])
  })
})
