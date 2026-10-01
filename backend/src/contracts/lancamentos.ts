import { z } from 'zod'
import type { Anexo } from './anexos.js'
import type { VinculoLancamentoSienge } from './sienge.js'
import { data, id, idQuery, mesQuery, textoOpcional, valorCentavos, type Ref } from './comum.js'
import { hoje } from './datas.js'
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
  'anexo_adicionado',
  'anexo_removido',
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

/** Cadastro opcional: ausente ou vazio vira null. */
const idOpcional = () =>
  id()
    .nullish()
    .transform((v) => v ?? null)

/*
  Só descrição e valor são obrigatórios: o gasto entra rápido e a
  classificação pode ser completada depois. O setor vem da pessoa e as
  parcelas o formulário já monta (à vista, vencendo na data do gasto).
*/
const campos = z.object({
  setorId: id('Escolha o setor'),
  descricao: z
    .string({ error: 'Descreva o gasto' })
    .trim()
    .min(3, { error: 'Descreva o gasto em poucas palavras (mínimo 3 letras)' })
    .max(300, { error: 'Use no máximo 300 caracteres' }),
  valorCentavos: valorCentavos('Informe o valor total'),
  /** Sem data, vale hoje (em São Paulo): todo gasto precisa cair num mês dos totais. */
  dataGasto: data('Data do gasto inválida')
    .nullish()
    .transform((v) => v ?? hoje()),
  categoriaId: idOpcional(),
  formaPagamentoId: idOpcional(),
  empreendimentoId: idOpcional(),
  fornecedorId: idOpcional(),
  campanhaId: idOpcional(),
  /** Qual cartão, quando a forma de pagamento é cartão (a API confere). */
  cartaoId: idOpcional(),
  codigoIdentificacao: textoOpcional(100),
  observacao: textoOpcional(2000),
  parcelas: z
    .array(parcelaSchema, { error: 'Informe as parcelas' })
    .min(1, { error: 'Informe ao menos uma parcela' })
    .max(60, { error: 'Use no máximo 60 parcelas' }),
  /** Comprovantes enviados no formulário (rascunhos de quem salva) que passam a ser deste lançamento. */
  anexoIds: z
    .array(id('Comprovante inválido'))
    .max(10, { error: 'Anexe no máximo 10 comprovantes por vez' })
    .default([]),
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

/**
 * Edição: substitui todos os campos e as parcelas. `versao` é o `atualizadoEm`
 * do lançamento quando o formulário abriu: se ele mudou nesse meio tempo (por
 * exemplo, um pagamento conferido no Sienge), a API recusa em vez de desfazer.
 */
export const lancamentoSchema = campos
  .extend({ versao: z.string().nullish() })
  .refine(parcelasFecham, regraDaSoma)
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
  cartaoId: idQuery.optional(),
  /** Com ou sem comprovante anexado. */
  comprovante: z.enum(['com', 'sem']).optional(),
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

/** Categoria, forma, empreendimento, fornecedor, campanha e cartão podem faltar (null). */
export interface LancamentoResumo {
  id: number
  setor: Ref
  descricao: string
  valorCentavos: number
  dataGasto: string
  categoria: Ref | null
  formaPagamento: Ref | null
  empreendimento: Ref | null
  fornecedor: (Ref & { documento: string | null }) | null
  campanha: Ref | null
  cartao: Ref | null
  codigoIdentificacao: string | null
  situacao: SituacaoLancamento
  pagamento: ResumoPagamento
  /** Quantos comprovantes o lançamento tem. */
  anexos: number
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
  /** `pagamento_*`: a data que havia antes (troca de data ou pagamento desfeito). */
  pagoEmAnterior?: string | null
  /**
   * De onde veio, quando não foi digitado: `criado` pelo botão de gastos
   * fixos; `pagamento_registrado` pela conferência com o Sienge.
   */
  origem?: 'gasto_fixo' | 'sienge'
  /** `pagamento_registrado` pelo Sienge: o título de lá que foi conferido. */
  tituloSienge?: number
  /** Pago no Sienge sem data no extrato: a data é a da conferência, não a do pagamento. */
  dataAproximada?: boolean
  /** `anexo_*`: o nome do arquivo. */
  anexo?: string
}

export interface Evento {
  id: number
  tipo: TipoEvento
  em: string
  usuario: Ref
  dados: DadosEvento | null
}

export interface LancamentoDetalhe extends Omit<LancamentoResumo, 'anexos'> {
  observacao: string | null
  parcelas: Parcela[]
  anexos: Anexo[]
  /** Título a pagar do Sienge casado com este lançamento pela conferência de pagamentos. */
  sienge: VinculoLancamentoSienge | null
  eventos: Evento[]
  criadoPor: Ref
  atualizadoEm: string | null
  cancelamento: { em: string; por: Ref; motivo: string } | null
}

/** Lança, de uma vez, os gastos fixos de um cartão num mês. */
export const lancarFixosSchema = z.object({
  cartaoId: id('Escolha o cartão'),
  mes: z
    .string({ error: 'Escolha o mês' })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Mês inválido' }),
})
export type LancarFixosInput = z.output<typeof lancarFixosSchema>

/** Quais gastos fixos de um cartão já têm lançamento ativo num mês. */
export const fixosLancadosSchema = z.object({
  cartaoId: idQuery,
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Mês inválido' }),
})
export type FiltrosFixosLancados = z.output<typeof fixosLancadosSchema>

export interface FixosLancados {
  gastoFixoIds: number[]
}

export interface ResultadoLancarFixos {
  /** Ids dos lançamentos criados agora. */
  criados: number[]
  /** Gastos fixos que já tinham lançamento ativo no mês e ficaram de fora. */
  jaLancados: number
}

/** Sem `mes` ("AAAA-MM"), o mês de referência é o corrente. */
export const indicadoresSchema = z.object({
  setorId: idQuery.optional(),
  mes: mesQuery.optional(),
})
export type FiltrosIndicadores = z.output<typeof indicadoresSchema>

/** Soma e quantidade de parcelas em aberto de um recorte. */
export interface TotalParcelas {
  centavos: number
  parcelas: number
}

/**
 * A faixa de indicadores do topo do dashboard. O gasto e a série seguem o mês
 * de referência; em aberto, vencido e os próximos 7 dias são sempre de hoje
 * (é situação, não gasto de um mês).
 */
export interface Indicadores {
  /** Hoje em São Paulo ("AAAA-MM-DD"): a referência de em aberto, vencido e próximos 7 dias. */
  hoje: string
  /** Mês de referência ("AAAA-MM"): o pedido ou, sem pedido, o corrente. */
  mes: string
  /**
   * Gasto do mês de referência. No mês corrente vai até hoje e se compara com
   * o mesmo trecho do mês anterior (do dia 1 até o mesmo dia): comparar com o
   * anterior inteiro faria todo início de mês parecer uma queda. Num mês que
   * já terminou, é o mês inteiro contra o anterior inteiro.
   */
  gastoMes: { centavos: number; anteriorCentavos: number; lancamentos: number }
  /**
   * Gasto do ano do mês de referência, de 1º de janeiro até o mesmo corte do
   * `gastoMes` (hoje, no mês corrente; o fim do mês, nos outros), comparado com
   * o mesmo trecho do ano anterior.
   */
  gastoAno: { centavos: number; anteriorCentavos: number }
  /**
   * Gasto por mês (data do gasto), 12 meses sem buracos: a janela mais recente
   * que contém o mês de referência (`janelaDe12Meses`).
   */
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
