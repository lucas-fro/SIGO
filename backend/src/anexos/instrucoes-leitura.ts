import sharp from 'sharp'
import { z } from 'zod'
import { TIPOS_DOCUMENTO_LIDO } from '../contracts/leitura.js'
import { ErroLeitura, type ContextoLeitura, type DocumentoExtraido } from './leitor.js'

/*
  O que é igual para qualquer IA que lê o comprovante: as instruções, o
  esquema da resposta e a conferência dela. Cada leitor (OpenAI, Claude) só
  sabe falar com a sua API.

  O esquema é escrito à mão, e não gerado do zod, para a gramática garantir os
  valores do enum nas duas APIs; o zod confere a resposta depois.

  As regras de preenchimento são as que o Marketing já usa no Termo de
  Aprovação: fornecedor é o beneficiário que consta no documento (a
  processadora, quando o boleto é dela), o empreendimento nunca é deduzido,
  e retenção de imposto vai na observação.
*/

/**
 * Todo campo obrigatório, sem limite numérico e sem propriedade extra: são as
 * regras do modo estrito das duas APIs (structured outputs). Uniões: 6 de 16.
 */
export const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'tipoDocumento',
    'descricao',
    'valorCentavos',
    'dataDocumento',
    'nomeFornecedor',
    'documentoFornecedor',
    'codigo',
    'parcelas',
    'pagoEm',
    'formaPagamentoId',
    'categoriaId',
    'empreendimentoId',
    'observacao',
    'avisos',
  ],
  properties: {
    tipoDocumento: { type: 'string', enum: [...TIPOS_DOCUMENTO_LIDO] },
    descricao: {
      type: 'string',
      description: 'O que foi comprado ou contratado, numa frase curta em português.',
    },
    valorCentavos: {
      type: ['integer', 'null'],
      description: 'Valor a pagar em centavos inteiros (R$ 1.234,56 = 123456).',
    },
    dataDocumento: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    nomeFornecedor: {
      type: 'string',
      description: 'Razão social do beneficiário. Vazio se não houver.',
    },
    documentoFornecedor: {
      type: 'string',
      description: 'CNPJ ou CPF do beneficiário, como aparece. Vazio se não houver.',
    },
    codigo: {
      type: 'string',
      description: 'Número da nota, do documento ou do recibo. Vazio se não houver.',
    },
    parcelas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['vencimento', 'valorCentavos'],
        properties: {
          vencimento: { type: 'string', format: 'date' },
          valorCentavos: { type: 'integer' },
        },
      },
    },
    pagoEm: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    formaPagamentoId: { type: ['integer', 'null'] },
    categoriaId: { type: ['integer', 'null'] },
    empreendimentoId: { type: ['integer', 'null'] },
    observacao: {
      type: 'string',
      description: 'Só o que importa e não coube nos outros campos. Vazio se nada.',
    },
    avisos: { type: 'array', items: { type: 'string' } },
  },
} as const

/** A resposta conferida (a gramática garante a forma; o zod, as datas e números). */
const Resposta = z.object({
  tipoDocumento: z.enum(TIPOS_DOCUMENTO_LIDO),
  descricao: z.string(),
  valorCentavos: z.number().int().nullable(),
  dataDocumento: z.string().nullable(),
  nomeFornecedor: z.string(),
  documentoFornecedor: z.string(),
  codigo: z.string(),
  parcelas: z.array(z.object({ vencimento: z.string(), valorCentavos: z.number().int() })),
  pagoEm: z.string().nullable(),
  formaPagamentoId: z.number().int().nullable(),
  categoriaId: z.number().int().nullable(),
  empreendimentoId: z.number().int().nullable(),
  observacao: z.string(),
  avisos: z.array(z.string()),
})

export const SISTEMA = `Você lê documentos financeiros brasileiros (boleto, nota fiscal de serviço ou de produto, fatura, recibo, comprovante de Pix ou transferência, cupom) enviados pelo Marketing de uma incorporadora, para pré-preencher o lançamento de um gasto. A pessoa revisa tudo antes de salvar.

Regras:
- Não invente. O que não estiver no documento fica vazio ("") ou null, e a dúvida vai em "avisos".
- valorCentavos: o valor A PAGAR, em centavos. Boleto: o valor do documento. Nota sem boleto: o valor bruto da nota; se houver ISS ou outro imposto retido, diga em "observacao" no formato "ISS retido pelo tomador: R$ 51,36 (líquido ao prestador: R$ 1.148,64)".
- dataDocumento: a emissão da nota, ou a data do documento do boleto ou do recibo.
- Fornecedor (nomeFornecedor, documentoFornecedor): o BENEFICIÁRIO ou emitente que consta no documento, nunca o pagador/tomador. Quando o boleto é de processadora de pagamento (dLocal, EBANX, Pagar.me, PagSeguro, Stripe etc.), o fornecedor é a processadora, e o prestador real (Meta Ads, Google Ads...) vai na descrição.
- descricao: o serviço ou produto em uma frase curta, até uns 100 caracteres (ex.: "Anúncios Meta Ads de setembro, via dLocal", "Impressão de 5.000 panfletos A5").
- codigo: o número da nota (ex.: "NFS-e 826"); sem nota, o número do documento do boleto ou do recibo. Não use a linha digitável se houver um número de documento.
- parcelas: vencimento e valor de cada parcela, boleto ou duplicata. Boleto único é 1 parcela. Documento sem vencimento: lista vazia. Pagamento dividido em vários boletos: uma parcela por boleto, e diga isso em "observacao".
- pagoEm: só quando o documento prova que já foi pago (comprovante de Pix ou transferência, recibo quitado, carimbo de pago). Senão, null.
- formaPagamentoId, categoriaId, empreendimentoId: só ids das listas enviadas, ou null.
  - Forma: boleto → a forma de boleto; comprovante de Pix → Pix; e assim por diante.
  - Categoria: pelo tipo de gasto, usando as descrições das categorias. Na dúvida, null.
  - Empreendimento: SÓ se o documento citar o empreendimento pelo nome. Nunca deduza pela conta de anúncio, pelo tomador ou pelo endereço; na dúvida, null.
- observacao: só informação útil que não coube (retenção, período de veiculação, pagamento dividido). Senão, "".
- avisos: frases curtas sobre o que a pessoa precisa conferir (valor ilegível, documento cortado, dois valores possíveis, documento que não parece financeiro). Lista vazia se tudo estiver claro.`

export function listas(c: ContextoLeitura): string {
  const linhas = (itens: string[]) => (itens.length ? itens.join('\n') : '(nenhum)')
  return [
    `Hoje é ${c.hoje}.`,
    '',
    'CATEGORIAS (id: nome — descrição)',
    linhas(c.categorias.map((x) => `${x.id}: ${x.nome}${x.descricao ? ` — ${x.descricao}` : ''}`)),
    '',
    'EMPREENDIMENTOS (id: nome)',
    linhas(c.empreendimentos.map((x) => `${x.id}: ${x.nome}`)),
    '',
    'FORMAS DE PAGAMENTO (id: nome)',
    linhas(c.formasPagamento.map((x) => `${x.id}: ${x.nome}${x.cartao ? ' (cartão)' : ''}`)),
    '',
    'Extraia os dados do documento anexado.',
  ].join('\n')
}

/**
 * A API recusa imagem acima de 5 MB (o base64 soma um terço) e não ganha nada
 * com mais de 2576 px no lado maior. Foto de celular passa dos dois: vai
 * reduzida e em JPEG, já na orientação certa. O comprovante guardado continua
 * o original; só a cópia enviada para leitura é reduzida.
 */
export const IMAGEM_MAXIMA_BYTES = 3_500_000
export const IMAGEM_LADO_MAXIMO = 2576

export async function prepararImagem(
  conteudo: Buffer,
  tipo: 'image/jpeg' | 'image/png',
): Promise<{ data: Buffer; tipo: 'image/jpeg' | 'image/png' }> {
  const { width = 0, height = 0 } = await sharp(conteudo).metadata()
  if (conteudo.length <= IMAGEM_MAXIMA_BYTES && Math.max(width, height) <= IMAGEM_LADO_MAXIMO) {
    return { data: conteudo, tipo }
  }
  const data = await sharp(conteudo)
    .rotate()
    .resize({
      width: IMAGEM_LADO_MAXIMO,
      height: IMAGEM_LADO_MAXIMO,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer()
  return { data, tipo: 'image/jpeg' }
}

const vazioParaNulo = (texto: string): string | null => texto.trim() || null

/** O texto JSON devolvido pela IA → documento extraído, ou ErroLeitura. */
export function interpretarResposta(texto: string): DocumentoExtraido {
  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    throw new ErroLeitura(
      'A leitura devolveu um resultado inválido; tente de novo.',
      'JSON malformado',
    )
  }
  const r = Resposta.safeParse(json)
  if (!r.success) {
    throw new ErroLeitura(
      'A leitura devolveu um resultado inválido; tente de novo.',
      r.error.message,
    )
  }

  const d = r.data
  return {
    tipoDocumento: d.tipoDocumento,
    descricao: vazioParaNulo(d.descricao),
    valorCentavos: d.valorCentavos,
    dataDocumento: d.dataDocumento,
    fornecedor:
      d.nomeFornecedor.trim() || d.documentoFornecedor.trim()
        ? {
            nome: vazioParaNulo(d.nomeFornecedor),
            documento: vazioParaNulo(d.documentoFornecedor),
          }
        : null,
    codigo: vazioParaNulo(d.codigo),
    parcelas: d.parcelas,
    pagoEm: d.pagoEm,
    formaPagamentoId: d.formaPagamentoId,
    categoriaId: d.categoriaId,
    empreendimentoId: d.empreendimentoId,
    observacao: vazioParaNulo(d.observacao),
    avisos: d.avisos,
  }
}
