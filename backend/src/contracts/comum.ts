import { z } from 'zod'

/*
  Contratos da API.

  Esta pasta é o único código compartilhado entre backend e frontend: o
  backend valida as requisições com estes esquemas e o frontend valida o
  formulário com os mesmos, antes de enviar. Por isso aqui só entra zod e
  TypeScript puro — nada de Nest, Drizzle ou Vue.
*/

/** Chave numérica vinda do corpo JSON. */
export const id = (error = 'Valor inválido') =>
  z.number({ error }).int({ error }).positive({ error })

/** Chave vinda da query string, onde tudo chega como texto. */
export const idQuery = z.coerce.number().int().positive()

/** Mês de referência na query string: "AAAA-MM". */
export const mesQuery = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Mês inválido (use AAAA-MM)' })

/**
 * Data de calendário "AAAA-MM-DD". Sem hora e sem fuso de propósito: data do
 * gasto, vencimento e pagamento são dias, e um `Date` com fuso troca de dia no
 * caminho entre o navegador, o servidor em UTC e o banco.
 */
export const data = (error = 'Data inválida') =>
  z.iso
    .date({ error })
    // Ano de dois dígitos digitado no campo de data vira "0026": tiraria o gasto de todos os totais.
    .refine((v) => v >= '2000-01-01' && v <= '2099-12-31', {
      error: 'Use uma data entre 2000 e 2099',
    })

/**
 * Dinheiro sempre em centavos inteiros. Em ponto flutuante 0,1 + 0,2 não dá
 * 0,3, e num sistema que soma gasto o arredondamento aparece no total.
 */
export const valorCentavos = (error = 'Informe o valor') =>
  z
    .number({ error })
    .int({ error: 'Valor inválido' })
    .positive({ error: 'O valor precisa ser maior que zero' })
    .max(99_999_999_999, { error: 'Valor alto demais' })

/** Texto opcional num cadastro novo: vazio vira null, para o banco não guardar '' e null como coisas diferentes. */
export const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Use no máximo ${max} caracteres` })
    .nullish()
    .transform((v) => v || null)

/**
 * Texto opcional numa alteração parcial: ausente continua ausente (não mexe no
 * campo), e vazio vira null (apaga o campo).
 */
export const textoAlteravel = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Use no máximo ${max} caracteres` })
    .nullish()
    .transform((v) => (v === '' ? null : v))

/** Referência a um cadastro, do jeito que as telas mostram: id e nome. */
export interface Ref {
  id: number
  nome: string
}

/** Corpo de erro 400 da API: a mensagem geral e o problema de cada campo. */
export interface ErroValidacao {
  message: string
  issues: Array<{ path: string; message: string }>
}
