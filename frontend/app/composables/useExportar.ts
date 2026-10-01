import { formatarDocumento, type LancamentoResumo, type ListaLancamentos } from '#contracts'
import { useApi, type QueryParams } from '~/composables/useApi'
import { data, rotuloPagamento } from '~/composables/useFormat'

/** Texto que a planilha não pode converter (código de nota, número de boleto). */
interface ComoTexto {
  comoTexto: string
}
type Valor = string | number | null | undefined | ComoTexto

/**
 * Célula de CSV: aspas quando há separador, aspas ou quebra de linha. Texto que
 * começa com = + - @ (ou tab) ganha um apóstrofo na frente: sem ele, o Excel
 * executa como fórmula o que veio digitado ou lido de um comprovante.
 */
function celula(valor: Valor): string {
  if (valor !== null && typeof valor === 'object') {
    // Só dígitos: ="000123" faz o Excel mostrar como texto, com os zeros à esquerda e
    // sem virar notação científica. Não é fórmula de usuário: o conteúdo é só número.
    if (/^\d+$/.test(valor.comoTexto)) return `"=""${valor.comoTexto}"""`
    valor = valor.comoTexto
  }
  let texto = valor === null || valor === undefined ? '' : String(valor)
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/** Valor para planilha brasileira: vírgula decimal e sem separador de milhar. */
const numero = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',')

const COLUNAS: Array<[titulo: string, valor: (l: LancamentoResumo) => Valor]> = [
  ['Nº', (l) => l.id],
  ['Data do gasto', (l) => data(l.dataGasto)],
  ['Descrição', (l) => l.descricao],
  ['Fornecedor', (l) => l.fornecedor?.nome ?? ''],
  ['CPF/CNPJ', (l) => formatarDocumento(l.fornecedor?.documento ?? null)],
  ['Categoria', (l) => l.categoria?.nome ?? ''],
  ['Empreendimento', (l) => l.empreendimento?.nome ?? ''],
  ['Forma de pagamento', (l) => l.formaPagamento?.nome ?? ''],
  ['Cartão', (l) => l.cartao?.nome ?? ''],
  ['Campanha', (l) => l.campanha?.nome ?? ''],
  [
    'Código de identificação',
    (l) => (l.codigoIdentificacao ? { comoTexto: l.codigoIdentificacao } : ''),
  ],
  ['Valor (R$)', (l) => numero(l.valorCentavos)],
  ['Situação', (l) => (l.situacao === 'cancelado' ? 'Cancelado' : 'Ativo')],
  ['Pagamento', (l) => (l.situacao === 'cancelado' ? '' : rotuloPagamento(l.pagamento.situacao))],
  // "1 de 3", não "1/3": o Excel em português transforma 1/3 em 1º de março.
  ['Parcelas pagas', (l) => `${l.pagamento.pagas} de ${l.pagamento.parcelas}`],
  [
    'Próximo vencimento',
    (l) =>
      l.situacao !== 'cancelado' && l.pagamento.proximoVencimento
        ? data(l.pagamento.proximoVencimento)
        : '',
  ],
  // Cancelado não tem nada a pagar.
  [
    'Em aberto (R$)',
    (l) => (l.situacao === 'cancelado' ? '' : numero(l.pagamento.emAbertoCentavos)),
  ],
  ['Comprovantes', (l) => l.anexos],
]

/**
 * Exporta para CSV tudo o que o filtro atual encontra (não só a página na
 * tela), buscando de 200 em 200. Separador ";" e BOM UTF-8: é o que o Excel em
 * português abre direto, com acento e coluna no lugar.
 */
export function useExportarLancamentos() {
  const api = useApi()

  return async function exportar(filtros: QueryParams, nomeArquivo: string): Promise<number> {
    const itens: LancamentoResumo[] = []
    for (let pagina = 1; ; pagina++) {
      const resposta = await api.get<ListaLancamentos>('/lancamentos', {
        ...filtros,
        pagina,
        porPagina: 200,
      })
      itens.push(...resposta.itens)
      if (!resposta.itens.length || itens.length >= resposta.total) break
    }

    const linhas = [
      COLUNAS.map(([titulo]) => celula(titulo)).join(';'),
      ...itens.map((l) => COLUNAS.map(([, valor]) => celula(valor(l))).join(';')),
    ]
    const arquivo = new Blob(['﻿', linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(arquivo)
    const link = document.createElement('a')
    link.href = url
    link.download = nomeArquivo
    link.click()
    // Revogar na hora pode cancelar o download em alguns navegadores: espera ele começar.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return itens.length
  }
}
