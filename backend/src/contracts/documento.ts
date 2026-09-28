/*
  CPF e CNPJ do fornecedor.

  O documento é guardado sem pontuação e em maiúsculas. É por ele que, numa
  etapa seguinte, o lançamento vai ser casado com o título do Sienge; um
  dígito errado aqui vira uma conciliação que não fecha, por isso o dígito
  verificador é conferido na entrada.

  O CNPJ já nasce alfanumérico: desde julho de 2026 a Receita emite CNPJ com
  letras nas 12 primeiras posições (ex.: 12.ABC.345/01DE-35). O cálculo do
  dígito é o mesmo de sempre, usando o código ASCII do caractere menos 48 —
  para os algarismos isso dá o próprio número.
*/

/** Remove pontuação e espaços, e passa para maiúsculas. */
export function normalizarDocumento(valor: string): string {
  return valor.replace(/[\s./-]/g, '').toUpperCase()
}

function digitoModulo11(valores: number[], pesos: number[]): number {
  const soma = valores.reduce((total, valor, i) => total + valor * pesos[i]!, 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false
  const numeros = [...cpf].map(Number)
  const d1 = digitoModulo11(numeros.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digitoModulo11(numeros.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === numeros[9] && d2 === numeros[10]
}

const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

function cnpjValido(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false
  const valores = [...cnpj.slice(0, 12)].map((c) => c.charCodeAt(0) - 48)
  const d1 = digitoModulo11(valores, PESOS_CNPJ_1)
  const d2 = digitoModulo11([...valores, d1], PESOS_CNPJ_2)
  return cnpj.slice(12) === `${d1}${d2}`
}

/** Aceita CPF (11 dígitos) ou CNPJ (14 posições, numérico ou alfanumérico), já normalizado ou não. */
export function documentoValido(valor: string): boolean {
  const doc = normalizarDocumento(valor)
  return doc.length === 11 ? cpfValido(doc) : cnpjValido(doc)
}

/** Formata para leitura: 000.000.000-00 ou 00.000.000/0000-00. */
export function formatarDocumento(valor: string | null | undefined): string {
  if (!valor) return ''
  const doc = normalizarDocumento(valor)
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  if (doc.length === 14) {
    return doc.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }
  return valor
}
