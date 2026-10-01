import { z } from 'zod'
import { idQuery, mesQuery } from './comum.js'

/*
  O gasto do setor lançado no Sienge, para comparar com o do SIGO no mesmo mês.

  Conta como do setor o título a pagar apropriado a um centro de custo do setor
  (no Marketing, os "<EMPREENDIMENTO> - MARKETING"), pela parte apropriada a
  ele: título rateado com outro centro de custo entra só com o percentual do
  setor. O mês é o da data de emissão do título, a mais próxima da "data do
  gasto" do SIGO, com o mesmo corte do gasto do mês no SIGO: no mês corrente,
  do dia 1 até hoje. Título ainda "em inclusão" no Sienge fica de fora.

  Os números vêm de uma cópia local, atualizada em segundo plano quando alguém
  olha o mês e a cópia passou do prazo: o dashboard nunca espera o Sienge.
*/

export const gastoSiengeSchema = z.object({
  setorId: idQuery.optional(),
  mes: mesQuery.optional(),
})
export type FiltrosGastoSienge = z.output<typeof gastoSiengeSchema>

/**
 * - `desligado`: o servidor não tem as credenciais do Sienge;
 * - `buscando`: primeira busca do mês em andamento, ainda sem número;
 * - `pronto`: número da última busca (que pode estar sendo refeita, ver `atualizando`);
 * - `erro`: a última busca falhou; `centavos` é o da anterior, se houve.
 */
export const SITUACOES_SIENGE = ['desligado', 'buscando', 'pronto', 'erro'] as const
export type SituacaoSienge = (typeof SITUACOES_SIENGE)[number]

/** A parte do mês que caiu num centro de custo do setor. */
export interface CentroCustoSienge {
  id: number
  nome: string
  centavos: number
}

export interface GastoSienge {
  /** Mês de referência ("AAAA-MM"): o pedido ou, sem pedido, o corrente. */
  mes: string
  situacao: SituacaoSienge
  /** `null` enquanto o mês nunca foi buscado. */
  centavos: number | null
  titulos: number
  porCentroCusto: CentroCustoSienge[]
  /**
   * O gasto do SIGO mostrado ao lado cobre os mesmos setores que esta soma.
   * Quando algum setor visível não tem centro de custo no Sienge, a diferença
   * entre os dois não quer dizer nada.
   */
  comparavel: boolean
  /** Quando a última busca completa terminou (ISO). */
  atualizadoEm: string | null
  /** Há uma busca em andamento para o mês: vale consultar de novo em alguns segundos. */
  atualizando: boolean
  /** Na busca em andamento, quantos títulos já tiveram a apropriação lida (uma requisição cada). */
  progresso: { feitos: number; total: number } | null
  erro: string | null
}

/*
  Conferência de pagamentos: duas vezes por dia (00h e 12h em São Paulo) as
  parcelas em aberto são conferidas no Sienge e as pagas lá são marcadas como
  pagas aqui, com a data do extrato. Primeiro o lançamento é casado com o
  título a pagar por provas somadas (fornecedor, número da nota, valor,
  vencimento, empreendimento...; regras em `sienge/casamento.ts`); o vínculo
  e as provas ficam guardados no lançamento.
*/

export const VINCULOS_SIENGE = ['numero', 'valor'] as const
export type VinculoSienge = (typeof VINCULOS_SIENGE)[number]

/** O que bateu entre o lançamento e o título do Sienge. */
export const PROVAS_SIENGE = [
  'fornecedor',
  'nomeFornecedor',
  'numero',
  'valor',
  'retencao',
  'vencimento',
  'vencimentoProximo',
  'parcelas',
  'emissao',
  'empreendimento',
  'setor',
] as const
export type ProvaSienge = (typeof PROVAS_SIENGE)[number]

export const ROTULO_PROVA_SIENGE: Record<ProvaSienge, string> = {
  fornecedor: 'CNPJ/CPF do fornecedor',
  nomeFornecedor: 'nome do fornecedor',
  numero: 'número da nota',
  valor: 'valor',
  retencao: 'valor com imposto retido',
  vencimento: 'vencimento',
  vencimentoProximo: 'vencimento (até 3 dias de diferença)',
  parcelas: 'quantidade de parcelas',
  emissao: 'data de emissão',
  empreendimento: 'empreendimento (centro de custo)',
  setor: 'centro de custo do setor',
}

export type OrigemConferencia = 'agendada' | 'manual'
export type SituacaoConferencia = 'andamento' | 'ok' | 'erro'

/** O que a conferência não resolveu, para quem quiser conferir à mão. */
export interface DetalheConferencia {
  /**
   * Lançamentos sem título que não têm como ser achados: sem CNPJ/CPF no
   * fornecedor e sem nome de fornecedor nem número da nota para comparar.
   */
  semDados: number
  /** Casamento com mais de um título possível: não vinculado de propósito. */
  ambiguos: Array<{ lancamentoId: number; tituloIds: number[] }>
  /** Parcelas pagas no Sienge sem movimento no extrato lido: marcadas com a data da conferência. */
  datasAproximadas: number
  /** Lançamentos pausados (alguém desfez um pagamento que a conferência marcou) com parcela paga lá. */
  respeitadas: number
  /**
   * Parcelas "Totalmente paga" no Sienge sem pagamento no extrato já lido:
   * pode ser baixa por substituição ou renegociação, sem dinheiro. Não são
   * marcadas; ficam para conferir à mão.
   */
  pagasSemMovimento: Array<{ lancamentoId: number; tituloId: number; parcela: number }>
  /** O que não pôde ser consultado nesta rodada (o resto seguiu). */
  falhas: string[]
}

/** A situação da conferência para a tela. */
export interface StatusConferencia {
  ligada: boolean
  horarios: string[]
  proxima: string | null
  andamento: boolean
  ultima: {
    origem: OrigemConferencia
    inicio: string
    fim: string | null
    situacao: SituacaoConferencia
    verificados: number
    vinculados: number
    pagas: number
    erro: string | null
    detalhe: DetalheConferencia | null
  } | null
}

/** Vínculo do lançamento com o título do Sienge, como o detalhe mostra. */
export interface VinculoLancamentoSienge {
  tituloId: number
  vinculo: VinculoSienge
  /** O que bateu; null nos vínculos feitos antes das provas existirem. */
  provas: ProvaSienge[] | null
  vinculadoEm: string
  /** Quando uma pessoa desfez um pagamento marcado pela conferência (daí em diante, nada é marcado sozinho). */
  pausadoEm: string | null
}
