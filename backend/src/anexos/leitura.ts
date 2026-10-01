import { z } from 'zod'
import { documentoValido, normalizarDocumento } from '../contracts/documento.js'
import type { LeituraDocumento, ParcelaLida } from '../contracts/leitura.js'
import { TIPOS_DOCUMENTO_LIDO } from '../contracts/leitura.js'
import type { ContextoLeitura, DocumentoExtraido } from './leitor.js'

/*
  Confere o que a IA devolveu e ajusta ao formato do formulário. Nada aqui
  confia na leitura: data que não existe some, id fora das listas some,
  valor negativo some, e o que foi descartado vira aviso para a pessoa.
  Os avisos que dá para calcular (vencimento em fim de semana, parcelas que
  não fecham com o total) são calculados aqui, não pedidos à IA.
*/

const dataValida = (valor: string | null | undefined): string | null =>
  valor && z.iso.date().safeParse(valor).success ? valor : null

const centavosValidos = (valor: number | null | undefined): number | null =>
  typeof valor === 'number' && Number.isInteger(valor) && valor > 0 && valor <= 99_999_999_999
    ? valor
    : null

const texto = (valor: string | null | undefined, max: number): string | null => {
  const limpo = valor?.replace(/\s+/g, ' ').trim()
  return limpo ? limpo.slice(0, max) : null
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const diaDaSemana = (dataIso: string): number => new Date(`${dataIso}T12:00:00Z`).getUTCDay()
const dataCurta = (dataIso: string) => `${dataIso.slice(8, 10)}/${dataIso.slice(5, 7)}`

export function montarLeitura(
  extraido: DocumentoExtraido,
  contexto: ContextoLeitura,
  /** Fornecedor do cadastro com o mesmo CNPJ/CPF do documento, se houver. */
  cadastrado: { id: number; nome: string; ativo: boolean } | null,
): LeituraDocumento {
  const avisos = extraido.avisos
    .map((a) => texto(a, 300))
    .filter((a): a is string => !!a)
    .slice(0, 8)

  const escolhido = <T extends { id: number }>(lista: T[], id: number | null, oque: string) => {
    if (id === null || id === undefined) return null
    if (lista.some((item) => item.id === id)) return id
    avisos.push(`A leitura sugeriu ${oque} que não está na lista; escolha à mão.`)
    return null
  }

  const parcelas: ParcelaLida[] = extraido.parcelas
    .map((p) => ({
      vencimento: dataValida(p.vencimento),
      valorCentavos: centavosValidos(p.valorCentavos),
    }))
    .filter((p): p is ParcelaLida => p.vencimento !== null && p.valorCentavos !== null)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
    .slice(0, 60)
  if (parcelas.length < extraido.parcelas.length) {
    avisos.push('Algum vencimento do documento não pôde ser lido; confira as parcelas.')
  }

  const valorCentavos = centavosValidos(extraido.valorCentavos)
  const somaParcelas = parcelas.reduce((soma, p) => soma + p.valorCentavos, 0)
  if (valorCentavos && parcelas.length > 1 && somaParcelas !== valorCentavos) {
    avisos.push('As parcelas lidas não somam o valor total; confira os valores.')
  }

  for (const p of parcelas) {
    const dia = diaDaSemana(p.vencimento)
    if (dia === 0 || dia === 6) {
      avisos.push(
        `O vencimento de ${dataCurta(p.vencimento)} cai num ${DIAS[dia]}: se o documento não aceita pagamento depois do vencimento, o prazo real é a sexta anterior.`,
      )
    }
  }

  const documento = extraido.fornecedor?.documento
    ? normalizarDocumento(extraido.fornecedor.documento)
    : null
  const documentoOk = documento && documentoValido(documento) ? documento : null
  if (documento && !documentoOk) {
    avisos.push(
      'O CNPJ/CPF lido do documento não confere (dígito verificador); confira o fornecedor.',
    )
  }
  if (cadastrado && !cadastrado.ativo) {
    avisos.push(`O fornecedor ${cadastrado.nome} está desativado no cadastro.`)
  }
  // O cadastro de fornecedor aceita até 120 caracteres: a sugestão já nasce no limite.
  const nomeFornecedor = texto(extraido.fornecedor?.nome, 120)

  return {
    tipoDocumento: TIPOS_DOCUMENTO_LIDO.includes(extraido.tipoDocumento)
      ? extraido.tipoDocumento
      : 'outro',
    descricao: texto(extraido.descricao, 300),
    valorCentavos,
    dataGasto: dataValida(extraido.dataDocumento),
    codigoIdentificacao: texto(extraido.codigo, 100),
    observacao: texto(extraido.observacao, 2000),
    fornecedor: cadastrado ? { id: cadastrado.id, nome: cadastrado.nome } : null,
    fornecedorNovo:
      !cadastrado && nomeFornecedor ? { nome: nomeFornecedor, documento: documentoOk } : null,
    categoriaId: escolhido(contexto.categorias, extraido.categoriaId, 'uma categoria'),
    empreendimentoId: escolhido(
      contexto.empreendimentos,
      extraido.empreendimentoId,
      'um empreendimento',
    ),
    formaPagamentoId: escolhido(
      contexto.formasPagamento,
      extraido.formaPagamentoId,
      'uma forma de pagamento',
    ),
    parcelas,
    pagoEm: dataValida(extraido.pagoEm),
    avisos: [...new Set(avisos)],
  }
}

/** CNPJ/CPF lido, pronto para procurar no cadastro (null quando não serve). */
export function documentoParaBusca(extraido: DocumentoExtraido): string | null {
  const doc = extraido.fornecedor?.documento
  if (!doc) return null
  const normalizado = normalizarDocumento(doc)
  return documentoValido(normalizado) ? normalizado : null
}
