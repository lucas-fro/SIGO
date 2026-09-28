import { z } from 'zod'
import { id, textoAlteravel, textoOpcional } from './comum.js'
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

/** Tudo o que o formulário de lançamento precisa, numa chamada só. */
export interface Cadastros {
  setores: Setor[]
  categorias: Categoria[]
  formasPagamento: FormaPagamento[]
  empreendimentos: Empreendimento[]
  campanhas: Campanha[]
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
})
export type NovoItem = z.output<typeof novoItemSchema>

export const editarItemSchema = z.object({
  nome: nome.optional(),
  descricao: textoAlteravel(300),
  ativo: z.boolean().optional(),
  ordem: z.number().int().min(0).max(9999).optional(),
  institucional: z.boolean().optional(),
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
