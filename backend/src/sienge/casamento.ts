import { FUSO } from '../contracts/datas.js'
import type { ProvaSienge } from '../contracts/sienge.js'

/*
  Regras da conferência de pagamentos com o Sienge, em funções puras.

  O lançamento do SIGO é casado com o título a pagar do Sienge (uma vez; o id
  fica guardado) e, a cada conferência, as parcelas do título dizem o que já
  foi pago. Marcar pago errado é pior que não marcar: na dúvida, não casa.

  O casamento soma provas (o que bate entre os dois lados) e respeita vetos
  (o que contradiz). Ele só acontece quando um conjunto de provas fortes
  (uma "âncora") fecha e nenhum outro título empata com o escolhido nas
  provas que desempatam. Os casos que isso resolve, vistos na cópia do
  Marketing: a mesma agência emite no mesmo dia notas de mesmo valor, uma por
  empreendimento, e só o número da nota ou o centro de custo as separa; e o
  mesmo número de nota aparece em fornecedores diferentes.
*/

/** Título como a busca por credor (ou a cópia do Marketing) devolve: só o que o casamento usa. */
export interface TituloCandidato {
  id: number
  creditorId?: number | null
  documentIdentificationId?: string | null
  documentNumber?: string | null
  issueDate?: string | null
  totalInvoiceAmount?: number | null
  /** Quantidade de parcelas, quando a listagem traz. */
  installmentsNumber?: number | null
  status?: string | null
}

/** Parcela do título no Sienge (`/bills/{id}/installments`). */
export interface ParcelaSienge {
  installmentNumber: number
  dueDate?: string | null
  amount?: number | null
  situation?: string | null
}

/** Tipos de documento que não são pagamento de verdade: parcela de contrato e provisão, baixadas por "substituição". */
const TIPOS_FORA = new Set(['PCT', 'PPC', 'PRV'])

export const centavos = (valor: number | null | undefined): number | null =>
  typeof valor === 'number' && Number.isFinite(valor) ? Math.round(valor * 100) : null

/**
 * O número do documento como chave de comparação: só os dígitos, sem zeros à
 * esquerda. No SIGO o código é livre ("NFS-e nº 826"); linha digitável de
 * boleto (dezenas de dígitos) não serve e volta null.
 */
export function numeroDoCodigo(codigo: string | null | undefined): string | null {
  if (!codigo) return null
  const digitos = codigo.replace(/\D/g, '').replace(/^0+/, '')
  return digitos && digitos.length <= 20 ? digitos : null
}

/** No Sienge só vale o número puramente numérico ("00002684"); texto livre ("GOOGLE 05/08") não entra. */
export function numeroDoSienge(documento: string | null | undefined): string | null {
  if (!documento || !/^[0-9./ -]+$/.test(documento.trim())) return null
  return numeroDoCodigo(documento)
}

/** Título que pode ser pagamento de um gasto: completo e de tipo que não é contrato/provisão. */
export const tituloElegivel = (t: TituloCandidato): boolean =>
  (t.status ?? 'S') === 'S' &&
  !TIPOS_FORA.has((t.documentIdentificationId ?? '').trim().toUpperCase())

// ---------- nomes: fornecedor × credor, empreendimento × centro de custo ----------

/** Palavras que não identificam ninguém: tipo de empresa, ramo e ligação. */
const PALAVRAS_GENERICAS = new Set([
  'LTDA',
  'EIRELI',
  'EPP',
  'MEI',
  'CIA',
  'SA',
  'ME',
  'SS',
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'EM',
  'PARA',
  'POR',
  'COM',
  'THE',
  'AND',
  'COMERCIO',
  'SERVICO',
  'SERVICOS',
  'INDUSTRIA',
  'EMPRESA',
  'GRUPO',
  'BRASIL',
  'DIGITAL',
  'PUBLICIDADE',
  'PROPAGANDA',
  'COMUNICACAO',
  'MARKETING',
  'ASSESSORIA',
  'CONSULTORIA',
  'SOLUCOES',
  'NEGOCIOS',
  'PARTICIPACOES',
  'TECNOLOGIA',
  'INTERNET',
  'ONLINE',
  'MIDIA',
  'EVENTOS',
  'PRODUCOES',
  'EDITORA',
  'AGENCIA',
  'RESIDENCIAL',
  'RESIDENCE',
  'RESIDENCIA',
  'CONDOMINIO',
  'EDIFICIO',
  'EMPREENDIMENTO',
])

/** As palavras de um nome, sem acento, em maiúsculas; sem as genéricas e as de uma letra. */
export function palavras(texto: string | null | undefined): string[] {
  if (!texto) return []
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => p.length >= 2 && !PALAVRAS_GENERICAS.has(p))
}

const contem = (maior: string[], menor: string[]) =>
  menor.length > 0 && menor.every((p) => maior.includes(p))

/**
 * O nome do fornecedor no SIGO e o do credor no Sienge (razão social ou
 * fantasia) são da mesma empresa: as palavras que identificam o nome mais
 * curto estão todas no outro e pelo menos uma tem 4 letras ou mais. Uma
 * palavra sozinha só vale se abre um nome de até duas (senão, qualquer
 * sobrenome ou palavra comum bateria).
 * "Plena Terceirização" × "PLENA TERCEIRIZACAO DE MAO DE OBRA LTDA" e
 * "Google Ads" × "GOOGLE BRASIL INTERNET LTDA" batem; "Rádio Cidade FM" ×
 * "CIDADE ALTA COMUNICACAO", "Agência Nova Comunicação" × "NOVA ERA
 * CONSTRUCOES" e "Silva Marketing Digital" × "JOSE DA SILVA" não.
 */
export function nomesParecidos(
  fornecedor: string | null | undefined,
  credor: { nome?: string | null; nomeFantasia?: string | null },
): boolean {
  const meu = palavras(fornecedor)
  if (!meu.some((p) => p.length >= 4)) return false
  return [credor.nome, credor.nomeFantasia].some((nome) => {
    const dele = palavras(nome)
    if (!dele.length) return false
    const [menor, maior] = meu.length <= dele.length ? [meu, dele] : [dele, meu]
    if (!menor.some((p) => p.length >= 4)) return false
    return menor.length >= 2 ? contem(maior, menor) : maior.length <= 2 && maior[0] === menor[0]
  })
}

/**
 * O centro de custo do setor que é do empreendimento do lançamento, pelo nome
 * ("Lumine Residence" → "LUMINE RESIDENCE - MARKETING"). Só vale quando um
 * centro só serve: "Patriarca" bate com "SMART METRO PATRIARCA" e com
 * "SMART CIDADE PATRIARCA", e aí não há par.
 */
export function centroDoEmpreendimento(
  empreendimento: string | null | undefined,
  centros: Array<{ id: number; nome: string }>,
  trechoDoSetor: string,
): number | null {
  const doSetor = new Set(palavras(trechoDoSetor))
  const meu = palavras(empreendimento)
  if (!meu.length) return null
  const bases = centros.map((c) => ({
    id: c.id,
    base: palavras(c.nome).filter((p) => !doSetor.has(p)),
  }))
  // O nome igual vale antes do nome contido no outro.
  const iguais = bases.filter((c) => contem(c.base, meu) && contem(meu, c.base))
  if (iguais.length) return iguais.length === 1 ? iguais[0]!.id : null
  const contidos = bases.filter((c) => contem(c.base, meu) || contem(meu, c.base))
  return contidos.length === 1 ? contidos[0]!.id : null
}

// ---------- provas, vetos e decisão ----------

/** O lançamento como o casamento vê. */
export interface LancamentoParaCasar {
  valorCentavos: number
  codigoIdentificacao: string | null
  dataGasto: string
  /** Vencimentos das parcelas do SIGO, em ordem. */
  vencimentos: string[]
  /** O centro de custo do empreendimento do lançamento (null: sem empreendimento ou sem par único). */
  centroDoEmpreendimento: number | null
  /** Os centros de custo do setor do lançamento no Sienge. */
  centrosDoSetor: number[]
}

/** Um título que pode ser o do lançamento, com o que se sabe dele. */
export interface Candidato {
  titulo: TituloCandidato
  /** Veio da busca pelo CNPJ/CPF do fornecedor. */
  doFornecedor: boolean
  /** O nome do credor lá é o do fornecedor aqui (procurado quando não há CNPJ). */
  nomeParecido: boolean
  /** Centros de custo em que o título está apropriado; null quando não se sabe. */
  centros: number[] | null
  /** As parcelas do título, quando já lidas (dão o vencimento). */
  parcelas: ParcelaSienge[] | null
}

/** Imposto retido na nota: o SIGO guardou o líquido do boleto (até 15% menos) e o Sienge o bruto. */
const RETENCAO_MAXIMA = 0.15
/** Vencimento que andou por fim de semana ou feriado. */
const DIAS_VENCIMENTO_PROXIMO = 3
/** A emissão da nota perto da data do gasto. */
const DIAS_EMISSAO = 5

const diasEntre = (a: string, b: string) =>
  Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

/**
 * As provas do par lançamento × título, ou `null` quando algo contradiz
 * (veto): número de documento diferente, valor que não bate, ou título
 * apropriado a outro empreendimento que não o do lançamento.
 */
export function provasDe(l: LancamentoParaCasar, c: Candidato): ProvaSienge[] | null {
  const t = c.titulo
  const provas: ProvaSienge[] = []

  const meuNumero = numeroDoCodigo(l.codigoIdentificacao)
  const deleNumero = numeroDoSienge(t.documentNumber)
  if (meuNumero && deleNumero) {
    if (meuNumero !== deleNumero) return null
    provas.push('numero')
  }

  const total = centavos(t.totalInvoiceAmount)
  if (!total) return null
  if (l.valorCentavos === total) provas.push('valor')
  else if (
    provas.includes('numero') &&
    l.valorCentavos < total &&
    l.valorCentavos >= Math.round(total * (1 - RETENCAO_MAXIMA))
  ) {
    provas.push('retencao')
  } else return null

  if (l.centroDoEmpreendimento !== null && c.centros !== null) {
    if (!c.centros.includes(l.centroDoEmpreendimento)) return null
    provas.push('empreendimento')
  }
  if (c.centros?.some((id) => l.centrosDoSetor.includes(id))) provas.push('setor')

  if (c.doFornecedor) provas.push('fornecedor')
  else if (c.nomeParecido) provas.push('nomeFornecedor')

  const primeiraLa = c.parcelas
    ? [...c.parcelas].sort((a, b) => a.installmentNumber - b.installmentNumber)[0]
    : undefined
  const vencimentoLa = primeiraLa?.dueDate?.slice(0, 10)
  const meuVencimento = l.vencimentos[0]
  if (vencimentoLa && meuVencimento) {
    const dias = diasEntre(vencimentoLa, meuVencimento)
    if (dias === 0) provas.push('vencimento')
    else if (dias <= DIAS_VENCIMENTO_PROXIMO) provas.push('vencimentoProximo')
  }

  // Parcela única dos dois lados não diz nada (quase tudo é assim): só conta com 2 ou mais.
  const quantidade = t.installmentsNumber ?? c.parcelas?.length
  if (quantidade && quantidade >= 2 && quantidade === l.vencimentos.length) provas.push('parcelas')

  const emissao = t.issueDate?.slice(0, 10)
  if (emissao && diasEntre(emissao, l.dataGasto) <= DIAS_EMISSAO) provas.push('emissao')

  return provas
}

/**
 * Conjuntos de provas que bastam para casar (basta um). Cada item é uma prova
 * exigida, ou uma lista de alternativas. Sem o CNPJ/CPF do fornecedor, o
 * nome dele entra no lugar, com mais exigência; sem fornecedor nenhum, só o
 * número da nota com valor e vencimento. Vencimento só vale exato: o próximo
 * (até 3 dias) aparece nas provas, mas não fecha âncora.
 */
const ANCORAS: Array<Array<ProvaSienge | ProvaSienge[]>> = [
  ['fornecedor', 'numero', ['valor', 'retencao']],
  ['fornecedor', 'valor', 'vencimento'],
  ['nomeFornecedor', 'numero', ['valor', 'retencao']],
  ['nomeFornecedor', 'valor', 'vencimento', ['emissao', 'empreendimento']],
  ['numero', 'valor', 'vencimento', ['emissao', 'empreendimento']],
]

export const ancorado = (provas: ProvaSienge[]): boolean =>
  ANCORAS.some((ancora) =>
    ancora.every((exigida) =>
      Array.isArray(exigida) ? exigida.some((p) => provas.includes(p)) : provas.includes(exigida),
    ),
  )

/**
 * O que desempata títulos que fecham uma âncora, nesta ordem: o número da
 * nota, o empreendimento, o vencimento exato e o centro de custo do setor.
 * Prova fraca (emissão, parcelas) ajuda a fechar âncora, mas não desempata.
 */
const DESEMPATE: ProvaSienge[] = ['numero', 'empreendimento', 'vencimento', 'setor']

/**
 * O título não perde o desempate por falta de informação: sem os centros de
 * custo (fora da cópia do Sienge), empreendimento e setor não desempatam; sem
 * as parcelas lidas, o vencimento não desempata.
 */
function desconhecido(p: ProvaSienge, c: Candidato): boolean {
  if (p === 'empreendimento' || p === 'setor') return c.centros === null
  if (p === 'vencimento') return c.parcelas === null
  return false
}

export type Casamento =
  | { tipo: 'casado'; tituloId: number; provas: ProvaSienge[] }
  | { tipo: 'ambiguo'; tituloIds: number[] }
  | { tipo: 'nenhum' }

/**
 * Escolhe o título do lançamento: entre os que fecham uma âncora, fica, prova
 * por prova do desempate, quem a tem, desde que todos os empatados possam ser
 * comparados nela. Sobrou mais de um: ambíguo, não casa.
 */
export function decidir(l: LancamentoParaCasar, candidatos: Candidato[]): Casamento {
  let empatados = candidatos
    .map((c) => ({ c, provas: provasDe(l, c) }))
    .filter((x): x is { c: Candidato; provas: ProvaSienge[] } => !!x.provas && ancorado(x.provas))
  if (!empatados.length) return { tipo: 'nenhum' }
  for (const p of DESEMPATE) {
    if (empatados.length === 1) break
    if (empatados.some((x) => desconhecido(p, x.c))) continue
    const comEla = empatados.filter((x) => x.provas.includes(p))
    if (comEla.length) empatados = comEla
  }
  if (empatados.length > 1) {
    return { tipo: 'ambiguo', tituloIds: empatados.map((x) => x.c.titulo.id) }
  }
  const [escolhido] = empatados
  return { tipo: 'casado', tituloId: escolhido!.c.titulo.id, provas: escolhido!.provas }
}

/** O vínculo como fica guardado: pelo número quando ele bateu, senão pelo valor. */
export const vinculoDas = (provas: ProvaSienge[]): 'numero' | 'valor' =>
  provas.includes('numero') ? 'numero' : 'valor'

/** Parcela do SIGO em aberto que a conferência avalia. */
export interface ParcelaSigo {
  id: number
  numero: number
  vencimento: string
  pagoEm: string | null
}

export const PAGA = 'Totalmente paga'

/**
 * Quais parcelas do SIGO estão pagas no Sienge, e por qual parcela de lá.
 * Mesma quantidade: casa uma a uma pela ordem de vencimento. Quantidade
 * diferente: só marca quando o título inteiro está quitado. "Parcialmente
 * paga" nunca marca.
 */
export function parcelasPagas(
  sigo: ParcelaSigo[],
  sienge: ParcelaSienge[],
): Array<{ parcela: ParcelaSigo; numeroSienge: number }> {
  const ordemSigo = [...sigo].sort(
    (a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero - b.numero,
  )
  const ordemSienge = [...sienge].sort(
    (a, b) =>
      (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.installmentNumber - b.installmentNumber,
  )
  if (!ordemSienge.length) return []

  if (ordemSigo.length === ordemSienge.length) {
    return ordemSigo
      .map((parcela, i) => ({ parcela, lado: ordemSienge[i]! }))
      .filter(({ parcela, lado }) => !parcela.pagoEm && lado.situation === PAGA)
      .map(({ parcela, lado }) => ({ parcela, numeroSienge: lado.installmentNumber }))
  }
  if (ordemSienge.every((p) => p.situation === PAGA)) {
    const ultima = ordemSienge[ordemSienge.length - 1]!.installmentNumber
    return ordemSigo.filter((p) => !p.pagoEm).map((parcela) => ({ parcela, numeroSienge: ultima }))
  }
  return []
}

/** Movimento de pagamento guardado do extrato de contas (`/accounts-statements`, origem CP). */
export interface MovimentoPagamento {
  tituloId: number
  parcela: number
  data: string
}

/**
 * A data em que a parcela foi paga: a do último movimento de pagamento dela
 * no extrato (pagamento em partes quita no último). Sem movimento, null: a
 * baixa pode ser antiga demais para a janela lida, ou não ter sido em dinheiro.
 */
export function dataDoPagamento(
  movimentos: MovimentoPagamento[],
  tituloId: number,
  parcela: number,
): string | null {
  const datas = movimentos
    .filter((m) => m.tituloId === tituloId && m.parcela === parcela)
    .map((m) => m.data)
    .sort()
  return datas[datas.length - 1] ?? null
}

/** Deslocamento do fuso de São Paulo num instante, em minutos (ex.: -180). */
function deslocamento(instante: Date): number {
  const parte = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, timeZoneName: 'longOffset' })
    .formatToParts(instante)
    .find((p) => p.type === 'timeZoneName')?.value
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(parte ?? '')
  if (!m) return 0
  const minutos = Number(m[2]) * 60 + Number(m[3] ?? 0)
  return m[1] === '-' ? -minutos : minutos
}

/** O dia (AAAA-MM-DD) em São Paulo de um instante. */
const diaEmSaoPaulo = (instante: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(instante)

/** O instante de "dia às HH:MM em São Paulo". */
function instanteEm(dia: string, horario: string): Date {
  const aproximado = new Date(`${dia}T${horario}:00Z`)
  return new Date(aproximado.getTime() - deslocamento(aproximado) * 60_000)
}

/** Os horários agendados (São Paulo) em ordem, entre dois instantes: o mais recente antes de `agora` e o próximo depois. */
export function horariosEmTorno(
  agora: Date,
  horarios: string[],
): { anterior: Date | null; proximo: Date | null } {
  if (!horarios.length) return { anterior: null, proximo: null }
  const hojeSp = diaEmSaoPaulo(agora)
  const ontem = diaEmSaoPaulo(new Date(agora.getTime() - 24 * 60 * 60_000))
  const amanha = diaEmSaoPaulo(new Date(agora.getTime() + 24 * 60 * 60_000))
  const todos = [ontem, hojeSp, amanha]
    .flatMap((d) => horarios.map((h) => instanteEm(d, h)))
    .sort((a, b) => a.getTime() - b.getTime())
  const anterior = [...todos].reverse().find((t) => t.getTime() <= agora.getTime()) ?? null
  const proximo = todos.find((t) => t.getTime() > agora.getTime()) ?? null
  return { anterior, proximo }
}
