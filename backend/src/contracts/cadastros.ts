import { z } from 'zod'
import { data, id, textoAlteravel, textoOpcional, valorCentavos, type Ref } from './comum.js'
import { documentoValido, normalizarDocumento } from './documento.js'

/*
  Listas fechadas que o lançamento usa. São fechadas de propósito: texto livre
  em "categoria" gera "Gráfica", "grafica" e "Gráfica rápida" para a mesma coisa,
  e aí nenhum total por categoria bate.

  Nenhum item é apagado, só desativado: lançamento antigo continua apontando
  para ele, e o nome continua aparecendo no histórico.
*/

export interface Setor {
  id: number
  nome: string
  slug: string
  ativo: boolean
}

export interface Categoria {
  id: number
  setorId: number
  nome: string
  descricao: string | null
  ativo: boolean
  ordem: number
}

export interface FormaPagamento {
  id: number
  nome: string
  /** É cartão: o lançamento pede qual cartão, e a fatura dele define o vencimento. */
  cartao: boolean
  ativo: boolean
  ordem: number
}

export interface Empreendimento {
  id: number
  nome: string
  /** Marca o item "Institucional": gasto da marca, que não é de nenhum empreendimento. */
  institucional: boolean
  ativo: boolean
  ordem: number
}

export interface Campanha {
  id: number
  setorId: number
  nome: string
  ativo: boolean
}

export interface Fornecedor {
  id: number
  nome: string
  /** CPF ou CNPJ normalizado (sem pontuação). */
  documento: string | null
  ativo: boolean
}

/** Gasto que se repete todo mês no cartão: assinatura, ferramenta, hospedagem. */
export interface GastoFixo {
  id: number
  cartaoId: number
  descricao: string
  valorCentavos: number
  /** Dia do mês em que a cobrança cai no cartão. */
  diaCobranca: number
  fornecedor: Ref
  categoria: Ref
  empreendimento: Ref
  ativo: boolean
}

/**
 * Como o dinheiro entra no cartão: orçamento fixo por mês, ou recargas de
 * qualquer valor em qualquer dia (o cartão vive do saldo).
 */
export const TIPOS_RECARGA = ['mensal', 'avulsa'] as const
export type TipoRecarga = (typeof TIPOS_RECARGA)[number]
export const ROTULO_RECARGA: Record<TipoRecarga, string> = {
  mensal: 'Orçamento mensal',
  avulsa: 'Recarga avulsa',
}

/** Dinheiro que entrou num cartão de recarga avulsa. */
export interface RecargaCartao {
  id: number
  cartaoId: number
  data: string
  valorCentavos: number
  observacao: string | null
}

/** Cartão do setor, com o orçamento do mês e os gastos fixos que ele carrega. */
export interface Cartao {
  id: number
  setorId: number
  nome: string
  /** Últimos 4 dígitos. */
  final: string | null
  formaPagamentoId: number
  recarga: TipoRecarga
  /** Só no cartão `mensal`; no `avulsa` é 0. */
  orcamentoMensalCentavos: number
  diaFechamento: number | null
  diaVencimento: number | null
  ativo: boolean
  gastosFixos: GastoFixo[]
  /** Recargas do cartão `avulsa` (as removidas não vêm), da mais recente para a mais antiga. */
  recargas: RecargaCartao[]
}

/** Tudo o que o formulário de lançamento precisa, numa chamada só. */
export interface Cadastros {
  setores: Setor[]
  categorias: Categoria[]
  formasPagamento: FormaPagamento[]
  empreendimentos: Empreendimento[]
  campanhas: Campanha[]
  cartoes: Cartao[]
}

/** Listas simples editáveis pela tela de cadastros. Fornecedor tem rota própria. */
export const LISTAS = ['categorias', 'formas-pagamento', 'empreendimentos', 'campanhas'] as const
export type Lista = (typeof LISTAS)[number]

export const ROTULO_LISTA: Record<Lista, string> = {
  categorias: 'Categorias',
  'formas-pagamento': 'Formas de pagamento',
  empreendimentos: 'Empreendimentos',
  campanhas: 'Campanhas',
}

/** Listas que pertencem a um setor: cada setor tem as suas categorias e campanhas. */
export const LISTAS_POR_SETOR: readonly Lista[] = ['categorias', 'campanhas']

const nome = z
  .string({ error: 'Informe o nome' })
  .trim()
  .min(2, { error: 'Use pelo menos 2 letras' })
  .max(120, { error: 'Use no máximo 120 caracteres' })

export const novoItemSchema = z.object({
  nome,
  /** Obrigatório em categorias e campanhas; ignorado nas outras listas. */
  setorId: id('Escolha o setor').optional(),
  descricao: textoOpcional(300),
  institucional: z.boolean().optional(),
  /** Formas de pagamento: marca a forma que é cartão. */
  cartao: z.boolean().optional(),
})
export type NovoItem = z.output<typeof novoItemSchema>

export const editarItemSchema = z.object({
  nome: nome.optional(),
  descricao: textoAlteravel(300),
  ativo: z.boolean().optional(),
  ordem: z.number().int().min(0).max(9999).optional(),
  institucional: z.boolean().optional(),
  cartao: z.boolean().optional(),
})
export type EditarItem = z.output<typeof editarItemSchema>

const documento = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? normalizarDocumento(v) : null))
  .refine((v) => v === null || documentoValido(v), { error: 'CPF ou CNPJ inválido' })

export const fornecedorSchema = z.object({
  nome,
  documento,
})
export type NovoFornecedor = z.output<typeof fornecedorSchema>

export const editarFornecedorSchema = z.object({
  nome: nome.optional(),
  documento: documento.optional(),
  ativo: z.boolean().optional(),
})
export type EditarFornecedor = z.output<typeof editarFornecedorSchema>

// ---------- cartões e gastos fixos ----------

const diaDoMesSchema = (rotulo: string) =>
  z
    .number({ error: `Informe o dia de ${rotulo}` })
    .int({ error: `Dia de ${rotulo} inválido` })
    .min(1, { error: `O dia de ${rotulo} vai de 1 a 31` })
    .max(31, { error: `O dia de ${rotulo} vai de 1 a 31` })

const camposCartao = z.object({
  setorId: id('Escolha o setor'),
  nome,
  final: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{4}$/.test(v), { error: 'Use os 4 últimos dígitos' }),
  formaPagamentoId: id('Escolha a forma de pagamento do cartão'),
  recarga: z.enum(TIPOS_RECARGA, { error: 'Escolha como o cartão recebe dinheiro' }),
  orcamentoMensalCentavos: z
    .number({ error: 'Informe o orçamento do mês' })
    .int({ error: 'Valor inválido' })
    .min(0, { error: 'O orçamento não pode ser negativo' })
    .max(99_999_999_999, { error: 'Valor alto demais' }),
  /** Fechamento e vencimento andam juntos: com os dois, o vencimento da compra sai da fatura. */
  diaFechamento: diaDoMesSchema('fechamento')
    .nullish()
    .transform((v) => v ?? null),
  diaVencimento: diaDoMesSchema('vencimento')
    .nullish()
    .transform((v) => v ?? null),
})

const diasJuntos = (v: { diaFechamento?: number | null; diaVencimento?: number | null }) =>
  (v.diaFechamento == null) === (v.diaVencimento == null)
const regraDosDias = {
  error: 'Informe o fechamento e o vencimento da fatura juntos (ou nenhum dos dois)',
  path: ['diaVencimento'],
}

export const cartaoSchema = camposCartao
  .extend({ recarga: camposCartao.shape.recarga.default('mensal') })
  .refine(diasJuntos, regraDosDias)
export type NovoCartao = z.output<typeof cartaoSchema>

/** Edição parcial. O setor não muda: os lançamentos do cartão são daquele setor. */
export const editarCartaoSchema = camposCartao
  .omit({ setorId: true })
  .partial()
  .extend({ ativo: z.boolean().optional() })
export type EditarCartao = z.output<typeof editarCartaoSchema>

const camposGastoFixo = z.object({
  cartaoId: id('Escolha o cartão'),
  descricao: z
    .string({ error: 'Descreva o gasto fixo' })
    .trim()
    .min(3, { error: 'Descreva em poucas palavras (mínimo 3 letras)' })
    .max(200, { error: 'Use no máximo 200 caracteres' }),
  valorCentavos: valorCentavos('Informe o valor mensal'),
  diaCobranca: diaDoMesSchema('cobrança'),
  fornecedorId: id('Escolha o fornecedor'),
  categoriaId: id('Escolha a categoria'),
  empreendimentoId: id('Escolha o empreendimento (ou Institucional)'),
})

export const gastoFixoSchema = camposGastoFixo
export type NovoGastoFixo = z.output<typeof gastoFixoSchema>

/** Edição parcial. O cartão não muda: para mudar de cartão, desative e cadastre no outro. */
export const editarGastoFixoSchema = camposGastoFixo
  .omit({ cartaoId: true })
  .partial()
  .extend({ ativo: z.boolean().optional() })
export type EditarGastoFixo = z.output<typeof editarGastoFixoSchema>

export const recargaSchema = z.object({
  cartaoId: id('Escolha o cartão'),
  data: data('Informe a data da recarga'),
  valorCentavos: valorCentavos('Informe o valor da recarga'),
  observacao: textoOpcional(200),
})
export type NovaRecarga = z.output<typeof recargaSchema>
