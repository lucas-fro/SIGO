import { z } from 'zod'
import { id, idQuery, type Ref } from './comum.js'

/*
  Comprovantes: o arquivo (PDF ou foto) que prova o gasto — boleto, nota,
  recibo, comprovante de Pix. Fica numa pasta do servidor; o banco guarda só
  o registro. Ver e baixar passam pela API, que confere o setor do lançamento.

  O arquivo pode subir antes de o lançamento existir: no "Novo lançamento" ele
  é enviado primeiro (e lido para preencher o formulário) e só se liga ao
  lançamento quando este é salvo. Até lá é um rascunho da pessoa que enviou;
  rascunho esquecido some sozinho depois de um dia.
*/

export const TIPOS_ANEXO = ['application/pdf', 'image/jpeg', 'image/png'] as const
export type TipoAnexo = (typeof TIPOS_ANEXO)[number]

/** Extensões aceitas no seletor de arquivo do navegador. */
export const EXTENSOES_ANEXO = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

/** 15 MB: foto de celular passa fácil de 5 MB; PDF de boleto ou nota tem poucos KB. */
export const TAMANHO_MAXIMO_ANEXO = 15 * 1024 * 1024

/** Campos de texto que acompanham o arquivo no envio (multipart). */
export const enviarAnexoSchema = z.object({
  /** Com lançamento, o arquivo já entra nele; sem, fica como rascunho de quem enviou. */
  lancamentoId: idQuery.optional(),
})
export type EnviarAnexoInput = z.output<typeof enviarAnexoSchema>

/** Leitura por IA: o setor do formulário decide quais categorias ela pode sugerir. */
export const lerAnexoSchema = z.object({
  setorId: id('Escolha o setor'),
})
export type LerAnexoInput = z.output<typeof lerAnexoSchema>

export const arquivoAnexoSchema = z.object({
  /** `1` pede o arquivo como download; sem ele, abre no navegador. */
  baixar: z.enum(['0', '1']).optional(),
})

export interface Anexo {
  id: number
  nome: string
  tipo: TipoAnexo
  /** Em bytes. */
  tamanho: number
  enviadoEm: string
  enviadoPor: Ref
}

/** Resposta do envio. */
export interface AnexoEnviado extends Anexo {
  /** O mesmo arquivo (mesmo conteúdo) já é comprovante de um lançamento ativo. */
  duplicadoDe: { lancamentoId: number; descricao: string } | null
  /** Se o servidor tem a leitura automática ligada (chave da IA configurada). */
  leituraDisponivel: boolean
}
