import type { ContextoLeitura, DocumentoExtraido } from './leitor.js'
import { documentoParaBusca, montarLeitura } from './leitura.js'

const CONTEXTO: ContextoLeitura = {
  hoje: '2026-09-29',
  categorias: [
    { id: 1, nome: 'Mídia digital', descricao: 'Meta Ads, Google Ads' },
    { id: 3, nome: 'Gráfica e impressos', descricao: 'Panfletos, folders' },
  ],
  empreendimentos: [{ id: 7, nome: 'Lumine Residence' }],
  formasPagamento: [
    { id: 2, nome: 'Boleto', cartao: false },
    { id: 4, nome: 'Pix', cartao: false },
  ],
}

const extraido = (parcial: Partial<DocumentoExtraido> = {}): DocumentoExtraido => ({
  tipoDocumento: 'boleto',
  descricao: 'Impressão de 5.000 panfletos',
  valorCentavos: 123456,
  dataDocumento: '2026-09-20',
  fornecedor: { nome: 'Gráfica Exemplo Ltda', documento: '11.222.333/0001-81' },
  codigo: 'NFS-e nº 826',
  parcelas: [{ vencimento: '2026-10-05', valorCentavos: 123456 }],
  pagoEm: null,
  formaPagamentoId: 2,
  categoriaId: 3,
  empreendimentoId: null,
  observacao: null,
  avisos: [],
  ...parcial,
})

describe('montarLeitura', () => {
  it('mantém o que confere, já em centavos', () => {
    const l = montarLeitura(extraido(), CONTEXTO, null)
    expect(l.valorCentavos).toBe(123456)
    expect(l.dataGasto).toBe('2026-09-20')
    expect(l.parcelas).toEqual([{ vencimento: '2026-10-05', valorCentavos: 123456 }])
    expect(l.categoriaId).toBe(3)
    expect(l.formaPagamentoId).toBe(2)
    expect(l.codigoIdentificacao).toBe('NFS-e nº 826')
    expect(l.avisos).toEqual([])
  })

  it('fornecedor do cadastro vence; sem cadastro, vira sugestão com o CNPJ normalizado', () => {
    const comCadastro = montarLeitura(extraido(), CONTEXTO, {
      id: 9,
      nome: 'Gráfica X',
      ativo: true,
    })
    expect(comCadastro.fornecedor).toEqual({ id: 9, nome: 'Gráfica X' })
    expect(comCadastro.fornecedorNovo).toBeNull()

    const semCadastro = montarLeitura(extraido(), CONTEXTO, null)
    expect(semCadastro.fornecedor).toBeNull()
    expect(semCadastro.fornecedorNovo).toEqual({
      nome: 'Gráfica Exemplo Ltda',
      documento: '11222333000181',
    })
  })

  it('CNPJ com dígito errado não vai para o cadastro e gera aviso', () => {
    const l = montarLeitura(
      extraido({ fornecedor: { nome: 'Fornecedor', documento: '11.222.333/0001-82' } }),
      CONTEXTO,
      null,
    )
    expect(l.fornecedorNovo).toEqual({ nome: 'Fornecedor', documento: null })
    expect(l.avisos.some((a) => a.includes('dígito verificador'))).toBe(true)
  })

  it('descarta id fora das listas, data impossível e valor não positivo, avisando', () => {
    const l = montarLeitura(
      extraido({
        categoriaId: 99,
        empreendimentoId: 7,
        valorCentavos: -5,
        dataDocumento: '2026-02-30',
        parcelas: [
          { vencimento: '2026-13-01', valorCentavos: 1000 },
          { vencimento: '2026-10-06', valorCentavos: 0 },
        ],
      }),
      CONTEXTO,
      null,
    )
    expect(l.categoriaId).toBeNull()
    expect(l.empreendimentoId).toBe(7)
    expect(l.valorCentavos).toBeNull()
    expect(l.dataGasto).toBeNull()
    expect(l.parcelas).toEqual([])
    expect(l.avisos.some((a) => a.includes('categoria'))).toBe(true)
    expect(l.avisos.some((a) => a.includes('vencimento'))).toBe(true)
  })

  it('avisa vencimento em fim de semana e parcelas que não fecham com o total', () => {
    const l = montarLeitura(
      extraido({
        valorCentavos: 30000,
        parcelas: [
          { vencimento: '2026-10-04', valorCentavos: 10000 }, // domingo
          { vencimento: '2026-11-04', valorCentavos: 10000 },
        ],
      }),
      CONTEXTO,
      null,
    )
    expect(l.avisos.some((a) => a.includes('04/10') && a.includes('domingo'))).toBe(true)
    expect(l.avisos.some((a) => a.includes('não somam'))).toBe(true)
  })

  it('tipo desconhecido vira "outro" e textos longos são cortados', () => {
    const l = montarLeitura(
      extraido({ tipoDocumento: 'extrato' as never, descricao: 'x'.repeat(500) }),
      CONTEXTO,
      null,
    )
    expect(l.tipoDocumento).toBe('outro')
    expect(l.descricao).toHaveLength(300)
  })
})

describe('documentoParaBusca', () => {
  it('só devolve documento válido, sem pontuação', () => {
    expect(documentoParaBusca(extraido())).toBe('11222333000181')
    expect(documentoParaBusca(extraido({ fornecedor: { nome: 'x', documento: '123' } }))).toBeNull()
    expect(documentoParaBusca(extraido({ fornecedor: null }))).toBeNull()
  })
})
