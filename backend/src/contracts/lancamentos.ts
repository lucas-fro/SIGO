import { z } from 'zod'
import { data, id, idQuery, textoOpcional, valorCentavos, type Ref } from './comum.js'
import { somaCentavos, type SituacaoPagamento } from './parcelas.js'

/*
  O lançamento é genérico de propósito: o mesmo formulário serve para fatura de
  cartão, boleto, Pix ou reembolso. O que muda de um tipo de gasto para outro
  cabe nos campos comuns (forma de pagamento, código de identificação,
  parcelas), e o histórico fica num lugar só, consultável do mesmo jeito.

  Três datas, cada uma com um papel:
  - data do gasto: quando a despesa aconteceu. É ela que decide o mês no painel;
  - vencimento: quando precisa ser paga (por parcela);
  - pago em: quando foi paga de fato (por parcela).
*/

export const SITUACOES_LANCAMENTO = ['ativo', 'cancelado'] as const
export type SituacaoLancamento = (typeof SITUACOES_LANCAMENTO)[number]

export const TIPOS_EVENTO = [
  'criado',
  'editado',
  'cancelado',
  'pagamento_registrado',
  'pagamento_desfeito',
] as const
export type TipoEvento = (typeof TIPOS_EVENTO)[number]

export const parcelaSchema = z.object({
  valorCentavos: valorCentavos('Informe o valor da parcela'),
  vencimento: data('Informe o vencimento'),
  pagoEm: data('Data de pagamento inválida')
    .nullish()
    .transform((v) => v ?? null),
})
export type ParcelaInput = z.output<typeof parcelaSchema>

const campos = z.object({
  setorId: id('Escolha o setor'),
  descricao: z
    .string({ error: 'Descreva o gasto' })
    .trim()
    .min(3, { error: 'Descreva o gasto em poucas palavras (mínimo 3 letras)' })
    .max(300, { error: 'Use no máximo 300 caracteres' }),
  valorCentavos: valorCentavos('Informe o valor total'),
  dataGasto: data('Informe a data do gasto'),
  categoriaId: id('Escolha a categoria'),
  formaPagamentoId: id('Escolha a forma de pagamento'),
  empreendimentoId: id('Escolha o empreendimento (ou Institucional)'),
  fornecedorId: id('Escolha o fornecedor'),
  campanhaId: id()
    .nullish()
    .transform((v) => v ?? null),
  codigoIdentificacao: textoOpcional(100),
  observacao: textoOpcional(2000),
  parcelas: z
    .array(parcelaSchema, { error: 'Informe as parcelas' })
    .min(1, { error: 'Informe ao menos uma parcela' })
    .max(60, { error: 'Use no máximo 60 parcelas' }),
})

/** A soma das parcelas tem que fechar com o total: é o que impede um total que não confere com o que se paga. */
const parcelasFecham = (v: {
  valorCentavos: number
  parcelas: ReadonlyArray<{ valorCentavos: number }>
}) => somaCentavos(v.parcelas) === v.valorCentavos

const regraDaSoma = {
  error: 'A soma das parcelas precisa ser igual ao valor total',
  path: ['parcelas'],
}

/** Edição: substitui todos os campos e as parcelas. */
export const lancamentoSchema = campos.refine(parcelasFecham, regraDaSoma)
export type LancamentoInput = z.output<typeof lancamentoSchema>

/**
 * Criação. `confirmarDuplicidade` é a resposta da pessoa ao aviso de possível
 * duplicado: sem ela, a API devolve 409 com os candidatos em vez de gravar.
 */
export const criarLancamentoSchema = campos
  .extend({ confirmarDuplicidade: z.boolean().optional() })
  .refine(parcelasFecham, regraDaSoma)
export type CriarLancamentoInput = z.output<typeof criarLancamentoSchema>

export const cancelarLancamentoSchema = z.object({
  motivo: z
    .string({ error: 'Explique o motivo do cancelamento' })
    .trim()
    .min(5, { error: 'Explique o motivo em poucas palavras (mínimo 5 letras)' })
    .max(500, { error: 'Use no máximo 500 caracteres' }),
})

/** Registrar (data) ou desfazer (null) o pagamento de uma parcela. */
export const pagamentoParcelaSchema = z.object({
  pagoEm: data('Informe a data do pagamento').nullable(),
})

export const FILTROS_PAGAMENTO = ['em_aberto', 'vencido', 'pago'] as const
export type FiltroPagamento = (typeof FILTROS_PAGAMENTO)[number]

export const listarLancamentosSchema = z.object({
  setorId: idQuery.optional(),
  /** Data do gasto a partir de (inclusive). */
  de: data().optional(),
  /** Data do gasto até (inclusive). */
  ate: data().optional(),
  categoriaId: idQuery.optional(),
  formaPagamentoId: idQuery.optional(),
  empreendimentoId: idQuery.optional(),
  fornecedorId: idQuery.optional(),
  campanhaId: idQuery.optional(),
  situacao: z.enum([...SITUACOES_LANCAMENTO, 'todos']).default('ativo'),
  /** `em_aberto` inclui os vencidos e os parcialmente pagos: tudo o que ainda tem parcela a pagar. */
  pagamento: z.enum(FILTROS_PAGAMENTO).optional(),
  /** Procura na descrição, no código de identificação e no nome ou documento do fornecedor. */
  busca: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
})
export type FiltrosLancamentos = z.output<typeof listarLancamentosSchema>

export interface ResumoPagamento {
  situacao: SituacaoPagamento
  parcelas: number
  pagas: number
  /** Vencimento mais próximo entre as parcelas ainda não pagas. */
  proximoVencimento: string | null
  emAbertoCentavos: number
}

export interface LancamentoResumo {
  id: number
  setor: Ref
  descricao: string
  valorCentavos: number
  dataGasto: string
  categoria: Ref
  formaPagamento: Ref
  empreendimento: Ref
  fornecedor: Ref & { documento: string | null }
  campanha: Ref | null
  codigoIdentificacao: string | null
  situacao: SituacaoLancamento
  pagamento: ResumoPagamento
  criadoEm: string
}

export interface ListaLancamentos {
  itens: LancamentoResumo[]
  total: number
  pagina: number
  porPagina: number
  /** Soma do valor de tudo o que o filtro encontrou, não só da página. */
  somaCentavos: number
  emAbertoCentavos: number
}

export interface Parcela {
  id: number
  numero: number
  valorCentavos: number
  vencimento: string
  pagoEm: string | null
}

/** Uma mudança de campo, já com o rótulo e os valores legíveis de antes e depois. */
export interface Alteracao {
  campo: string
  rotulo: string
  de: unknown
  para: unknown
}

export interface DadosEvento {
  /** `editado`: o que mudou. */
  alteracoes?: Alteracao[]
  /** `cancelado`: por quê. */
  motivo?: string
  /** `pagamento_*`: número da parcela e a data registrada. */
  parcela?: number
  pagoEm?: string | null
}

export interface Evento {
  id: number
  tipo: TipoEvento
  em: string
  usuario: Ref
  dados: DadosEvento | null
}

export interface LancamentoDetalhe extends LancamentoResumo {
  observacao: string | null
  parcelas: Parcela[]
  eventos: Evento[]
  criadoPor: Ref
  atualizadoEm: string | null
  cancelamento: { em: string; por: Ref; motivo: string } | null
}

export const indicadoresSchema = z.object({
  setorId: idQuery.optional(),
})
export type FiltrosIndicadores = z.output<typeof indicadoresSchema>

/** Soma e quantidade de parcelas em aberto de um recorte. */
export interface TotalParcelas {
  centavos: number
  parcelas: number
}

/** A faixa de indicadores do topo da lista: o que está acontecendo agora. */
export interface Indicadores {
  /** Hoje em São Paulo ("AAAA-MM-DD"): a referência de todas as contas abaixo. */
  hoje: string
  /**
   * Gasto do mês até hoje, comparado com o mesmo trecho do mês anterior (do dia
   * 1 até o mesmo dia). Comparar o mês corrente com o anterior inteiro faria
   * todo início de mês parecer uma queda.
   */
  gastoMes: { centavos: number; anteriorCentavos: number; lancamentos: number }
  /** Gasto por mês (data do gasto), dos últimos 12 meses até o atual, sem buracos. */
  serieMensal: Array<{ mes: string; centavos: number }>
  emAberto: TotalParcelas
  vencido: TotalParcelas
  /** Parcelas em aberto que vencem de hoje até daqui a 7 dias. */
  proximos7Dias: TotalParcelas
}

/** Lançamento parecido com o que se está gravando: mesmo fornecedor e mesmo código, ou mesmo valor em data próxima. */
export interface PossivelDuplicado {
  id: number
  descricao: string
  valorCentavos: number
  dataGasto: string
  codigoIdentificacao: string | null
}

/** Corpo do 409 que a API devolve quando encontra possível duplicado. */
export interface RespostaDuplicidade {
  message: string
  duplicados: PossivelDuplicado[]
}
