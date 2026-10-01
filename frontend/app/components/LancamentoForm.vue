<script setup lang="ts">
import {
  CircleAlert,
  FileText,
  Image as ImagemIcone,
  Loader2,
  ScanText,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-vue-next'
import {
  EXTENSOES_ANEXO,
  ROTULO_DOCUMENTO_LIDO,
  TAMANHO_MAXIMO_ANEXO,
  criarLancamentoSchema,
  formatarDocumento,
  gerarParcelas,
  hoje,
  lancamentoSchema,
  somarMeses,
  vencimentoDaFatura,
  type AnexoEnviado,
  type Fornecedor,
  type LancamentoDetalhe,
  type LeituraDocumento,
  type PossivelDuplicado,
  type RespostaDuplicidade,
} from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { opcoesAtivas, useCadastros, useFornecedores } from '~/composables/useCadastros'
import { data, reais, tamanhoArquivo } from '~/composables/useFormat'
import { useSincronizarLancamento } from '~/composables/useLancamentos'

/*
  Formulário único de lançamento, para criar e para editar.

  Só descrição e valor são obrigatórios: o resto classifica o gasto e pode ser
  completado depois. A data vazia vale hoje, e as parcelas já nascem prontas
  (à vista, vencendo na data do gasto).

  A validação roda duas vezes com o mesmo esquema: aqui, antes de enviar,
  para apontar o campo na hora; e na API, que é quem manda. O erro que vier de
  lá (cadastro desativado, pagamento no futuro) cai no mesmo lugar do campo.

  No lançamento novo, o comprovante (boleto, nota, recibo) sobe primeiro e é
  lido por IA: o que ela entendeu preenche o formulário, os campos preenchidos
  ganham a marca "do arquivo" e a pessoa confere antes de salvar. Ao salvar,
  o arquivo passa a ser comprovante do lançamento.
*/
const props = defineProps<{ inicial?: LancamentoDetalhe | null }>()
const emit = defineEmits<{ salvo: [LancamentoDetalhe]; cancelar: [] }>()

const editando = computed(() => !!props.inicial)
const { user, isAdmin } = useAuth()
const { data: cadastros } = useCadastros()
const { data: fornecedores } = useFornecedores()
const api = useApi()
const sincronizar = useSincronizarLancamento()

interface ParcelaForm {
  valorCentavos: number | null
  vencimento: string
  pagoEm: string | null
}

const form = reactive({
  setorId: null as number | null,
  descricao: '',
  valorCentavos: null as number | null,
  dataGasto: hoje(),
  categoriaId: null as number | null,
  formaPagamentoId: null as number | null,
  empreendimentoId: null as number | null,
  fornecedorId: null as number | null,
  campanhaId: null as number | null,
  cartaoId: null as number | null,
  codigoIdentificacao: '',
  observacao: '',
})
const quantidade = ref(1)
const primeiroVencimento = ref(hoje())
/**
 * Enquanto a pessoa não mexe no vencimento, ele é sugerido: a data do gasto,
 * ou o vencimento da fatura quando o gasto é num cartão com fatura configurada.
 */
const vencimentoTocado = ref(false)
const parcelas = ref<ParcelaForm[]>([{ valorCentavos: null, vencimento: hoje(), pagoEm: null }])
/**
 * A versão (atualizadoEm) do lançamento que preencheu o formulário. É ela que
 * vai no salvar: o `inicial` é buscado de novo ao voltar para a aba, e mandar a
 * versão nova com os dados velhos desfaria em silêncio o que mudou nesse meio
 * tempo (um pagamento, a conferência com o Sienge).
 */
const versao = ref<string | null>(null)
/**
 * À vista: a caixa "já foi pago". Guardada à parte da data: apagar a data para
 * digitar outra não pode desmarcar a caixa e sumir com o campo.
 */
const jaPagoMarcado = ref(false)

function preencher(l: LancamentoDetalhe) {
  versao.value = l.atualizadoEm
  Object.assign(form, {
    setorId: l.setor.id,
    descricao: l.descricao,
    valorCentavos: l.valorCentavos,
    dataGasto: l.dataGasto,
    categoriaId: l.categoria?.id ?? null,
    formaPagamentoId: l.formaPagamento?.id ?? null,
    empreendimentoId: l.empreendimento?.id ?? null,
    fornecedorId: l.fornecedor?.id ?? null,
    campanhaId: l.campanha?.id ?? null,
    cartaoId: l.cartao?.id ?? null,
    codigoIdentificacao: l.codigoIdentificacao ?? '',
    observacao: l.observacao ?? '',
  })
  quantidade.value = l.parcelas.length
  primeiroVencimento.value = l.parcelas[0]?.vencimento ?? l.dataGasto
  vencimentoTocado.value = true
  parcelas.value = l.parcelas.map((p) => ({
    valorCentavos: p.valorCentavos,
    vencimento: p.vencimento,
    pagoEm: p.pagoEm,
  }))
  jaPagoMarcado.value = !!l.parcelas[0]?.pagoEm
}

/**
 * Preenche uma vez por lançamento. O detalhe é buscado de novo ao voltar para
 * a aba, e preencher de novo apagaria o que a pessoa está editando; mudança
 * feita por outro lado (a conferência com o Sienge) é recusada no salvar, pela versão.
 */
const preenchidoDe = ref<number | null>(null)
watch(
  () => props.inicial,
  (l) => {
    if (l && preenchidoDe.value !== l.id) {
      preencher(l)
      preenchidoDe.value = l.id
    }
  },
  { immediate: true },
)

// Setor padrão: o primeiro que a pessoa enxerga (hoje, na prática, o Marketing).
watch(
  cadastros,
  (c) => {
    if (form.setorId === null && c?.setores.length) {
      form.setorId = user.value?.setores[0]?.id ?? c.setores[0]!.id
    }
  },
  { immediate: true },
)

// Trocou de setor: categoria, campanha e cartão do setor anterior não servem (a API
// recusaria, e o campo apareceria em branco segurando o id antigo).
watch(
  () => form.setorId,
  (novo, antigo) => {
    if (antigo === null || novo === antigo || !cadastros.value) return
    const c = cadastros.value
    if (form.categoriaId && c.categorias.find((x) => x.id === form.categoriaId)?.setorId !== novo) {
      form.categoriaId = null
    }
    if (form.campanhaId && c.campanhas.find((x) => x.id === form.campanhaId)?.setorId !== novo) {
      form.campanhaId = null
    }
    if (form.cartaoId && c.cartoes.find((x) => x.id === form.cartaoId)?.setorId !== novo) {
      form.cartaoId = null
    }
  },
)

/**
 * Refaz as parcelas a partir do total, da quantidade e do 1º vencimento. As
 * datas de pagamento já marcadas ficam onde estavam.
 */
function regenerar() {
  const pagos = parcelas.value.map((p) => p.pagoEm)
  const n = Math.min(60, Math.max(1, Math.floor(quantidade.value) || 1))
  const novas: Array<{ valorCentavos: number | null; vencimento: string }> = form.valorCentavos
    ? gerarParcelas(form.valorCentavos, n, primeiroVencimento.value)
    : Array.from({ length: n }, (_, i) => ({
        valorCentavos: null,
        vencimento: somarMeses(primeiroVencimento.value, i),
      }))
  parcelas.value = novas.map((p, i) => ({ ...p, pagoEm: pagos[i] ?? null }))
}

function aoMudarTotal(valor: number | null) {
  form.valorCentavos = valor
  regenerar()
}

function aoMudarQuantidade() {
  quantidade.value = Math.min(60, Math.max(1, Math.floor(quantidade.value) || 1))
  regenerar()
}

function aoMudarPrimeiroVencimento() {
  // Apagou o vencimento: volta para o sugerido (a data do gasto ou a fatura do cartão).
  if (!primeiroVencimento.value) {
    vencimentoTocado.value = false
    primeiroVencimento.value = vencimentoSugerido.value ?? hoje()
  } else {
    vencimentoTocado.value = true
  }
  regenerar()
}

// ---------- cartão ----------

const formaEscolhida = computed(() =>
  cadastros.value?.formasPagamento.find((f) => f.id === form.formaPagamentoId),
)
const cartoesDaForma = computed(() =>
  opcoesAtivas(
    cadastros.value?.cartoes.filter(
      (c) => c.setorId === form.setorId && c.formaPagamentoId === form.formaPagamentoId,
    ),
    form.cartaoId,
  ),
)
const cartaoEscolhido = computed(() => cadastros.value?.cartoes.find((c) => c.id === form.cartaoId))

/** Vencimento sugerido: o da fatura quando o cartão tem fechamento e vencimento; senão, a data do gasto. */
const vencimentoSugerido = computed(() => {
  if (!form.dataGasto) return null
  const c = cartaoEscolhido.value
  return c?.diaFechamento && c.diaVencimento
    ? vencimentoDaFatura(form.dataGasto, c.diaFechamento, c.diaVencimento)
    : form.dataGasto
})

function aplicarVencimentoSugerido() {
  if (vencimentoTocado.value || !vencimentoSugerido.value) return
  primeiroVencimento.value = vencimentoSugerido.value
  regenerar()
}

function aoMudarDataGasto() {
  aplicarVencimentoSugerido()
}

/**
 * Forma que não é cartão limpa o cartão; forma de cartão com um cartão só já o
 * escolhe. Em seguida o vencimento acompanha a fatura do cartão escolhido.
 */
function aoMudarForma() {
  if (!formaEscolhida.value?.cartao) form.cartaoId = null
  else if (!cartoesDaForma.value.some((c) => c.id === form.cartaoId)) {
    form.cartaoId = cartoesDaForma.value.length === 1 ? cartoesDaForma.value[0]!.id : null
  }
  aplicarVencimentoSugerido()
}

function aoMudarCartao() {
  aplicarVencimentoSugerido()
}

/** À vista: "já foi pago" marca o pagamento na data do gasto (ou hoje, se o gasto é futuro). */
const jaPago = computed({
  get: () => jaPagoMarcado.value,
  set: (marcado: boolean) => {
    jaPagoMarcado.value = marcado
    const primeira = parcelas.value[0]
    if (!primeira) return
    const dia = hoje()
    primeira.pagoEm = marcado
      ? form.dataGasto && form.dataGasto <= dia
        ? form.dataGasto
        : dia
      : null
  },
})
// A data chegou por outro caminho (leitura do comprovante): a caixa acompanha.
watch(
  () => parcelas.value[0]?.pagoEm,
  (data) => {
    if (data) jaPagoMarcado.value = true
  },
)

const pagoEmUnica = computed({
  get: () => parcelas.value[0]?.pagoEm ?? '',
  set: (valor: string) => {
    const primeira = parcelas.value[0]
    if (primeira) primeira.pagoEm = valor || null
  },
})

// ---------- listas ----------

const setores = computed(() => cadastros.value?.setores ?? [])
const categorias = computed(() =>
  opcoesAtivas(
    cadastros.value?.categorias.filter((c) => c.setorId === form.setorId),
    form.categoriaId,
  ),
)
const campanhas = computed(() =>
  opcoesAtivas(
    cadastros.value?.campanhas.filter((c) => c.setorId === form.setorId),
    form.campanhaId,
  ),
)
const formas = computed(() => opcoesAtivas(cadastros.value?.formasPagamento, form.formaPagamentoId))
const empreendimentos = computed(() =>
  opcoesAtivas(cadastros.value?.empreendimentos, form.empreendimentoId),
)
const categoriaEscolhida = computed(() =>
  cadastros.value?.categorias.find((c) => c.id === form.categoriaId),
)

const nome = (lista: Array<{ id: number; nome: string }> | undefined, id: number | null) =>
  lista?.find((i) => i.id === id)?.nome ?? '—'

// ---------- resumo ----------

const somaParcelas = computed(() =>
  parcelas.value.reduce((total, p) => total + (p.valorCentavos ?? 0), 0),
)
const diferenca = computed(() => (form.valorCentavos ?? 0) - somaParcelas.value)

const textoParcelas = computed(() => {
  const primeira = parcelas.value[0]
  if (!primeira) return ''
  if (parcelas.value.length === 1) {
    return primeira.pagoEm
      ? `À vista · pago em ${data(primeira.pagoEm)}`
      : `À vista · vence em ${data(primeira.vencimento)}`
  }
  const pagas = parcelas.value.filter((p) => p.pagoEm).length
  return `${parcelas.value.length}× · 1ª em ${data(primeira.vencimento)}${pagas ? ` · ${pagas} paga(s)` : ''}`
})

// ---------- fornecedor novo ----------

const modalFornecedor = ref(false)
const nomeFornecedor = ref('')
const documentoFornecedor = ref<string | undefined>(undefined)

function abrirNovoFornecedor(nomeSugerido: string, documento?: string | null) {
  nomeFornecedor.value = nomeSugerido
  documentoFornecedor.value = documento ?? undefined
  modalFornecedor.value = true
}

function cadastrarFornecedorLido() {
  const novo = leitura.value?.fornecedorNovo
  if (novo) abrirNovoFornecedor(novo.nome, novo.documento)
}

function aoCriarFornecedor(fornecedor: Fornecedor) {
  form.fornecedorId = fornecedor.id
  modalFornecedor.value = false
  if (leitura.value?.fornecedorNovo) leitura.value.fornecedorNovo = null
}

// ---------- comprovante e leitura ----------

const comprovantes = ref<AnexoEnviado[]>([])
const seletorArquivo = ref<HTMLInputElement | null>(null)
const arrastando = ref(false)
const enviandoArquivo = ref(false)
/** Comprovante sendo lido agora (id), para o aviso "Lendo…". */
const lendo = ref<number | null>(null)
const erroArquivo = ref<string | null>(null)
/** Se o servidor tem a leitura por IA ligada (vem na resposta do envio). */
const leituraLigada = ref<boolean | null>(null)
/** O que a última leitura trouxe além dos campos: tipo, avisos e fornecedor a cadastrar. */
const leitura = ref<{
  anexoId: number
  tipo: LeituraDocumento['tipoDocumento']
  avisos: string[]
  fornecedorNovo: LeituraDocumento['fornecedorNovo']
} | null>(null)
/** Campos preenchidos pela leitura (ganham a marca "do arquivo"). */
const lidos = ref(new Set<string>())
const vendo = ref<AnexoEnviado | null>(null)

const formularioEmBranco = computed(() => !form.descricao.trim() && !form.valorCentavos)
const lido = (campo: string) => lidos.value.has(campo)

function escolherArquivo() {
  seletorArquivo.value?.click()
}

function aoEscolherArquivo(evento: Event) {
  const campo = evento.target as HTMLInputElement
  const arquivo = campo.files?.[0]
  campo.value = ''
  if (arquivo) void enviarArquivo(arquivo)
}

function aoArrastar(evento: DragEvent) {
  evento.preventDefault()
  arrastando.value = true
}

function aoSairDoArraste() {
  arrastando.value = false
}

function aoSoltarArquivo(evento: DragEvent) {
  evento.preventDefault()
  arrastando.value = false
  const arquivo = evento.dataTransfer?.files?.[0]
  if (arquivo) void enviarArquivo(arquivo)
}

/** Enviando ou lendo um arquivo: salvar agora deixaria o comprovante de fora. */
const ocupadoComArquivo = computed(() => enviandoArquivo.value || lendo.value !== null)
/** O contrato aceita até 10 comprovantes por lançamento. */
const MAXIMO_COMPROVANTES = 10

async function enviarArquivo(arquivo: File) {
  if (ocupadoComArquivo.value || salvando.value) {
    erroArquivo.value = 'Espere o arquivo anterior terminar de subir e ser lido.'
    return
  }
  if (comprovantes.value.length >= MAXIMO_COMPROVANTES) {
    erroArquivo.value = `Cada lançamento aceita até ${MAXIMO_COMPROVANTES} comprovantes.`
    return
  }
  erroArquivo.value = null
  if (arquivo.size > TAMANHO_MAXIMO_ANEXO) {
    erroArquivo.value = 'O arquivo passa de 15 MB.'
    return
  }
  const dados = new FormData()
  dados.append('arquivo', arquivo)
  enviandoArquivo.value = true
  try {
    const enviado = await api.enviar<AnexoEnviado>('/anexos', dados)
    comprovantes.value.push(enviado)
    leituraLigada.value = enviado.leituraDisponivel
    // Lê sozinho enquanto o formulário está em branco; depois, só se a pessoa pedir.
    if (enviado.leituraDisponivel && formularioEmBranco.value) await lerComprovante(enviado)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    erroArquivo.value = e.message
  } finally {
    enviandoArquivo.value = false
  }
}

/**
 * Os campos que a leitura preenche, como estavam quando ela começou. A leitura
 * leva alguns segundos e o formulário continua editável: o que a pessoa digitar
 * nesse meio tempo vale mais que o que a IA leu.
 */
function fotoDaLeitura() {
  return {
    descricao: form.descricao,
    codigo: form.codigoIdentificacao,
    observacao: form.observacao,
    dataGasto: form.dataGasto,
    fornecedorId: form.fornecedorId,
    categoriaId: form.categoriaId,
    empreendimentoId: form.empreendimentoId,
    formaPagamentoId: form.formaPagamentoId,
    pagamento: JSON.stringify([
      form.valorCentavos,
      quantidade.value,
      primeiroVencimento.value,
      parcelas.value,
    ]),
  }
}
type FotoDaLeitura = ReturnType<typeof fotoDaLeitura>

async function lerComprovante(anexo: AnexoEnviado) {
  if (!form.setorId) return
  erroArquivo.value = null
  lendo.value = anexo.id
  const antes = fotoDaLeitura()
  try {
    const resultado = await api.post<LeituraDocumento>(`/anexos/${anexo.id}/ler`, {
      setorId: form.setorId,
    })
    aplicarLeitura(resultado, anexo.id, antes)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    erroArquivo.value = `${e.message} O arquivo continua anexado.`
  } finally {
    lendo.value = null
  }
}

/**
 * Preenche o formulário com a leitura. A ordem importa: a data do gasto e a
 * forma de pagamento vêm antes das parcelas, porque o vencimento sugerido
 * depende delas (a fatura do cartão, por exemplo).
 */
function aplicarLeitura(l: LeituraDocumento, anexoId: number, antes: FotoDaLeitura) {
  // A pessoa tirou o arquivo enquanto ele era lido: a leitura não vale mais.
  if (!comprovantes.value.some((c) => c.id === anexoId)) return
  const campos = new Set<string>()
  const marca = (campo: string) => campos.add(campo)
  // Só entra no campo que ninguém mexeu enquanto a leitura rodava.
  const agora = fotoDaLeitura()
  const livre = (campo: keyof FotoDaLeitura) => agora[campo] === antes[campo]

  if (l.descricao && livre('descricao')) {
    form.descricao = l.descricao
    marca('descricao')
  }
  if (l.codigoIdentificacao && livre('codigo')) {
    form.codigoIdentificacao = l.codigoIdentificacao
    marca('codigo')
  }
  if (l.observacao && livre('observacao')) {
    form.observacao = l.observacao
    marca('observacao')
  }
  // Emissão no futuro não serve como data do gasto: fica a de hoje.
  if (l.dataGasto && l.dataGasto <= hoje() && livre('dataGasto')) {
    form.dataGasto = l.dataGasto
    marca('dataGasto')
  }
  // Fornecedor desativado a API recusa numa escolha nova: nesse caso fica em branco (e há aviso).
  const fornecedor = l.fornecedor && fornecedores.value?.find((f) => f.id === l.fornecedor!.id)
  if (fornecedor?.ativo && livre('fornecedorId')) {
    form.fornecedorId = fornecedor.id
    marca('fornecedor')
  }
  if (
    l.categoriaId &&
    categorias.value.some((c) => c.id === l.categoriaId) &&
    livre('categoriaId')
  ) {
    form.categoriaId = l.categoriaId
    marca('categoria')
  }
  if (
    l.empreendimentoId &&
    empreendimentos.value.some((e) => e.id === l.empreendimentoId) &&
    livre('empreendimentoId')
  ) {
    form.empreendimentoId = l.empreendimentoId
    marca('empreendimento')
  }
  if (
    l.formaPagamentoId &&
    formas.value.some((f) => f.id === l.formaPagamentoId) &&
    livre('formaPagamentoId')
  ) {
    form.formaPagamentoId = l.formaPagamentoId
    aoMudarForma()
    marca('forma')
  }

  const somaLida = l.parcelas.reduce((t, p) => t + p.valorCentavos, 0)
  const total = l.valorCentavos ?? (somaLida || null)
  if (!livre('pagamento')) {
    // Valor, parcelas e vencimento já mexidos pela pessoa: ficam como ela deixou.
  } else if (l.parcelas.length > 1 && total && somaLida === total) {
    // Parcelas lidas que fecham com o total entram como estão, uma a uma.
    form.valorCentavos = total
    quantidade.value = l.parcelas.length
    primeiroVencimento.value = l.parcelas[0]!.vencimento
    vencimentoTocado.value = true
    parcelas.value = l.parcelas.map((p) => ({ ...p, pagoEm: null }))
    marca('valor')
    marca('vencimento')
  } else {
    quantidade.value = 1
    if (l.parcelas[0]) {
      primeiroVencimento.value = l.parcelas[0].vencimento
      vencimentoTocado.value = true
      marca('vencimento')
    } else if (!vencimentoTocado.value && vencimentoSugerido.value) {
      primeiroVencimento.value = vencimentoSugerido.value
    }
    if (total) {
      aoMudarTotal(total)
      marca('valor')
    } else {
      regenerar()
    }
  }

  // Comprovante de pagamento: a parcela já nasce paga, na data do comprovante.
  const primeira = parcelas.value[0]
  if (l.pagoEm && parcelas.value.length === 1 && primeira && livre('pagamento')) {
    primeira.pagoEm = l.pagoEm <= hoje() ? l.pagoEm : hoje()
    marca('pago')
  }

  lidos.value = campos
  leitura.value = {
    anexoId,
    tipo: l.tipoDocumento,
    avisos: l.avisos,
    fornecedorNovo: l.fornecedorNovo,
  }
  erros.value = {}
  duplicados.value = null
}

async function tirarComprovante(anexo: AnexoEnviado) {
  // Ainda é rascunho: sai de vez (arquivo e registro). O que já foi preenchido fica.
  try {
    await api.delete(`/anexos/${anexo.id}`)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    if (e.status !== 404) {
      erroArquivo.value = e.message
      return
    }
  }
  comprovantes.value = comprovantes.value.filter((c) => c.id !== anexo.id)
  if (leitura.value?.anexoId === anexo.id) leitura.value = null
}

// ---------- não perder o que foi preenchido ----------

/** A pessoa mexeu em algum campo (ou subiu comprovante) e ainda não salvou. */
const alterado = ref(false)
const temAlgoPorSalvar = computed(() => alterado.value || comprovantes.value.length > 0)

function marcarAlterado() {
  alterado.value = true
}

function avisarAoFechar(evento: BeforeUnloadEvent) {
  if (!temAlgoPorSalvar.value) return
  evento.preventDefault()
  evento.returnValue = ''
}

/**
 * Arquivo solto fora da área do comprovante: sem isto o navegador abre o PDF
 * na aba e o formulário (e a leitura) se perde.
 */
function segurarArquivoSolto(evento: DragEvent) {
  if (evento.dataTransfer?.types?.includes('Files')) evento.preventDefault()
}

onMounted(() => {
  window.addEventListener('beforeunload', avisarAoFechar)
  window.addEventListener('dragover', segurarArquivoSolto)
  window.addEventListener('drop', segurarArquivoSolto)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', avisarAoFechar)
  window.removeEventListener('dragover', segurarArquivoSolto)
  window.removeEventListener('drop', segurarArquivoSolto)
})
onBeforeRouteLeave(() => {
  if (!temAlgoPorSalvar.value) return true
  return window.confirm('Sair sem salvar? O que foi preenchido neste lançamento será perdido.')
})

// ---------- gravar ----------

const erros = ref<Record<string, string>>({})
const erroGeral = ref<string | null>(null)
const duplicados = ref<PossivelDuplicado[] | null>(null)
const salvando = ref(false)

const erro = (campo: string): string | undefined => erros.value[campo]

async function focarPrimeiroErro() {
  await nextTick()
  document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

async function salvar(confirmarDuplicidade = false) {
  if (ocupadoComArquivo.value || salvando.value) return
  erroGeral.value = null
  const payload = {
    ...form,
    // Sem data do gasto, vale hoje (o esquema completa); parcela sem vencimento vence nela.
    dataGasto: form.dataGasto || null,
    parcelas: parcelas.value.map((p) => ({
      valorCentavos: p.valorCentavos,
      vencimento: p.vencimento || form.dataGasto || hoje(),
      pagoEm: p.pagoEm || null,
    })),
    ...(editando.value
      ? { versao: versao.value }
      : { confirmarDuplicidade, anexoIds: comprovantes.value.map((c) => c.id) }),
  }

  const resultado = (editando.value ? lancamentoSchema : criarLancamentoSchema).safeParse(payload)
  const saida: Record<string, string> = {}
  if (!resultado.success) {
    for (const issue of resultado.error.issues)
      saida[issue.path.map(String).join('.')] ??= issue.message
  }
  // "Já foi pago" marcado com a data apagada: sem isto, gravaria como não pago.
  if (parcelas.value.length === 1 && jaPagoMarcado.value && !parcelas.value[0]?.pagoEm) {
    saida['parcelas.0.pagoEm'] ??= 'Informe a data do pagamento (ou desmarque "Já foi pago")'
  }
  if (!resultado.success || Object.keys(saida).length) {
    erros.value = saida
    erroGeral.value = 'Confira os campos destacados.'
    await focarPrimeiroErro()
    return
  }

  erros.value = {}
  salvando.value = true
  try {
    const detalhe = editando.value
      ? await api.put<LancamentoDetalhe>(`/lancamentos/${props.inicial!.id}`, resultado.data)
      : await api.post<LancamentoDetalhe>('/lancamentos', resultado.data)
    duplicados.value = null
    comprovantes.value = []
    alterado.value = false
    sincronizar(detalhe)
    emit('salvo', detalhe)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    const corpo = e.data as RespostaDuplicidade | null
    if (e.status === 409 && Array.isArray(corpo?.duplicados)) {
      duplicados.value = corpo.duplicados
      return
    }
    if (e.status === 400 && e.issues.length) {
      erros.value = e.porCampo
      await focarPrimeiroErro()
    }
    erroGeral.value = e.message
  } finally {
    salvando.value = false
  }
}
</script>

<template>
  <form
    class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"
    novalidate
    @submit.prevent="salvar()"
    @input="marcarAlterado"
    @change="marcarAlterado"
  >
    <div class="flex min-w-0 flex-col gap-5">
      <!-- Comprovante: sobe primeiro e, com a leitura ligada, preenche o formulário. -->
      <section v-if="!editando" class="card">
        <header class="border-b border-line px-5 py-3.5">
          <h2 class="text-[14px] font-semibold text-ink">Comprovante</h2>
          <p class="hint">
            Envie o boleto, a nota ou o recibo: o SIGO lê o arquivo e preenche o formulário, e o
            arquivo fica guardado no lançamento. Confira os campos antes de salvar.
          </p>
        </header>
        <div class="flex flex-col gap-3 p-5">
          <input
            ref="seletorArquivo"
            type="file"
            class="hidden"
            :accept="EXTENSOES_ANEXO"
            @change="aoEscolherArquivo"
          />
          <div
            class="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-4 py-5 text-center text-[13px] text-muted transition-colors"
            :class="
              arrastando ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-alt'
            "
            @dragover="aoArrastar"
            @dragleave="aoSairDoArraste"
            @drop="aoSoltarArquivo"
          >
            <Upload :size="16" class="text-faint" />
            <span class="max-sm:hidden">Arraste o arquivo aqui ou</span>
            <button
              type="button"
              class="btn btn-sm btn-secondary"
              :disabled="ocupadoComArquivo || comprovantes.length >= MAXIMO_COMPROVANTES"
              @click="escolherArquivo"
            >
              <Loader2 v-if="enviandoArquivo" :size="14" class="animate-spin" />
              Escolher arquivo
            </button>
            <span class="w-full text-[12px] text-faint">PDF, JPG ou PNG, até 15 MB</span>
          </div>

          <ul v-if="comprovantes.length" class="flex flex-col divide-y divide-line-soft">
            <li v-for="c in comprovantes" :key="c.id" class="flex items-center gap-3 py-2.5">
              <FileText
                v-if="c.tipo === 'application/pdf'"
                :size="17"
                class="shrink-0 text-faint"
              />
              <ImagemIcone v-else :size="17" class="shrink-0 text-faint" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-medium text-ink" :title="c.nome">
                  {{ c.nome }}
                </div>
                <div class="text-[12px] text-faint">
                  {{ tamanhoArquivo(c.tamanho) }}
                  <template v-if="lendo === c.id"> · lendo o documento…</template>
                  <template v-else-if="leitura?.anexoId === c.id">
                    · formulário preenchido a partir deste arquivo</template
                  >
                </div>
              </div>
              <Loader2 v-if="lendo === c.id" :size="15" class="shrink-0 animate-spin text-faint" />
              <button
                v-else-if="c.leituraDisponivel && leitura?.anexoId !== c.id"
                type="button"
                class="btn btn-sm btn-secondary"
                :disabled="lendo !== null"
                @click="lerComprovante(c)"
              >
                <ScanText :size="14" /> Ler e preencher
              </button>
              <button type="button" class="btn btn-sm btn-ghost" @click="vendo = c">Ver</button>
              <button
                type="button"
                class="btn-icon"
                title="Tirar este arquivo"
                :aria-label="`Tirar ${c.nome}`"
                :disabled="lendo === c.id || salvando"
                @click="tirarComprovante(c)"
              >
                <X :size="15" />
              </button>
            </li>
          </ul>

          <p
            v-for="c in comprovantes.filter((x) => x.duplicadoDe)"
            :key="`dup-${c.id}`"
            class="flex items-start gap-1.5 text-[12.5px] text-ink"
          >
            <TriangleAlert :size="14" class="mt-0.5 shrink-0 text-warn" />
            <span>
              Este arquivo já é comprovante do lançamento
              <NuxtLink
                :to="`/lancamentos/${c.duplicadoDe!.lancamentoId}`"
                target="_blank"
                class="font-medium text-accent-text hover:underline"
                >#{{ c.duplicadoDe!.lancamentoId }}</NuxtLink
              >: {{ c.duplicadoDe!.descricao }}. Confira se não é o mesmo gasto.
            </span>
          </p>

          <p v-if="leituraLigada === false" class="text-[12.5px] text-muted">
            A leitura automática está desligada: o arquivo fica só como comprovante.
            {{ isAdmin ? 'Ligue em Cadastros → Leitura por IA.' : 'Quem liga é o administrador.' }}
          </p>

          <p
            v-if="erro('anexoIds')"
            class="flex items-start gap-1.5 text-[12.5px] text-neg"
            role="alert"
          >
            <CircleAlert :size="14" class="mt-0.5 shrink-0" /> {{ erro('anexoIds') }}
          </p>

          <p
            v-if="erroArquivo"
            class="flex items-start gap-1.5 text-[12.5px] text-neg"
            role="alert"
          >
            <CircleAlert :size="14" class="mt-0.5 shrink-0" /> {{ erroArquivo }}
          </p>

          <div
            v-if="leitura"
            class="flex flex-col gap-2 rounded-lg border border-line-soft bg-surface-alt px-3.5 py-3 text-[12.5px]"
          >
            <p class="text-ink">
              Lido como {{ ROTULO_DOCUMENTO_LIDO[leitura.tipo] }}. Os campos com a marca
              <span class="text-faint">“do arquivo”</span> vieram da leitura: confira antes de
              salvar.
            </p>
            <div v-if="leitura.fornecedorNovo" class="flex flex-wrap items-center gap-2">
              <span class="text-muted">
                Fornecedor fora do cadastro:
                <span class="text-ink">{{ leitura.fornecedorNovo.nome }}</span>
                <template v-if="leitura.fornecedorNovo.documento">
                  · {{ formatarDocumento(leitura.fornecedorNovo.documento) }}</template
                >
              </span>
              <button
                type="button"
                class="btn btn-sm btn-secondary"
                @click="cadastrarFornecedorLido"
              >
                Cadastrar
              </button>
            </div>
            <ul v-if="leitura.avisos.length" class="flex flex-col gap-1">
              <li
                v-for="(a, i) in leitura.avisos"
                :key="i"
                class="flex items-start gap-1.5 text-ink"
              >
                <TriangleAlert :size="14" class="mt-0.5 shrink-0 text-warn" /> {{ a }}
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- O gasto -->
      <section class="card">
        <header class="border-b border-line px-5 py-3.5">
          <h2 class="text-[14px] font-semibold text-ink">O gasto</h2>
          <p class="hint">
            Só a descrição e o valor são obrigatórios; o resto pode ser completado depois.
          </p>
        </header>
        <div class="grid gap-4 p-5 sm:grid-cols-2">
          <FormField
            rotulo="Descrição"
            para="f-descricao"
            :lido="lido('descricao')"
            :erro="erro('descricao')"
            class="sm:col-span-2"
          >
            <input
              id="f-descricao"
              v-model="form.descricao"
              class="input"
              maxlength="300"
              placeholder="Ex.: Impulsionamento no Instagram — lançamento do residencial"
              :aria-invalid="!!erro('descricao') || undefined"
            />
          </FormField>

          <FormField
            rotulo="Valor total"
            para="f-valor"
            :lido="lido('valor')"
            :erro="erro('valorCentavos')"
          >
            <MoneyInput
              id="f-valor"
              :model-value="form.valorCentavos"
              :invalid="!!erro('valorCentavos')"
              @update:model-value="aoMudarTotal"
            />
          </FormField>

          <FormField
            rotulo="Data do gasto"
            para="f-data"
            :lido="lido('dataGasto')"
            :erro="erro('dataGasto')"
            dica="Define o mês em que o gasto entra nos totais. Em branco, vale hoje."
          >
            <input
              id="f-data"
              v-model="form.dataGasto"
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              class="input tnum"
              :aria-invalid="!!erro('dataGasto') || undefined"
              @change="aoMudarDataGasto"
            />
          </FormField>

          <FormField
            rotulo="Fornecedor"
            para="f-fornecedor"
            :lido="lido('fornecedor')"
            :erro="erro('fornecedorId')"
            dica="Quem recebe o pagamento: quem emitiu a nota ou o beneficiário do boleto (não a operadora do cartão). O CNPJ dele é o que acha o título no Sienge."
            class="sm:col-span-2"
          >
            <FornecedorPicker
              id="f-fornecedor"
              v-model="form.fornecedorId"
              :fornecedores="fornecedores ?? []"
              :invalid="!!erro('fornecedorId')"
              pode-criar
              opcional
              @criar="abrirNovoFornecedor"
            />
          </FormField>

          <FormField
            rotulo="Código de identificação"
            para="f-codigo"
            :lido="lido('codigo')"
            :erro="erro('codigoIdentificacao')"
            dica="Nº da nota, do boleto, do pedido ou da transação no cartão. Ajuda a achar duplicidade."
            class="sm:col-span-2"
          >
            <input
              id="f-codigo"
              v-model="form.codigoIdentificacao"
              class="input"
              maxlength="100"
              autocomplete="off"
            />
          </FormField>
        </div>
      </section>

      <!-- Classificação -->
      <section class="card">
        <header class="border-b border-line px-5 py-3.5">
          <h2 class="text-[14px] font-semibold text-ink">Classificação</h2>
          <p class="hint">
            É por aqui que o gasto aparece nos totais por categoria e empreendimento. Em branco,
            entra como “Sem categoria” e “Sem empreendimento”.
          </p>
        </header>
        <div class="grid gap-4 p-5 sm:grid-cols-2">
          <FormField
            v-if="setores.length > 1"
            rotulo="Setor"
            para="f-setor"
            :erro="erro('setorId')"
            class="sm:col-span-2"
          >
            <select
              id="f-setor"
              v-model="form.setorId"
              class="input"
              :aria-invalid="!!erro('setorId') || undefined"
            >
              <option v-for="s in setores" :key="s.id" :value="s.id">{{ s.nome }}</option>
            </select>
          </FormField>

          <FormField
            rotulo="Categoria"
            para="f-categoria"
            :lido="lido('categoria')"
            :erro="erro('categoriaId')"
            :dica="categoriaEscolhida?.descricao ?? undefined"
          >
            <select
              id="f-categoria"
              v-model="form.categoriaId"
              class="input [&>option]:text-ink"
              :class="{ 'text-ghost': form.categoriaId === null }"
              :aria-invalid="!!erro('categoriaId') || undefined"
            >
              <option :value="null">Sem categoria</option>
              <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
            </select>
          </FormField>

          <FormField
            rotulo="Empreendimento"
            para="f-emp"
            :lido="lido('empreendimento')"
            :erro="erro('empreendimentoId')"
          >
            <select
              id="f-emp"
              v-model="form.empreendimentoId"
              class="input [&>option]:text-ink"
              :class="{ 'text-ghost': form.empreendimentoId === null }"
              :aria-invalid="!!erro('empreendimentoId') || undefined"
            >
              <option :value="null">Sem empreendimento</option>
              <option v-for="e in empreendimentos" :key="e.id" :value="e.id">{{ e.nome }}</option>
            </select>
          </FormField>

          <FormField
            rotulo="Campanha"
            para="f-campanha"
            :erro="erro('campanhaId')"
            class="sm:col-span-2"
          >
            <select id="f-campanha" v-model="form.campanhaId" class="input">
              <option :value="null">Sem campanha</option>
              <option v-for="c in campanhas" :key="c.id" :value="c.id">{{ c.nome }}</option>
            </select>
          </FormField>
        </div>
      </section>

      <!-- Pagamento -->
      <section class="card">
        <header class="border-b border-line px-5 py-3.5">
          <h2 class="text-[14px] font-semibold text-ink">Pagamento</h2>
          <p class="hint">
            Como e quando o gasto é pago. Sem mexer aqui, fica à vista, vencendo na data do gasto.
          </p>
        </header>
        <div class="grid gap-4 p-5 sm:grid-cols-3">
          <FormField
            rotulo="Forma de pagamento"
            para="f-forma"
            :lido="lido('forma')"
            :erro="erro('formaPagamentoId')"
            class="sm:col-span-3"
          >
            <select
              id="f-forma"
              v-model="form.formaPagamentoId"
              class="input [&>option]:text-ink"
              :class="{ 'text-ghost': form.formaPagamentoId === null }"
              :aria-invalid="!!erro('formaPagamentoId') || undefined"
              @change="aoMudarForma"
            >
              <option :value="null">Não informada</option>
              <option v-for="f in formas" :key="f.id" :value="f.id">{{ f.nome }}</option>
            </select>
          </FormField>

          <!-- Forma de cartão: qual cartão (e a fatura dele define o vencimento). -->
          <FormField
            v-if="formaEscolhida?.cartao"
            rotulo="Cartão"
            para="f-cartao"
            :erro="erro('cartaoId')"
            :dica="
              !cartoesDaForma.length
                ? 'Nenhum cartão cadastrado para esta forma. Cadastre em Cadastros › Cartões para acompanhar o orçamento.'
                : cartaoEscolhido?.diaFechamento
                  ? `Fatura fecha dia ${cartaoEscolhido.diaFechamento} e vence dia ${cartaoEscolhido.diaVencimento}: o vencimento abaixo já segue a fatura.`
                  : undefined
            "
            class="sm:col-span-3"
          >
            <select
              id="f-cartao"
              v-model="form.cartaoId"
              class="input [&>option]:text-ink"
              :class="{ 'text-ghost': form.cartaoId === null }"
              :disabled="!cartoesDaForma.length"
              :aria-invalid="!!erro('cartaoId') || undefined"
              @change="aoMudarCartao"
            >
              <option :value="null">Não informado</option>
              <option v-for="c in cartoesDaForma" :key="c.id" :value="c.id">
                {{ c.nome }}{{ c.final ? ` •••• ${c.final}` : '' }}
              </option>
            </select>
          </FormField>

          <FormField rotulo="Parcelas" para="f-qtd">
            <input
              id="f-qtd"
              v-model.number="quantidade"
              type="number"
              min="1"
              max="60"
              class="input tnum"
              @change="aoMudarQuantidade"
            />
          </FormField>

          <FormField
            :rotulo="quantidade > 1 ? '1º vencimento' : 'Vencimento'"
            para="f-venc"
            :lido="lido('vencimento')"
            :erro="erro('parcelas.0.vencimento')"
          >
            <input
              id="f-venc"
              v-model="primeiroVencimento"
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              class="input tnum"
              :aria-invalid="!!erro('parcelas.0.vencimento') || undefined"
              @change="aoMudarPrimeiroVencimento"
            />
          </FormField>

          <!-- À vista: marcar o pagamento direto -->
          <div v-if="parcelas.length === 1" class="flex flex-col justify-end gap-1.5">
            <label class="flex h-9 items-center gap-2 text-[13px] text-ink">
              <input v-model="jaPago" type="checkbox" class="size-4" />
              Já foi pago
            </label>
          </div>
          <FormField
            v-if="parcelas.length === 1 && jaPago"
            rotulo="Pago em"
            para="f-pago"
            :lido="lido('pago')"
            :erro="erro('parcelas.0.pagoEm')"
            class="sm:col-start-3"
          >
            <input
              id="f-pago"
              v-model="pagoEmUnica"
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              class="input tnum"
              :aria-invalid="!!erro('parcelas.0.pagoEm') || undefined"
            />
          </FormField>
        </div>

        <!-- Parcelado: uma linha por parcela -->
        <div v-if="parcelas.length > 1" class="border-t border-line">
          <table class="table">
            <thead>
              <tr>
                <th class="w-12">Nº</th>
                <th>Vencimento</th>
                <th class="text-right">Valor</th>
                <th>Pago em</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in parcelas" :key="i">
                <td class="tnum text-muted">{{ i + 1 }}</td>
                <td>
                  <input
                    v-model="p.vencimento"
                    type="date"
                    min="2000-01-01"
                    max="2099-12-31"
                    class="input input-sm tnum max-w-[170px]"
                    :aria-label="`Vencimento da parcela ${i + 1}`"
                    :aria-invalid="!!erro(`parcelas.${i}.vencimento`) || undefined"
                  />
                </td>
                <td>
                  <MoneyInput
                    v-model="p.valorCentavos"
                    compacto
                    class="ml-auto max-w-[160px]"
                    :invalid="!!erro(`parcelas.${i}.valorCentavos`)"
                  />
                </td>
                <td>
                  <input
                    v-model="p.pagoEm"
                    type="date"
                    min="2000-01-01"
                    max="2099-12-31"
                    class="input input-sm tnum max-w-[170px]"
                    :aria-label="`Pagamento da parcela ${i + 1}`"
                    :aria-invalid="!!erro(`parcelas.${i}.pagoEm`) || undefined"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p
          v-if="erro('parcelas')"
          class="mx-5 mb-4 flex items-center gap-1.5 text-[12px] text-neg"
          :class="parcelas.length > 1 ? 'mt-3' : ''"
        >
          <CircleAlert :size="14" /> {{ erro('parcelas') }}
        </p>
      </section>

      <!-- Observação -->
      <section class="card p-5">
        <FormField
          rotulo="Observação"
          para="f-obs"
          :lido="lido('observacao')"
          :erro="erro('observacao')"
        >
          <textarea
            id="f-obs"
            v-model="form.observacao"
            class="input"
            maxlength="2000"
            placeholder="Contexto que ajuda quem consultar depois: aprovação, negociação, pendência…"
          />
        </FormField>
      </section>
    </div>

    <!-- Resumo e ações -->
    <aside class="flex flex-col gap-4 xl:sticky xl:top-5">
      <div
        v-if="duplicados?.length"
        class="rounded-xl border border-warn/30 bg-warn-soft p-4"
        role="alert"
      >
        <div class="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <TriangleAlert :size="16" class="text-warn" /> Possível duplicidade
        </div>
        <p class="mt-1 text-[12.5px] text-muted">
          Já existe gasto parecido com este. Confira se não é o mesmo.
        </p>
        <ul class="mt-3 flex flex-col gap-1.5">
          <li v-for="d in duplicados" :key="d.id" class="text-[12.5px]">
            <NuxtLink
              :to="`/lancamentos/${d.id}`"
              target="_blank"
              class="font-medium text-accent-text hover:underline"
              >#{{ d.id }}</NuxtLink
            >
            <span class="text-muted">
              · {{ data(d.dataGasto) }} · {{ reais(d.valorCentavos) }}</span
            >
            <div class="truncate text-faint">{{ d.descricao }}</div>
          </li>
        </ul>
        <div class="mt-3 flex gap-2">
          <button
            type="button"
            class="btn btn-sm btn-secondary"
            :disabled="salvando || ocupadoComArquivo"
            @click="salvar(true)"
          >
            Salvar mesmo assim
          </button>
          <button type="button" class="btn btn-sm btn-ghost" @click="duplicados = null">
            Revisar
          </button>
        </div>
      </div>

      <div class="card p-5">
        <div class="eyebrow">Resumo</div>
        <div class="mt-2 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          {{ reais(form.valorCentavos ?? 0) }}
        </div>
        <div class="mt-0.5 text-[12.5px] text-muted">{{ textoParcelas }}</div>

        <dl class="mt-4 flex flex-col gap-2.5 border-t border-line pt-4 text-[12.5px]">
          <div class="flex justify-between gap-3">
            <dt class="text-faint">Fornecedor</dt>
            <dd class="truncate text-right text-ink">
              {{ nome(fornecedores, form.fornecedorId) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-faint">Categoria</dt>
            <dd class="truncate text-right text-ink">
              {{ nome(cadastros?.categorias, form.categoriaId) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-faint">Empreendimento</dt>
            <dd class="truncate text-right text-ink">
              {{ nome(cadastros?.empreendimentos, form.empreendimentoId) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-faint">Pagamento</dt>
            <dd class="truncate text-right text-ink">
              {{ nome(cadastros?.formasPagamento, form.formaPagamentoId) }}
              <span v-if="cartaoEscolhido" class="block truncate text-faint">{{
                cartaoEscolhido.nome
              }}</span>
            </dd>
          </div>
        </dl>

        <p
          v-if="form.valorCentavos && diferenca !== 0"
          class="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-ink"
        >
          As parcelas somam {{ reais(somaParcelas) }}: {{ diferenca > 0 ? 'faltam' : 'sobram' }}
          {{ reais(Math.abs(diferenca)) }}.
        </p>

        <p
          v-if="erroGeral && !duplicados?.length"
          class="mt-4 rounded-lg bg-neg-soft px-3 py-2 text-[12px] text-ink"
          role="alert"
        >
          {{ erroGeral }}
        </p>

        <div class="mt-5 flex flex-col gap-2">
          <p v-if="ocupadoComArquivo" class="text-center text-[12px] text-faint">
            Esperando o comprovante subir e ser lido…
          </p>
          <button
            type="submit"
            class="btn btn-primary w-full"
            :disabled="salvando || ocupadoComArquivo"
          >
            <Loader2 v-if="salvando" :size="15" class="animate-spin" />
            {{ editando ? 'Salvar alterações' : 'Registrar lançamento' }}
          </button>
          <button type="button" class="btn btn-secondary w-full" @click="emit('cancelar')">
            Cancelar
          </button>
        </div>
      </div>
    </aside>

    <VisualizadorComprovante :anexo="vendo" @fechar="vendo = null" />

    <NovoFornecedorModal
      :open="modalFornecedor"
      :nome-inicial="nomeFornecedor"
      :documento-inicial="documentoFornecedor"
      @fechar="modalFornecedor = false"
      @criado="aoCriarFornecedor"
    />
  </form>
</template>
