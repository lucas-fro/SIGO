import {
  ancorado,
  centroDoEmpreendimento,
  dataDoPagamento,
  decidir,
  horariosEmTorno,
  nomesParecidos,
  numeroDoCodigo,
  numeroDoSienge,
  parcelasPagas,
  provasDe,
  tituloElegivel,
  vinculoDas,
  type Candidato,
  type LancamentoParaCasar,
  type ParcelaSigo,
  type TituloCandidato,
} from './casamento.js'

describe('números de documento', () => {
  it('SIGO: só dígitos, sem zeros à esquerda; linha digitável não serve', () => {
    expect(numeroDoCodigo('NFS-e nº 826')).toBe('826')
    expect(numeroDoCodigo('00002684')).toBe('2684')
    expect(numeroDoCodigo('23793.38128 60000.000003 00000.000400 1 84340000012345')).toBeNull()
    expect(numeroDoCodigo('sem número')).toBeNull()
    expect(numeroDoCodigo(null)).toBeNull()
  })

  it('Sienge: só vale número puro; texto livre fica de fora', () => {
    expect(numeroDoSienge('00002684')).toBe('2684')
    expect(numeroDoSienge('ND-076188')).toBeNull()
    expect(numeroDoSienge('GOOGLE NETO 05/08')).toBeNull()
    expect(numeroDoSienge('01KZCHMJM2')).toBeNull()
  })

  it('título de contrato ou provisão, e o que não está completo, não entram', () => {
    expect(tituloElegivel({ id: 1, status: 'S', documentIdentificationId: 'NFSE' })).toBe(true)
    expect(tituloElegivel({ id: 1, status: 'S', documentIdentificationId: 'PCT ' })).toBe(false)
    expect(tituloElegivel({ id: 1, status: 'I', documentIdentificationId: 'NFSE' })).toBe(false)
  })
})

describe('nomes', () => {
  it('fornecedor × credor: as palavras que identificam o nome mais curto estão no outro', () => {
    const plena = { nome: 'PLENA TERCEIRIZACAO DE MAO DE OBRA LTDA' }
    expect(nomesParecidos('Plena Terceirização', plena)).toBe(true)
    expect(nomesParecidos('Google Ads', { nome: 'GOOGLE BRASIL INTERNET LTDA' })).toBe(true)
    expect(nomesParecidos('3D Studio Arts', { nome: '3D STUDIO ARTS PRODUCOES LTDA' })).toBe(true)
    expect(nomesParecidos('Rádio Cidade FM', { nome: 'CIDADE ALTA COMUNICACAO LTDA' })).toBe(false)
    expect(nomesParecidos('Meta Ads', { nome: 'FACEBOOK SERVICOS ONLINE DO BRASIL LTDA' })).toBe(
      false,
    )
    // Só palavra genérica não identifica ninguém.
    expect(
      nomesParecidos('Serviços de Marketing Ltda', { nome: 'MARKETING E SERVICOS LTDA' }),
    ).toBe(false)
    // A fantasia também vale.
    expect(nomesParecidos('Canva', { nome: 'CANVA PTY LTD', nomeFantasia: 'Canva' })).toBe(true)
  })

  it('uma palavra sozinha (sobrenome, palavra comum) não identifica a empresa', () => {
    expect(nomesParecidos('Agência Nova Comunicação', { nome: 'NOVA ERA CONSTRUCOES LTDA' })).toBe(
      false,
    )
    expect(nomesParecidos('Silva Marketing Digital', { nome: 'JOSE DA SILVA' })).toBe(false)
    expect(nomesParecidos('Rádio Cidade FM', { nome: 'X', nomeFantasia: 'CIDADE' })).toBe(false)
    expect(nomesParecidos('Plena', { nome: 'PLENA TERCEIRIZACAO DE MAO DE OBRA LTDA' })).toBe(false)
  })

  const CENTROS = [
    { id: 187, nome: 'LUMINE RESIDENCE - MARKETING' },
    { id: 65, nome: 'SMART METRO PATRIARCA - MARKETING' },
    { id: 127, nome: 'SMART CIDADE PATRIARCA - MARKETING' },
    { id: 25, nome: 'SMART BONSUCESSO - MARKETING' },
    { id: 7, nome: 'LAZER & VIDA BONSUCESSO - MARKETING' },
    { id: 207, nome: 'LANÍ OCEAN VIEW RESIDENCE - MARKETING' },
  ]

  it('empreendimento × centro de custo do setor: só com um par único', () => {
    const centro = (nome: string) => centroDoEmpreendimento(nome, CENTROS, 'MARKETING')
    expect(centro('Lumine Residence')).toBe(187)
    expect(centro('Residencial Lumine')).toBe(187)
    expect(centro('Smart Metrô Patriarca')).toBe(65)
    expect(centro('Metrô Patriarca')).toBe(65)
    expect(centro('Smart Bonsucesso')).toBe(25)
    expect(centro('Laní Ocean View')).toBe(207)
    // Serve a dois centros: sem par.
    expect(centro('Patriarca')).toBeNull()
    expect(centro('Bonsucesso')).toBeNull()
    expect(centro('Institucional')).toBeNull()
    expect(centro('')).toBeNull()
  })
})

// ---------- casamento por provas ----------

const LANC: LancamentoParaCasar = {
  valorCentavos: 250000,
  codigoIdentificacao: null,
  dataGasto: '2026-08-03',
  vencimentos: ['2026-08-18'],
  centroDoEmpreendimento: null,
  centrosDoSetor: [187, 65, 127, 25, 207],
}

const titulo = (id: number, extra: Partial<TituloCandidato> = {}): TituloCandidato => ({
  id,
  creditorId: 3844,
  documentIdentificationId: 'NFSE',
  documentNumber: null,
  issueDate: '2026-08-03',
  totalInvoiceAmount: 2500,
  installmentsNumber: 1,
  status: 'S',
  ...extra,
})

const candidato = (t: TituloCandidato, extra: Partial<Candidato> = {}): Candidato => ({
  titulo: t,
  doFornecedor: true,
  nomeParecido: false,
  centros: null,
  parcelas: [{ installmentNumber: 1, dueDate: '2026-08-18' }],
  ...extra,
})

/**
 * Os cinco títulos reais do credor 3844 de 03/08/2026: R$ 2.500,00 cada, um
 * por empreendimento, cada um com o seu número de nota.
 */
const GEMEOS: Candidato[] = [
  candidato(titulo(32300, { documentNumber: '00000082' }), { centros: [65] }),
  candidato(titulo(32301, { documentNumber: '00000083' }), { centros: [127] }),
  candidato(titulo(32302, { documentNumber: '00000084' }), { centros: [25] }),
  candidato(titulo(32303, { documentNumber: '00000085' }), { centros: [187] }),
  candidato(titulo(32304, { documentNumber: '00000086' }), { centros: [207] }),
]

describe('decidir: notas iguais da mesma agência, uma por empreendimento', () => {
  it('só com CNPJ, valor e vencimento, os cinco empatam e nada casa', () => {
    const r = decidir(LANC, GEMEOS)
    expect(r).toEqual({ tipo: 'ambiguo', tituloIds: [32300, 32301, 32302, 32303, 32304] })
  })

  it('o empreendimento do lançamento separa (os outros são vetados)', () => {
    const r = decidir({ ...LANC, centroDoEmpreendimento: 187 }, GEMEOS)
    expect(r.tipo).toBe('casado')
    if (r.tipo !== 'casado') return
    expect(r.tituloId).toBe(32303)
    expect(r.provas).toEqual(
      expect.arrayContaining(['fornecedor', 'valor', 'vencimento', 'empreendimento', 'setor']),
    )
    expect(vinculoDas(r.provas)).toBe('valor')
  })

  it('o número da nota separa', () => {
    const r = decidir({ ...LANC, codigoIdentificacao: 'NFS-e 84' }, GEMEOS)
    expect(r).toMatchObject({ tipo: 'casado', tituloId: 32302 })
    if (r.tipo === 'casado') expect(vinculoDas(r.provas)).toBe('numero')
  })

  it('número e empreendimento que se contradizem: não casa', () => {
    // A NF 84 foi para o Smart Bonsucesso, não para o Lumine.
    const r = decidir(
      { ...LANC, codigoIdentificacao: 'NFS-e 84', centroDoEmpreendimento: 187 },
      GEMEOS,
    )
    expect(r).toEqual({ tipo: 'nenhum' })
  })
})

describe('decidir: sem CNPJ, pela cópia do setor', () => {
  // Reais: a NFS-e 93 existe em dois credores, com valores bem diferentes.
  const NF93_OUTRO = candidato(
    titulo(32483, { creditorId: 3844, documentNumber: '00000093', totalInvoiceAmount: 345.6 }),
    { doFornecedor: false, centros: [127] },
  )
  const NF93 = (extra: Partial<Candidato> = {}) =>
    candidato(
      titulo(33778, {
        creditorId: 3968,
        documentNumber: '00000093',
        totalInvoiceAmount: 47950,
        issueDate: '2026-09-23',
        installmentsNumber: 3,
      }),
      {
        doFornecedor: false,
        centros: [127],
        parcelas: [
          { installmentNumber: 1, dueDate: '2026-09-25' },
          { installmentNumber: 2, dueDate: '2026-09-30' },
          { installmentNumber: 3, dueDate: '2026-10-15' },
        ],
        ...extra,
      },
    )
  const SEM_CNPJ: LancamentoParaCasar = {
    ...LANC,
    valorCentavos: 4795000,
    codigoIdentificacao: 'NFS-e 93',
    dataGasto: '2026-09-23',
    vencimentos: ['2026-09-25', '2026-09-30', '2026-10-15'],
  }

  it('nome do fornecedor + número + valor casa; o mesmo número de outro credor sai pelo valor', () => {
    const r = decidir(SEM_CNPJ, [NF93_OUTRO, NF93({ nomeParecido: true })])
    expect(r).toMatchObject({ tipo: 'casado', tituloId: 33778 })
    if (r.tipo === 'casado') expect(r.provas).toContain('nomeFornecedor')
    expect(provasDe(SEM_CNPJ, NF93_OUTRO)).toBeNull()
  })

  it('sem nome parecido, número + valor não bastam; com vencimento e emissão, sim', () => {
    const semDatas = NF93({ parcelas: null, titulo: { ...NF93().titulo, issueDate: '2026-08-01' } })
    expect(decidir(SEM_CNPJ, [semDatas])).toEqual({ tipo: 'nenhum' })
    expect(decidir(SEM_CNPJ, [NF93()])).toMatchObject({ tipo: 'casado', tituloId: 33778 })
  })

  it('sem número e sem nome parecido, coincidência de valor redondo não casa', () => {
    // Valor, vencimento, parcelas, emissão e até o empreendimento batendo: sem fornecedor nem nota, fica.
    const redondo = candidato(titulo(40000), { doFornecedor: false, centros: [187] })
    const r = decidir({ ...LANC, centroDoEmpreendimento: 187 }, [redondo])
    expect(r).toEqual({ tipo: 'nenhum' })
  })

  it('nome parecido + valor + vencimento + mais uma prova casa sem número', () => {
    const c = candidato(titulo(40001), { doFornecedor: false, nomeParecido: true, centros: [187] })
    expect(decidir(LANC, [c])).toMatchObject({ tipo: 'casado', tituloId: 40001 })
  })
})

describe('provas e vetos', () => {
  it('imposto retido: o líquido do SIGO até 15% abaixo do bruto do Sienge, só com o mesmo número', () => {
    const l = { ...LANC, valorCentavos: 244214, codigoIdentificacao: 'NFS-e 84' }
    const c = candidato(titulo(1, { documentNumber: '84', totalInvoiceAmount: 2550 }))
    expect(provasDe(l, c)).toEqual(expect.arrayContaining(['numero', 'retencao', 'fornecedor']))
    expect(decidir(l, [c])).toMatchObject({ tipo: 'casado', tituloId: 1 })
    // Longe demais do bruto, ou sem o número: vetado.
    expect(provasDe({ ...l, valorCentavos: 150000 }, c)).toBeNull()
    expect(provasDe({ ...l, codigoIdentificacao: null }, c)).toBeNull()
  })

  it('a NF 85 não é a NF 84, por mais que valor e vencimento batam', () => {
    const l = { ...LANC, codigoIdentificacao: 'NFS-e 84' }
    expect(provasDe(l, candidato(titulo(2, { documentNumber: '00000085' })))).toBeNull()
    // Texto livre no Sienge não contradiz.
    expect(provasDe(l, candidato(titulo(3, { documentNumber: 'BOL 233' })))).not.toBeNull()
  })

  it('vencimento que andou até 3 dias aparece nas provas, mas não fecha âncora', () => {
    const c = candidato(titulo(4), { parcelas: [{ installmentNumber: 1, dueDate: '2026-08-20' }] })
    expect(provasDe(LANC, c)).toEqual(expect.arrayContaining(['vencimentoProximo', 'emissao']))
    expect(decidir(LANC, [c])).toEqual({ tipo: 'nenhum' })
  })

  it('parcela única dos dois lados não é prova; 2 ou mais iguais, sim', () => {
    expect(provasDe(LANC, candidato(titulo(13)))).not.toContain('parcelas')
    const tres = { ...LANC, vencimentos: ['2026-08-18', '2026-09-18', '2026-10-18'] }
    expect(provasDe(tres, candidato(titulo(14, { installmentsNumber: 3 })))).toContain('parcelas')
    // Nome + valor + vencimento com só "parcelas" de sobra não fecha (era o caso da parcela única).
    expect(ancorado(['nomeFornecedor', 'valor', 'vencimento', 'parcelas'])).toBe(false)
  })

  it('desempate: vencimento exato ganha; o do setor ganha do de outro setor, os dois conhecidos', () => {
    const exato = candidato(titulo(6))
    const proximo = candidato(titulo(7), {
      parcelas: [{ installmentNumber: 1, dueDate: '2026-08-19' }],
    })
    expect(decidir(LANC, [proximo, exato])).toMatchObject({ tipo: 'casado', tituloId: 6 })

    const doMarketing = candidato(titulo(8), { centros: [65] })
    const deOutroSetor = candidato(titulo(9), { centros: [999] })
    expect(decidir(LANC, [deOutroSetor, doMarketing])).toMatchObject({
      tipo: 'casado',
      tituloId: 8,
    })
  })

  it('quem está fora da cópia (centros desconhecidos) não perde desempate por isso', () => {
    // Título lançado no Sienge depois da última cópia: pode ser o certo, então empata.
    const naCopia = candidato(titulo(20), { centros: [65] })
    const foraDaCopia = candidato(titulo(21), { centros: null })
    expect(decidir(LANC, [naCopia, foraDaCopia])).toEqual({
      tipo: 'ambiguo',
      tituloIds: [20, 21],
    })
    // Com empreendimento: o conhecido no empreendimento também não ganha do desconhecido.
    const lumine = { ...LANC, centroDoEmpreendimento: 187 }
    const doLumine = candidato(titulo(22), { centros: [187] })
    expect(decidir(lumine, [doLumine, foraDaCopia])).toEqual({
      tipo: 'ambiguo',
      tituloIds: [22, 21],
    })
    // O que se sabe ser de outro empreendimento sai; sobrando um só, é ele (como o candidato único).
    const doMetro = candidato(titulo(23), { centros: [65] })
    expect(decidir(lumine, [doMetro, foraDaCopia])).toMatchObject({ tipo: 'casado', tituloId: 21 })
    // Parcelas não lidas: o vencimento não desempata (os dois fecham âncora pelo número).
    const nota84 = { ...LANC, codigoIdentificacao: 'NFS-e 84' }
    const comParcelas = candidato(titulo(24, { documentNumber: '84' }))
    const semParcelas = candidato(titulo(25, { documentNumber: '84' }), { parcelas: null })
    expect(decidir(nota84, [comParcelas, semParcelas])).toEqual({
      tipo: 'ambiguo',
      tituloIds: [24, 25],
    })
  })

  it('título que não está no empreendimento do lançamento é vetado; sem saber os centros, não', () => {
    const l = { ...LANC, centroDoEmpreendimento: 187 }
    expect(provasDe(l, candidato(titulo(10), { centros: [65] }))).toBeNull()
    expect(provasDe(l, candidato(titulo(11), { centros: [] }))).toBeNull()
    expect(provasDe(l, candidato(titulo(12), { centros: null }))).not.toBeNull()
  })

  it('âncoras: prova fraca sozinha não fecha', () => {
    expect(ancorado(['valor', 'emissao', 'parcelas', 'setor'])).toBe(false)
    expect(ancorado(['fornecedor', 'valor'])).toBe(false)
    expect(ancorado(['fornecedor', 'valor', 'vencimento'])).toBe(true)
    expect(ancorado(['fornecedor', 'numero', 'retencao'])).toBe(true)
    expect(ancorado(['numero', 'valor', 'vencimento'])).toBe(false)
    expect(ancorado(['numero', 'valor', 'vencimento', 'emissao'])).toBe(true)
    // Vencimento só perto (até 3 dias) não fecha nenhuma.
    expect(ancorado(['fornecedor', 'valor', 'vencimentoProximo', 'parcelas', 'emissao'])).toBe(
      false,
    )
  })
})

const P = (numero: number, vencimento: string, pagoEm: string | null = null): ParcelaSigo => ({
  id: numero * 100,
  numero,
  vencimento,
  pagoEm,
})

describe('parcelasPagas', () => {
  it('mesma quantidade: casa pela ordem de vencimento, mesmo com a API fora de ordem', () => {
    const r = parcelasPagas(
      [P(1, '2026-09-25'), P(2, '2026-09-30'), P(3, '2026-10-15')],
      [
        { installmentNumber: 3, dueDate: '2026-10-15', situation: 'Não paga' },
        { installmentNumber: 2, dueDate: '2026-09-30', situation: 'Parcialmente paga' },
        { installmentNumber: 1, dueDate: '2026-09-25', situation: 'Totalmente paga' },
      ],
    )
    expect(r.map((x) => [x.parcela.numero, x.numeroSienge])).toEqual([[1, 1]])
  })

  it('parcela já paga no SIGO não volta', () => {
    const r = parcelasPagas(
      [P(1, '2026-09-25', '2026-09-24')],
      [{ installmentNumber: 1, situation: 'Totalmente paga' }],
    )
    expect(r).toEqual([])
  })

  it('quantidade diferente: só marca com o título inteiro quitado', () => {
    const sigo = [P(1, '2026-10-05')]
    expect(
      parcelasPagas(sigo, [
        { installmentNumber: 1, dueDate: '2026-10-05', situation: 'Totalmente paga' },
        { installmentNumber: 2, dueDate: '2026-11-05', situation: 'Não paga' },
      ]),
    ).toEqual([])
    expect(
      parcelasPagas(sigo, [
        { installmentNumber: 1, dueDate: '2026-10-05', situation: 'Totalmente paga' },
        { installmentNumber: 2, dueDate: '2026-11-05', situation: 'Totalmente paga' },
      ]).map((x) => x.numeroSienge),
    ).toEqual([2])
  })

  it('"Não paga" contém "paga", mas não marca', () => {
    expect(
      parcelasPagas([P(1, '2026-10-05')], [{ installmentNumber: 1, situation: 'Não paga' }]),
    ).toEqual([])
  })
})

describe('dataDoPagamento', () => {
  it('a data do último movimento de pagamento da parcela', () => {
    const movimentos = [
      { tituloId: 32440, parcela: 1, data: '2026-08-10' },
      { tituloId: 32440, parcela: 1, data: '2026-08-14' },
      { tituloId: 32440, parcela: 2, data: '2026-09-14' },
      { tituloId: 99, parcela: 1, data: '2026-08-20' },
    ]
    expect(dataDoPagamento(movimentos, 32440, 1)).toBe('2026-08-14')
    expect(dataDoPagamento(movimentos, 32440, 3)).toBeNull()
  })
})

describe('horariosEmTorno', () => {
  it('00h e 12h de São Paulo (UTC-3)', () => {
    // 29/09 às 10h30 em São Paulo = 13h30 UTC
    const { anterior, proximo } = horariosEmTorno(new Date('2026-09-29T13:30:00Z'), [
      '00:00',
      '12:00',
    ])
    expect(anterior?.toISOString()).toBe('2026-09-29T03:00:00.000Z')
    expect(proximo?.toISOString()).toBe('2026-09-29T15:00:00.000Z')
  })

  it('perto da meia-noite, o próximo é amanhã às 00h', () => {
    const { anterior, proximo } = horariosEmTorno(new Date('2026-09-30T02:59:00Z'), [
      '00:00',
      '12:00',
    ])
    expect(anterior?.toISOString()).toBe('2026-09-29T15:00:00.000Z')
    expect(proximo?.toISOString()).toBe('2026-09-30T03:00:00.000Z')
  })

  it('sem horários, nada agendado', () => {
    expect(horariosEmTorno(new Date(), [])).toEqual({ anterior: null, proximo: null })
  })
})
