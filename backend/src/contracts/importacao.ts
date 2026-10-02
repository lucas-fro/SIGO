import { z } from 'zod'
import type {
  Cartao,
  Categoria,
  Empreendimento,
  FormaPagamento,
  Fornecedor,
  Setor,
} from './cadastros.js'
import { data, textoOpcional, valorCentavos } from './comum.js'
import { hoje, vencimentoDaFatura } from './datas.js'
import { documentoValido, normalizarDocumento } from './documento.js'
import { parcelaSchema, type ParcelaInput } from './lancamentos.js'
import { somaCentavos } from './parcelas.js'

/*
  Importação de lançamentos e recargas em JSON. TEMPORÁRIA: existe enquanto a
  leitura por IA não está ligada no SIGO.

  Os documentos (nota, boleto, prints do extrato do cartão, fotos de cupom)
  são lidos fora do sistema, numa conversa com o Claude, que devolve um
  arquivo neste formato junto com os comprovantes. A aba Importar, em
  Cadastros, confere o arquivo, acha cada cadastro pelo nome e grava pelas
  rotas de sempre (fornecedor, comprovante, recarga, lançamento), com todas as
  regras delas.

  O arquivo cita os cadastros pelo nome, como aparecem no SIGO, e o cartão
  pelos 4 últimos dígitos: quem monta o arquivo não conhece os ids.

  Para tirar: este arquivo e o spec, o componente `ImportacaoCadastro.vue` e a
  aba dele em `cadastros.vue`, o script `importacao:conferir` e a skill
  `importacao-sigo`.
*/

export const FORMATO_IMPORTACAO = 'sigo-importacao/1'

/** Nome de um cadastro como aparece no SIGO; vazio vira null. */
const nomeDeCadastro = z
  .string()
  .trim()
  .max(200, { error: 'Nome longo demais' })
  .nullish()
  .transform((v) => v || null)

const dataOpcional = (error: string) =>
  data(error)
    .nullish()
    .transform((v) => v ?? null)

const lancamentoImportadoSchema = z
  .object({
    descricao: z
      .string({ error: 'Descreva o gasto' })
      .trim()
      .min(3, { error: 'Descreva o gasto em poucas palavras (mínimo 3 letras)' })
      .max(300, { error: 'Use no máximo 300 caracteres na descrição' }),
    valorCentavos: valorCentavos('Informe o valor em centavos'),
    /** Sem data, vale hoje. */
    dataGasto: dataOpcional('Data do gasto inválida'),
    /** Quem recebe: o emitente da nota ou o beneficiário do boleto. */
    fornecedor: z
      .object({
        nome: z
          .string({ error: 'Informe o nome do fornecedor' })
          .trim()
          .min(2, { error: 'Nome do fornecedor curto demais' })
          .max(120, { error: 'Use no máximo 120 caracteres no nome do fornecedor' }),
        documento: z
          .string()
          .trim()
          .max(30)
          .nullish()
          .transform((v) => v || null),
      })
      .nullish()
      .transform((v) => v ?? null),
    codigoIdentificacao: textoOpcional(100),
    categoria: nomeDeCadastro,
    empreendimento: nomeDeCadastro,
    formaPagamento: nomeDeCadastro,
    /** Os 4 últimos dígitos ou o nome do cartão. */
    cartao: nomeDeCadastro,
    /** À vista (sem `parcelas`): o vencimento e o pagamento da parcela única. */
    vencimento: dataOpcional('Vencimento inválido'),
    pagoEm: dataOpcional('Data de pagamento inválida'),
    parcelas: z
      .array(parcelaSchema)
      .min(1, { error: 'Informe ao menos uma parcela' })
      .max(60, { error: 'Use no máximo 60 parcelas' })
      .nullish()
      .transform((v) => v ?? null),
    observacao: textoOpcional(2000),
    /** Nomes dos arquivos que vão junto com o JSON. */
    comprovantes: z
      .array(z.string().trim().min(1).max(255))
      .max(10, { error: 'Anexe no máximo 10 comprovantes por lançamento' })
      .default([]),
    /** O que a pessoa precisa conferir antes de registrar. */
    avisos: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  })
  .refine((l) => !l.parcelas || (l.vencimento === null && l.pagoEm === null), {
    error: 'Use "parcelas" ou "vencimento"/"pagoEm", não os dois',
    path: ['parcelas'],
  })
  .refine((l) => !l.parcelas || somaCentavos(l.parcelas) === l.valorCentavos, {
    error: 'A soma das parcelas precisa ser igual ao valor',
    path: ['parcelas'],
  })

const recargaImportadaSchema = z.object({
  /** Os 4 últimos dígitos ou o nome do cartão. */
  cartao: z.string({ error: 'Informe o cartão da recarga' }).trim().min(1).max(120),
  data: data('Informe a data da recarga'),
  valorCentavos: valorCentavos('Informe o valor da recarga em centavos'),
  observacao: textoOpcional(200),
})

export const importacaoSchema = z
  .object({
    formato: z.literal(FORMATO_IMPORTACAO, {
      error: `Este arquivo não é uma importação do SIGO (o formato precisa ser "${FORMATO_IMPORTACAO}")`,
    }),
    titulo: textoOpcional(200),
    /** Sem setor, vale o escolhido na aba Importar. */
    setor: nomeDeCadastro,
    /** O saldo que o app do banco mostra, para conferir o cartão depois de importar. */
    saldoExtrato: z
      .object({
        cartao: z.string().trim().min(1).max(120),
        centavos: z.number().int(),
        em: data('Data do saldo inválida'),
      })
      .nullish()
      .transform((v) => v ?? null),
    recargas: z.array(recargaImportadaSchema).max(100).default([]),
    lancamentos: z.array(lancamentoImportadoSchema).max(200).default([]),
  })
  .refine((v) => v.recargas.length + v.lancamentos.length > 0, {
    error: 'O arquivo não tem lançamento nem recarga',
  })
export type Importacao = z.output<typeof importacaoSchema>
export type LancamentoImportado = Importacao['lancamentos'][number]
export type RecargaImportada = Importacao['recargas'][number]

// ---------- os nomes do arquivo × os cadastros ----------

/** Nome para comparar: sem acento, sem diferença de maiúscula e com espaços simples. */
export function normalizarNome(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * O cadastro com o mesmo nome ou, sem nenhum igual, o único cujo nome contém o
 * procurado (ou está contido nele): "Jardim Aurora" acha "Residencial Jardim
 * Aurora". Dois que servem é ambíguo, e aí não escolhe.
 */
function acharPorNome<T extends { nome: string }>(
  itens: readonly T[],
  procurado: string,
): T | 'ambiguo' | null {
  const alvo = normalizarNome(procurado)
  const iguais = itens.filter((i) => normalizarNome(i.nome) === alvo)
  if (iguais.length) return iguais.length === 1 ? iguais[0]! : 'ambiguo'
  if (alvo.length < 4) return null
  const parecidos = itens.filter((i) => {
    const nome = normalizarNome(i.nome)
    return nome.includes(alvo) || alvo.includes(nome)
  })
  if (parecidos.length > 1) return 'ambiguo'
  return parecidos[0] ?? null
}

type CartaoDaImportacao = Pick<
  Cartao,
  | 'id'
  | 'nome'
  | 'final'
  | 'setorId'
  | 'formaPagamentoId'
  | 'recarga'
  | 'diaFechamento'
  | 'diaVencimento'
  | 'ativo'
  | 'recargas'
>

/** Cartão ativo do setor pelos 4 últimos dígitos (só se um cartão tiver esse final) ou pelo nome. */
function acharCartao(
  cartoes: readonly CartaoDaImportacao[],
  setorId: number,
  procurado: string,
): CartaoDaImportacao | null {
  const doSetor = cartoes.filter((c) => c.setorId === setorId && c.ativo)
  if (/^\d{4}$/.test(procurado)) {
    const doFinal = doSetor.filter((c) => c.final === procurado)
    return doFinal.length === 1 ? doFinal[0]! : null
  }
  const achado = acharPorNome(doSetor, procurado)
  return achado === 'ambiguo' ? null : achado
}

/** O que a importação precisa dos cadastros: as listas de GET /cadastros e os fornecedores. */
export interface CadastrosDaImportacao {
  setores: ReadonlyArray<Pick<Setor, 'id' | 'nome'>>
  categorias: ReadonlyArray<Pick<Categoria, 'id' | 'nome' | 'setorId' | 'ativo'>>
  empreendimentos: ReadonlyArray<Pick<Empreendimento, 'id' | 'nome' | 'ativo'>>
  formasPagamento: ReadonlyArray<Pick<FormaPagamento, 'id' | 'nome' | 'cartao' | 'ativo'>>
  cartoes: readonly CartaoDaImportacao[]
  fornecedores: readonly Fornecedor[]
}

export interface ProblemaImportacao {
  /** Erro deixa a linha de fora; aviso só pede conferência. */
  nivel: 'erro' | 'aviso'
  texto: string
}

export interface LancamentoPreparado {
  /** A posição no arquivo. */
  indice: number
  original: LancamentoImportado
  /** O corpo de POST /lancamentos, menos os comprovantes e o fornecedor novo. */
  dados: {
    setorId: number
    descricao: string
    valorCentavos: number
    dataGasto: string
    categoriaId: number | null
    formaPagamentoId: number | null
    empreendimentoId: number | null
    fornecedorId: number | null
    campanhaId: null
    cartaoId: number | null
    codigoIdentificacao: string | null
    observacao: string | null
    parcelas: ParcelaInput[]
  }
  /** Fornecedor fora do cadastro: a importação cadastra antes de gravar o lançamento. */
  fornecedorNovo: { nome: string; documento: string | null } | null
  /** Como cada cadastro ficou, para mostrar na linha (null: em branco). */
  nomes: {
    fornecedor: string | null
    categoria: string | null
    empreendimento: string | null
    forma: string | null
    cartao: string | null
  }
  problemas: ProblemaImportacao[]
}

export interface RecargaPreparada {
  indice: number
  original: RecargaImportada
  /** O corpo de POST /recargas; null quando o cartão não serve. */
  dados: { cartaoId: number; data: string; valorCentavos: number; observacao: string | null } | null
  cartaoNome: string | null
  /** Já há recarga igual no cartão (mesmo dia e valor): fica de fora, salvo se a pessoa marcar. */
  jaRegistrada: boolean
  problemas: ProblemaImportacao[]
}

export interface ImportacaoPreparada {
  /** null quando o setor do arquivo não existe: nada pode ser gravado. */
  setorId: number | null
  problemas: ProblemaImportacao[]
  saldoExtrato: { cartaoId: number; cartaoNome: string; centavos: number; em: string } | null
  recargas: RecargaPreparada[]
  lancamentos: LancamentoPreparado[]
}

/**
 * Acha os cadastros citados no arquivo e monta o que cada rota vai receber.
 * Cadastro que não se acha fica em branco, com aviso; cartão que não se acha
 * é erro, porque a compra ficaria fora do saldo e do orçamento dele.
 */
export function prepararImportacao(
  arquivo: Importacao,
  cadastros: CadastrosDaImportacao,
  setorPadrao: number | null,
  dia: string = hoje(),
): ImportacaoPreparada {
  const problemas: ProblemaImportacao[] = []
  let setorId = setorPadrao
  if (arquivo.setor) {
    const setor = acharPorNome(cadastros.setores, arquivo.setor)
    setorId = setor && setor !== 'ambiguo' ? setor.id : null
    if (setorId === null) {
      problemas.push({ nivel: 'erro', texto: `Setor “${arquivo.setor}” não encontrado` })
    }
  } else if (setorId === null) {
    problemas.push({ nivel: 'erro', texto: 'Escolha o setor da importação' })
  }
  if (setorId === null) {
    return { setorId, problemas, saldoExtrato: null, recargas: [], lancamentos: [] }
  }
  const setor = setorId

  let saldoExtrato: ImportacaoPreparada['saldoExtrato'] = null
  if (arquivo.saldoExtrato) {
    const cartao = acharCartao(cadastros.cartoes, setor, arquivo.saldoExtrato.cartao)
    if (cartao) {
      saldoExtrato = {
        cartaoId: cartao.id,
        cartaoNome: cartao.nome,
        centavos: arquivo.saldoExtrato.centavos,
        em: arquivo.saldoExtrato.em,
      }
    } else {
      problemas.push({
        nivel: 'aviso',
        texto: `Cartão “${arquivo.saldoExtrato.cartao}” do saldo do extrato não encontrado: o saldo não é conferido`,
      })
    }
  }

  const recargas = arquivo.recargas.map((r, indice): RecargaPreparada => {
    const problemasDaRecarga: ProblemaImportacao[] = []
    const cartao = acharCartao(cadastros.cartoes, setor, r.cartao)
    if (!cartao) {
      problemasDaRecarga.push({
        nivel: 'erro',
        texto: `Cartão “${r.cartao}” não encontrado neste setor: cadastre na página Cartão`,
      })
    } else if (cartao.recarga !== 'avulsa') {
      problemasDaRecarga.push({
        nivel: 'erro',
        texto: `${cartao.nome} tem orçamento mensal: recarga é só para cartão de recarga avulsa`,
      })
    }
    if (r.data > dia) {
      problemasDaRecarga.push({ nivel: 'erro', texto: 'A recarga não pode ter data no futuro' })
    }
    const jaRegistrada =
      !!cartao &&
      cartao.recargas.some((x) => x.data === r.data && x.valorCentavos === r.valorCentavos)
    if (jaRegistrada) {
      problemasDaRecarga.push({
        nivel: 'aviso',
        texto: 'Já existe recarga igual (mesmo dia e valor) neste cartão',
      })
    }
    const serve = cartao && !problemasDaRecarga.some((p) => p.nivel === 'erro')
    return {
      indice,
      original: r,
      dados: serve
        ? {
            cartaoId: cartao.id,
            data: r.data,
            valorCentavos: r.valorCentavos,
            observacao: r.observacao,
          }
        : null,
      cartaoNome: cartao?.nome ?? null,
      jaRegistrada,
      problemas: problemasDaRecarga,
    }
  })

  const categorias = cadastros.categorias.filter((c) => c.setorId === setor && c.ativo)
  const empreendimentos = cadastros.empreendimentos.filter((e) => e.ativo)
  const formas = cadastros.formasPagamento.filter((f) => f.ativo)

  const lancamentos = arquivo.lancamentos.map((l, indice): LancamentoPreparado => {
    const problemasDoLancamento: ProblemaImportacao[] = l.avisos.map((texto) => ({
      nivel: 'aviso',
      texto,
    }))
    const aviso = (texto: string) => problemasDoLancamento.push({ nivel: 'aviso', texto })
    const erro = (texto: string) => problemasDoLancamento.push({ nivel: 'erro', texto })

    /** Um cadastro pelo nome; o que não se acha fica em branco, com aviso. */
    function cadastro<T extends { id: number; nome: string }>(
      rotulo: string,
      procurado: string | null,
      itens: readonly T[],
    ): T | null {
      if (!procurado) return null
      const achado = acharPorNome(itens, procurado)
      if (achado === 'ambiguo') {
        aviso(`${rotulo} “${procurado}” bate com mais de um cadastro: fica em branco`)
        return null
      }
      if (!achado) aviso(`${rotulo} “${procurado}” não está no cadastro: fica em branco`)
      return achado
    }

    const dataGasto = l.dataGasto ?? dia

    // Fornecedor: pelo documento; sem documento (ou sem cadastro com ele), pelo nome igual.
    let fornecedorId: number | null = null
    let fornecedorNovo: LancamentoPreparado['fornecedorNovo'] = null
    let nomeFornecedor: string | null = null
    if (l.fornecedor) {
      const informado = l.fornecedor.documento
      const documento =
        informado && documentoValido(informado) ? normalizarDocumento(informado) : null
      if (informado && !documento) {
        aviso(`CPF/CNPJ “${informado}” inválido: o fornecedor é procurado só pelo nome`)
      }
      const alvo = normalizarNome(l.fornecedor.nome)
      // Com documento, o nome só acha cadastro sem documento: outro CNPJ é outra empresa.
      const porDocumento = documento
        ? cadastros.fornecedores.find((f) => f.documento === documento)
        : undefined
      const achado =
        porDocumento ??
        cadastros.fornecedores.find(
          (f) => normalizarNome(f.nome) === alvo && (!documento || !f.documento),
        )
      if (achado && !achado.ativo) {
        aviso(`Fornecedor “${achado.nome}” está desativado no cadastro: fica em branco`)
      } else if (achado) {
        fornecedorId = achado.id
        nomeFornecedor = achado.nome
      } else {
        fornecedorNovo = { nome: l.fornecedor.nome, documento }
        nomeFornecedor = l.fornecedor.nome
      }
    }

    const categoria = cadastro('Categoria', l.categoria, categorias)
    const empreendimento = cadastro('Empreendimento', l.empreendimento, empreendimentos)
    let forma = cadastro('Forma de pagamento', l.formaPagamento, formas)

    // Cartão: pelo final ou pelo nome. Sem cartão, uma forma de cartão com um
    // cartão só no setor escolhe esse cartão, como faz o formulário.
    let cartao: CartaoDaImportacao | null = null
    if (l.cartao) {
      cartao = acharCartao(cadastros.cartoes, setor, l.cartao)
      if (!cartao)
        erro(`Cartão “${l.cartao}” não encontrado neste setor: cadastre na página Cartão`)
    } else if (forma?.cartao) {
      const daForma = cadastros.cartoes.filter(
        (c) => c.setorId === setor && c.ativo && c.formaPagamentoId === forma!.id,
      )
      if (daForma.length === 1) cartao = daForma[0]!
    }
    if (cartao) {
      const formaDoCartaoId = cartao.formaPagamentoId
      const formaDoCartao = cadastros.formasPagamento.find((f) => f.id === formaDoCartaoId)
      if (forma && forma.id !== formaDoCartaoId) {
        aviso(`Forma de pagamento ajustada para “${formaDoCartao?.nome}”, a do cartão`)
      }
      forma = formaDoCartao ?? null
    }

    const temFatura = !!(cartao?.diaFechamento && cartao.diaVencimento)
    const parcelas: ParcelaInput[] = l.parcelas ?? [
      {
        valorCentavos: l.valorCentavos,
        vencimento:
          l.vencimento ??
          (temFatura
            ? vencimentoDaFatura(dataGasto, cartao!.diaFechamento!, cartao!.diaVencimento!)
            : dataGasto),
        pagoEm: l.pagoEm,
      },
    ]
    if (parcelas.some((p) => p.pagoEm && p.pagoEm > dia)) {
      erro('Pagamento com data no futuro')
    }
    if (cartao && !temFatura && parcelas.some((p) => !p.pagoEm)) {
      aviso('Compra em cartão sem fatura sem data de pagamento: vai aparecer como vencida')
    }

    return {
      indice,
      original: l,
      dados: {
        setorId: setor,
        descricao: l.descricao,
        valorCentavos: l.valorCentavos,
        dataGasto,
        categoriaId: categoria?.id ?? null,
        formaPagamentoId: forma?.id ?? null,
        empreendimentoId: empreendimento?.id ?? null,
        fornecedorId,
        campanhaId: null,
        cartaoId: cartao?.id ?? null,
        codigoIdentificacao: l.codigoIdentificacao,
        observacao: l.observacao,
        parcelas,
      },
      fornecedorNovo,
      nomes: {
        fornecedor: nomeFornecedor,
        categoria: categoria?.nome ?? null,
        empreendimento: empreendimento?.nome ?? null,
        forma: forma?.nome ?? null,
        cartao: cartao ? `${cartao.nome}${cartao.final ? ` •••• ${cartao.final}` : ''}` : null,
      },
      problemas: problemasDoLancamento,
    }
  })

  return { setorId, problemas, saldoExtrato, recargas, lancamentos }
}

/** Chave para casar o nome citado no arquivo com o arquivo enviado: sem diferença de caixa. */
export const chaveDeArquivo = (nome: string): string => nome.normalize('NFC').trim().toLowerCase()
