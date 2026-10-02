<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import {
  CircleAlert,
  CircleCheck,
  ClipboardCopy,
  FileJson,
  Loader2,
  Paperclip,
  TriangleAlert,
  Upload,
} from 'lucide-vue-next'
import {
  chaveDeArquivo,
  criarLancamentoSchema,
  formatarDocumento,
  hoje,
  importacaoSchema,
  normalizarNome,
  prepararImportacao,
  TAMANHO_MAXIMO_ANEXO,
  type AnexoEnviado,
  type Fornecedor,
  type Importacao,
  type LancamentoDetalhe,
  type LancamentoPreparado,
  type PossivelDuplicado,
  type ProblemaImportacao,
  type RecargaPreparada,
  type RespostaDuplicidade,
} from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { useCadastros, useFornecedores } from '~/composables/useCadastros'
import { data, reais } from '~/composables/useFormat'
import { invalidarTotais, useSituacaoCartoes } from '~/composables/useLancamentos'
import { useToast } from '~/composables/useToast'

/*
  Aba "Importar" dos cadastros (só para quem lança). TEMPORÁRIA, enquanto a
  leitura por IA não está ligada: os documentos são lidos no chat com o
  Claude, que devolve um importacao.json (formato em `contracts/importacao.ts`)
  e os comprovantes. Aqui a pessoa arrasta tudo junto, confere linha a linha e
  registra. A gravação usa as rotas de sempre (fornecedor, comprovante,
  recarga, lançamento), uma linha por vez: o que der problema fica marcado e o
  resto segue.
*/
const { user } = useAuth()
const { data: cadastros } = useCadastros()
const { data: fornecedores } = useFornecedores()
const { data: situacaoCartoes } = useSituacaoCartoes()
const api = useApi()
const qc = useQueryClient()
const toast = useToast()

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
const temErro = (problemas: ProblemaImportacao[]) => problemas.some((p) => p.nivel === 'erro')

// ---------- arquivos ----------

const arquivo = ref<Importacao | null>(null)
const nomeDoJson = ref<string | null>(null)
const errosDoArquivo = ref<string[]>([])
/** Comprovantes enviados junto, pela chave do nome (sem diferença de caixa). */
const comprovantes = ref(new Map<string, File>())
const seletor = ref<HTMLInputElement | null>(null)
const arrastando = ref(false)
const colando = ref(false)
const textoColado = ref('')

/** "lancamentos.2.parcelas" → "Lançamento 3 › parcelas: ". */
function onde(caminho: PropertyKey[]): string {
  if (!caminho.length) return ''
  const [lista, posicao, ...resto] = caminho
  const rotulo =
    lista === 'lancamentos' ? 'Lançamento' : lista === 'recargas' ? 'Recarga' : String(lista)
  const numero = typeof posicao === 'number' ? ` ${posicao + 1}` : ''
  const campo = [typeof posicao === 'number' ? null : posicao, ...resto]
    .filter((p) => p !== null && p !== undefined)
    .map(String)
    .join('.')
  return `${rotulo}${numero}${campo ? ` › ${campo}` : ''}: `
}

function lerJson(texto: string, nome: string | null) {
  errosDoArquivo.value = []
  let json: unknown
  try {
    // O Bloco de Notas grava UTF-8 com BOM, que o JSON.parse recusa.
    json = JSON.parse(texto.replace(/^﻿/, ''))
  } catch {
    errosDoArquivo.value = ['O conteúdo não é um JSON válido.']
    return
  }
  const r = importacaoSchema.safeParse(json)
  if (!r.success) {
    errosDoArquivo.value = r.error.issues.map((i) => `${onde(i.path)}${i.message}`)
    return
  }
  arquivo.value = r.data
  nomeDoJson.value = nome
  estadosLancamento.value = {}
  estadosRecarga.value = {}
  fornecedoresCriados.clear()
}

async function receberArquivos(lista: FileList | null | undefined) {
  if (!lista?.length) return
  const todos = [...lista]
  const json = todos.find((f) => f.name.toLowerCase().endsWith('.json'))
  const grandes: string[] = []
  for (const f of todos) {
    if (f === json) continue
    if (f.size > TAMANHO_MAXIMO_ANEXO) grandes.push(f.name)
    else comprovantes.value.set(chaveDeArquivo(f.name), f)
  }
  if (grandes.length) toast.erro(`Passam de 15 MB e ficaram de fora: ${grandes.join(', ')}`)
  if (json) lerJson(await json.text(), json.name)
}

function escolherArquivos() {
  seletor.value?.click()
}

function aoEscolher(evento: Event) {
  const campo = evento.target as HTMLInputElement
  void receberArquivos(campo.files).finally(() => {
    campo.value = ''
  })
}

function aoSoltar(evento: DragEvent) {
  arrastando.value = false
  void receberArquivos(evento.dataTransfer?.files)
}

function lerColado() {
  lerJson(textoColado.value, null)
}

function alternarColar() {
  colando.value = !colando.value
}

function recomecar() {
  arquivo.value = null
  nomeDoJson.value = null
  errosDoArquivo.value = []
  comprovantes.value = new Map()
  textoColado.value = ''
  estadosLancamento.value = {}
  estadosRecarga.value = {}
  fornecedoresCriados.clear()
}

/** Arquivo solto fora da área: sem isto o navegador abre o PDF e a página se perde. */
function segurarArquivoSolto(evento: DragEvent) {
  if (evento.dataTransfer?.types?.includes('Files')) evento.preventDefault()
}
onMounted(() => {
  window.addEventListener('dragover', segurarArquivoSolto)
  window.addEventListener('drop', segurarArquivoSolto)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragover', segurarArquivoSolto)
  window.removeEventListener('drop', segurarArquivoSolto)
})

const arquivoDo = (nome: string) => comprovantes.value.get(chaveDeArquivo(nome))
const citados = computed(
  () =>
    new Set((arquivo.value?.lancamentos ?? []).flatMap((l) => l.comprovantes.map(chaveDeArquivo))),
)
const naoCitados = computed(() =>
  [...comprovantes.value.keys()].filter((k) => !citados.value.has(k)),
)
const encontrados = computed(
  () => [...citados.value].filter((k) => comprovantes.value.has(k)).length,
)

// ---------- setor e preparação ----------

const setores = computed(() => cadastros.value?.setores ?? [])
const setorEscolhido = ref<number | null>(null)
watch(
  cadastros,
  (c) => {
    if (setorEscolhido.value === null && c?.setores.length) {
      setorEscolhido.value = user.value?.setores[0]?.id ?? c.setores[0]!.id
    }
  },
  { immediate: true },
)

const preparada = computed(() =>
  arquivo.value && cadastros.value && fornecedores.value
    ? prepararImportacao(
        arquivo.value,
        { ...cadastros.value, fornecedores: fornecedores.value },
        setorEscolhido.value,
        hoje(),
      )
    : null,
)

// ---------- estado de cada linha ----------

interface EstadoLinha {
  incluir: boolean
  situacao: 'pendente' | 'gravando' | 'gravado' | 'duplicado' | 'erro'
  mensagem: string | null
  lancamentoId?: number
  duplicados?: PossivelDuplicado[]
  /** Comprovantes já enviados (nome → anexo): gravar de novo não reenvia. */
  anexos?: Record<string, number>
}

const estadosLancamento = ref<Record<number, EstadoLinha>>({})
const estadosRecarga = ref<Record<number, EstadoLinha>>({})
const novoEstado = (incluir: boolean): EstadoLinha => ({
  incluir,
  situacao: 'pendente',
  mensagem: null,
})

// A linha com erro ou a recarga repetida já nasce desmarcada.
watch(
  preparada,
  (p) => {
    if (!p) return
    for (const l of p.lancamentos) {
      estadosLancamento.value[l.indice] ??= novoEstado(!temErro(l.problemas))
    }
    for (const r of p.recargas) {
      estadosRecarga.value[r.indice] ??= novoEstado(!!r.dados && !r.jaRegistrada)
    }
  },
  { immediate: true },
)

const estadoL = (l: LancamentoPreparado) => estadosLancamento.value[l.indice]!
const estadoR = (r: RecargaPreparada) => estadosRecarga.value[r.indice]!
const aGravar = (e: EstadoLinha | undefined) =>
  !!e && e.incluir && (e.situacao === 'pendente' || e.situacao === 'erro')
const lancamentoVai = (l: LancamentoPreparado) =>
  aGravar(estadosLancamento.value[l.indice]) && !temErro(l.problemas)
const recargaVai = (r: RecargaPreparada) => aGravar(estadosRecarga.value[r.indice]) && !!r.dados

const lancamentosAGravar = computed(() => preparada.value?.lancamentos.filter(lancamentoVai) ?? [])
const recargasAGravar = computed(() => preparada.value?.recargas.filter(recargaVai) ?? [])
const gravados = computed(
  () =>
    Object.values(estadosLancamento.value).filter((e) => e.situacao === 'gravado').length +
    Object.values(estadosRecarga.value).filter((e) => e.situacao === 'gravado').length,
)

/** Os avisos da linha, mais os comprovantes citados que não vieram. */
function problemasDe(l: LancamentoPreparado): ProblemaImportacao[] {
  const faltando = l.original.comprovantes
    .filter((nome) => !arquivoDo(nome))
    .map((nome) => ({
      nivel: 'aviso' as const,
      texto: `Comprovante “${nome}” não veio: arraste o arquivo ou anexe depois no lançamento`,
    }))
  return [...l.problemas, ...faltando]
}

function documentoDe(l: LancamentoPreparado): string {
  const documento =
    l.fornecedorNovo?.documento ??
    fornecedores.value?.find((f) => f.id === l.dados.fornecedorId)?.documento
  return documento ? formatarDocumento(documento) : ''
}

function textoPagamento(l: LancamentoPreparado): string {
  const parcelas = l.dados.parcelas
  const primeira = parcelas[0]!
  const como = [l.nomes.forma, l.nomes.cartao].filter(Boolean).join(' · ') || 'Forma não informada'
  if (parcelas.length === 1) {
    return `${como} · ${primeira.pagoEm ? `pago em ${data(primeira.pagoEm)}` : `vence em ${data(primeira.vencimento)}`}`
  }
  const pagas = parcelas.filter((p) => p.pagoEm).length
  return `${como} · ${parcelas.length}× · 1ª em ${data(primeira.vencimento)}${pagas ? ` · ${pagas} paga(s)` : ''}`
}

// ---------- saldo do cartão frente ao extrato ----------

const conferenciaSaldo = computed(() => {
  const p = preparada.value
  const s = p?.saldoExtrato
  if (!p || !s) return null
  const atual = situacaoCartoes.value?.saldos.find((x) => x.cartaoId === s.cartaoId)?.centavos
  if (atual === undefined) return null
  const dia = hoje()
  const entra = p.recargas
    .filter((r) => r.dados?.cartaoId === s.cartaoId && recargaVai(r))
    .reduce((t, r) => t + r.original.valorCentavos, 0)
  const sai = p.lancamentos
    .filter((l) => l.dados.cartaoId === s.cartaoId && l.dados.dataGasto <= dia && lancamentoVai(l))
    .reduce((t, l) => t + l.dados.valorCentavos, 0)
  const previsto = atual + entra - sai
  return { ...s, atual, previsto, diferenca: previsto - s.centavos }
})

// ---------- gravar ----------

const gravando = ref(false)
/** Fornecedor novo já cadastrado nesta importação (documento ou nome → id). */
const fornecedoresCriados = new Map<string, number>()

const mensagemDe = (e: ApiError) =>
  e.issues.length ? e.issues.map((i) => i.message).join(' · ') : e.message

async function garantirFornecedor(novo: { nome: string; documento: string | null }) {
  const chave = novo.documento ?? `nome:${normalizarNome(novo.nome)}`
  const ja = fornecedoresCriados.get(chave)
  if (ja) return ja
  try {
    const f = await api.post<Fornecedor>('/fornecedores', novo)
    fornecedoresCriados.set(chave, f.id)
    return f.id
  } catch (e) {
    // Cadastrado por outra pessoa com a página aberta: usa o que já existe.
    const existente =
      e instanceof ApiError && e.status === 409
        ? (e.data as { fornecedor?: Fornecedor } | null)?.fornecedor
        : undefined
    if (!existente?.ativo) throw e
    fornecedoresCriados.set(chave, existente.id)
    return existente.id
  }
}

async function enviarComprovantes(l: LancamentoPreparado, estado: EstadoLinha) {
  const anexos = (estado.anexos ??= {})
  for (const nome of l.original.comprovantes) {
    const f = arquivoDo(nome)
    if (!f || anexos[nome]) continue
    const dados = new FormData()
    dados.append('arquivo', f)
    anexos[nome] = (await api.enviar<AnexoEnviado>('/anexos', dados)).id
  }
  return Object.values(anexos)
}

async function gravarLancamento(l: LancamentoPreparado, confirmarDuplicidade: boolean) {
  const estado = estadoL(l)
  estado.situacao = 'gravando'
  estado.mensagem = null
  estado.duplicados = undefined
  try {
    const fornecedorId = l.fornecedorNovo
      ? await garantirFornecedor(l.fornecedorNovo)
      : l.dados.fornecedorId
    const anexoIds = await enviarComprovantes(l, estado)
    const r = criarLancamentoSchema.safeParse({
      ...l.dados,
      fornecedorId,
      anexoIds,
      confirmarDuplicidade,
    })
    if (!r.success) {
      estado.situacao = 'erro'
      estado.mensagem = r.error.issues.map((i) => i.message).join(' · ')
      return
    }
    const salvo = await api.post<LancamentoDetalhe>('/lancamentos', r.data)
    estado.situacao = 'gravado'
    estado.lancamentoId = salvo.id
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    const corpo = e.data as RespostaDuplicidade | null
    if (e.status === 409 && Array.isArray(corpo?.duplicados)) {
      estado.situacao = 'duplicado'
      estado.duplicados = corpo.duplicados
      return
    }
    estado.situacao = 'erro'
    estado.mensagem = mensagemDe(e)
  }
}

async function gravarRecarga(r: RecargaPreparada) {
  const estado = estadoR(r)
  estado.situacao = 'gravando'
  estado.mensagem = null
  try {
    await api.post('/recargas', r.dados)
    estado.situacao = 'gravado'
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    estado.situacao = 'erro'
    estado.mensagem = mensagemDe(e)
  }
}

async function atualizarListas() {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['cadastros'] }),
    qc.invalidateQueries({ queryKey: ['fornecedores'] }),
  ])
  invalidarTotais(qc)
}

/** Recargas primeiro, depois os lançamentos, um por vez: o que falhar fica marcado na linha. */
async function registrar() {
  if (gravando.value || !preparada.value || preparada.value.setorId === null) return
  const recargas = [...recargasAGravar.value]
  const lancamentos = [...lancamentosAGravar.value]
  gravando.value = true
  try {
    for (const r of recargas) await gravarRecarga(r)
    for (const l of lancamentos) await gravarLancamento(l, false)
  } finally {
    gravando.value = false
    await atualizarListas()
  }
}

async function registrarMesmoAssim(l: LancamentoPreparado) {
  if (gravando.value) return
  gravando.value = true
  try {
    await gravarLancamento(l, true)
  } finally {
    gravando.value = false
    await atualizarListas()
  }
}

function deixarDeFora(l: LancamentoPreparado) {
  const estado = estadoL(l)
  estado.incluir = false
  estado.situacao = 'pendente'
  estado.duplicados = undefined
}

const textoDoBotao = computed(() => {
  const partes = [
    lancamentosAGravar.value.length
      ? plural(lancamentosAGravar.value.length, 'lançamento', 'lançamentos')
      : null,
    recargasAGravar.value.length
      ? plural(recargasAGravar.value.length, 'recarga', 'recargas')
      : null,
  ].filter(Boolean)
  return partes.length ? `Registrar ${partes.join(' e ')}` : 'Nada marcado para registrar'
})

// ---------- cadastros para o chat ----------

/** Os nomes como estão no SIGO, para quem monta o arquivo usar os mesmos. */
async function copiarCadastros() {
  const c = cadastros.value
  if (!c) return
  const setorId = preparada.value?.setorId ?? setorEscolhido.value
  const ativos = <T extends { ativo: boolean }>(itens: readonly T[]) => itens.filter((i) => i.ativo)
  const nomeForma = (id: number) => c.formasPagamento.find((f) => f.id === id)?.nome ?? ''
  const cartoes = ativos(c.cartoes)
    .filter((k) => k.setorId === setorId)
    .map(
      (k) =>
        `${k.nome}${k.final ? ` final ${k.final}` : ''} (${nomeForma(k.formaPagamentoId)}, ${
          k.recarga === 'avulsa' ? 'recarga avulsa' : 'orçamento mensal'
        }, ${
          k.diaFechamento
            ? `fatura fecha dia ${k.diaFechamento} e vence dia ${k.diaVencimento}`
            : 'sem fatura'
        })`,
    )
  const texto = [
    `Cadastros do SIGO em ${data(hoje())}, setor ${c.setores.find((s) => s.id === setorId)?.nome ?? '—'}:`,
    `Categorias: ${ativos(c.categorias)
      .filter((x) => x.setorId === setorId)
      .map((x) => (x.descricao ? `${x.nome} (${x.descricao})` : x.nome))
      .join('; ')}`,
    `Empreendimentos: ${ativos(c.empreendimentos)
      .map((x) => x.nome)
      .join('; ')}`,
    `Formas de pagamento: ${ativos(c.formasPagamento)
      .map((x) => (x.cartao ? `${x.nome} (cartão)` : x.nome))
      .join('; ')}`,
    `Cartões: ${cartoes.join('; ') || 'nenhum'}`,
  ].join('\n')
  try {
    await navigator.clipboard.writeText(texto)
    toast.sucesso('Cadastros copiados: cole no chat com o Claude')
  } catch {
    toast.erro('O navegador não deixou copiar. Tente de novo.')
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 px-5 py-5 sm:px-6" @dragover.prevent @drop.prevent="aoSoltar">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="max-w-2xl text-[13px] text-muted">
        Lançamentos e recargas lidos fora do SIGO, no chat com o Claude: um arquivo .json com os
        comprovantes. Temporário: sai quando a leitura por IA estiver ligada.
      </p>
      <div class="flex items-center gap-2">
        <button
          v-if="arquivo"
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="gravando"
          @click="recomecar"
        >
          Outro arquivo
        </button>
        <button
          type="button"
          class="btn btn-sm btn-secondary"
          :disabled="!cadastros"
          title="Copia os nomes das categorias, empreendimentos, formas e cartões, para o arquivo usar os mesmos"
          @click="copiarCadastros"
        >
          <ClipboardCopy :size="14" /> Copiar cadastros
        </button>
      </div>
    </div>

    <input
      ref="seletor"
      type="file"
      multiple
      class="hidden"
      accept=".json,application/json,.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
      @change="aoEscolher"
    />

    <!-- 1. os arquivos -->
    <section v-if="!arquivo" class="card">
      <div class="flex flex-col gap-3 p-5">
        <div
          class="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-4 py-8 text-center text-[13px] text-muted transition-colors"
          :class="arrastando ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-alt'"
          @dragover.prevent="arrastando = true"
          @dragleave="arrastando = false"
        >
          <Upload :size="16" class="text-faint" />
          <span class="max-sm:hidden">Arraste o importacao.json e os comprovantes ou</span>
          <button type="button" class="btn btn-sm btn-secondary" @click="escolherArquivos">
            Escolher arquivos
          </button>
          <span class="w-full text-[12px] text-faint">
            O .json e os PDF, JPG ou PNG que ele cita, até 15 MB cada. Dá para selecionar tudo de
            uma vez.
          </span>
        </div>

        <button
          type="button"
          class="self-start text-[12.5px] font-medium text-accent-text hover:underline"
          @click="alternarColar"
        >
          {{ colando ? 'Fechar' : 'Ou cole o JSON' }}
        </button>
        <template v-if="colando">
          <textarea
            v-model="textoColado"
            class="input min-h-40 font-mono text-[12px]"
            spellcheck="false"
            aria-label="JSON da importação"
            placeholder='{ "formato": "sigo-importacao/1", ... }'
          />
          <button
            type="button"
            class="btn btn-sm btn-secondary self-start"
            :disabled="!textoColado.trim()"
            @click="lerColado"
          >
            Ler o JSON
          </button>
        </template>

        <ul v-if="errosDoArquivo.length" class="flex flex-col gap-1" role="alert">
          <li
            v-for="(erro, i) in errosDoArquivo"
            :key="i"
            class="flex items-start gap-1.5 text-[12.5px] text-neg"
          >
            <CircleAlert :size="14" class="mt-0.5 shrink-0" /> {{ erro }}
          </li>
        </ul>
      </div>
    </section>

    <template v-else-if="preparada">
      <!-- resumo -->
      <section class="card p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-[14px] font-semibold text-ink">
              <FileJson :size="16" class="shrink-0 text-faint" />
              <span class="truncate">{{
                arquivo.titulo ?? nomeDoJson ?? 'Importação colada'
              }}</span>
            </div>
            <p class="mt-1 text-[13px] text-muted">
              {{ plural(arquivo.lancamentos.length, 'lançamento', 'lançamentos') }}
              <template v-if="arquivo.recargas.length">
                · {{ plural(arquivo.recargas.length, 'recarga', 'recargas') }}</template
              >
              <template v-if="citados.size">
                · comprovantes: {{ encontrados }} de {{ citados.size }}</template
              >
              <template v-if="naoCitados.length">
                · {{ plural(naoCitados.length, 'arquivo', 'arquivos') }} que o JSON não
                cita</template
              >
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select
              v-if="!arquivo.setor && setores.length > 1"
              v-model="setorEscolhido"
              class="input input-sm w-auto"
              aria-label="Setor"
              :disabled="gravando"
            >
              <option v-for="s in setores" :key="s.id" :value="s.id">{{ s.nome }}</option>
            </select>
            <button
              type="button"
              class="btn btn-sm btn-secondary"
              :disabled="gravando"
              @click="escolherArquivos"
            >
              <Paperclip :size="14" /> Adicionar comprovantes
            </button>
          </div>
        </div>

        <ul v-if="preparada.problemas.length" class="mt-3 flex flex-col gap-1">
          <li
            v-for="(p, i) in preparada.problemas"
            :key="i"
            class="flex items-start gap-1.5 text-[12.5px]"
            :class="p.nivel === 'erro' ? 'text-neg' : 'text-ink'"
          >
            <CircleAlert v-if="p.nivel === 'erro'" :size="14" class="mt-0.5 shrink-0" />
            <TriangleAlert v-else :size="14" class="mt-0.5 shrink-0 text-warn" />
            {{ p.texto }}
          </li>
        </ul>

        <div
          v-if="conferenciaSaldo"
          class="mt-4 flex flex-col gap-1 rounded-lg bg-surface-alt px-3.5 py-3 text-[12.5px]"
        >
          <div class="text-ink">
            Saldo do {{ conferenciaSaldo.cartaoNome }}: hoje
            <span class="tnum font-medium">{{ reais(conferenciaSaldo.atual) }}</span> no SIGO,
            <span class="tnum font-medium">{{ reais(conferenciaSaldo.previsto) }}</span> com o que
            está marcado. Extrato em {{ data(conferenciaSaldo.em) }}:
            <span class="tnum font-medium">{{ reais(conferenciaSaldo.centavos) }}</span
            >.
          </div>
          <div v-if="conferenciaSaldo.diferenca === 0" class="flex items-center gap-1.5 text-ink">
            <CircleCheck :size="14" class="text-pos" /> Bate com o extrato.
          </div>
          <div v-else class="flex items-center gap-1.5 text-ink">
            <TriangleAlert :size="14" class="text-warn" /> Diferença de
            <span class="tnum font-medium">{{ reais(Math.abs(conferenciaSaldo.diferenca)) }}</span>
            ({{ conferenciaSaldo.diferenca > 0 ? 'sobra' : 'falta' }} no SIGO): falta ou sobra algum
            lançamento ou recarga.
          </div>
        </div>
      </section>

      <!-- recargas -->
      <section v-if="preparada.recargas.length" class="card overflow-hidden">
        <header class="border-b border-line px-5 py-3.5">
          <h2 class="text-[14px] font-semibold text-ink">Recargas</h2>
          <p class="hint">Dinheiro que entrou no cartão de recarga avulsa.</p>
        </header>
        <ul class="divide-y divide-line-soft">
          <li
            v-for="r in preparada.recargas"
            :key="r.indice"
            class="flex items-start gap-3 px-5 py-3"
            :class="!estadoR(r).incluir && estadoR(r).situacao !== 'gravado' && 'opacity-60'"
          >
            <input
              v-model="estadoR(r).incluir"
              type="checkbox"
              class="mt-0.5 size-4 shrink-0"
              :disabled="!r.dados || gravando || estadoR(r).situacao === 'gravado'"
              :aria-label="`Registrar a recarga de ${data(r.original.data)}`"
            />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3">
                <span class="text-[13.5px] font-medium text-ink">
                  <span class="tnum text-muted">{{ data(r.original.data) }}</span> ·
                  {{ r.cartaoNome ?? `Cartão ${r.original.cartao}` }}
                </span>
                <span class="tnum text-[13.5px] font-semibold text-ink">{{
                  reais(r.original.valorCentavos)
                }}</span>
              </div>
              <div v-if="r.original.observacao" class="text-[12px] text-faint">
                {{ r.original.observacao }}
              </div>
              <ul
                v-if="estadoR(r).situacao !== 'gravado' && r.problemas.length"
                class="mt-1.5 flex flex-col gap-1"
              >
                <li
                  v-for="(p, i) in r.problemas"
                  :key="i"
                  class="flex items-start gap-1.5 text-[12.5px]"
                  :class="p.nivel === 'erro' ? 'text-neg' : 'text-ink'"
                >
                  <CircleAlert v-if="p.nivel === 'erro'" :size="14" class="mt-0.5 shrink-0" />
                  <TriangleAlert v-else :size="14" class="mt-0.5 shrink-0 text-warn" />
                  {{ p.texto }}
                </li>
              </ul>
              <div
                v-if="estadoR(r).situacao === 'gravando'"
                class="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted"
              >
                <Loader2 :size="13" class="animate-spin" /> Registrando…
              </div>
              <div
                v-else-if="estadoR(r).situacao === 'gravado'"
                class="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink"
              >
                <CircleCheck :size="14" class="text-pos" /> Registrada
              </div>
              <div
                v-else-if="estadoR(r).situacao === 'erro'"
                class="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-neg"
              >
                <CircleAlert :size="14" class="mt-0.5 shrink-0" /> {{ estadoR(r).mensagem }}
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- lançamentos -->
      <section v-if="preparada.lancamentos.length" class="card overflow-hidden">
        <header class="border-b border-line px-5 py-3.5">
          <h2 class="text-[14px] font-semibold text-ink">Lançamentos</h2>
          <p class="hint">
            Os marcados entram ao registrar. Depois de registrado, o lançamento se edita como
            qualquer outro.
          </p>
        </header>
        <ul class="divide-y divide-line-soft">
          <li
            v-for="l in preparada.lancamentos"
            :key="l.indice"
            class="flex items-start gap-3 px-5 py-3.5"
            :class="!estadoL(l).incluir && estadoL(l).situacao !== 'gravado' && 'opacity-60'"
          >
            <input
              v-model="estadoL(l).incluir"
              type="checkbox"
              class="mt-0.5 size-4 shrink-0"
              :disabled="temErro(l.problemas) || gravando || estadoL(l).situacao === 'gravado'"
              :aria-label="`Registrar ${l.dados.descricao}`"
            />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <div class="min-w-0 text-[13.5px] font-medium text-ink">
                  <span class="tnum text-muted">{{ data(l.dados.dataGasto) }}</span> ·
                  {{ l.dados.descricao }}
                </div>
                <div class="tnum shrink-0 text-[13.5px] font-semibold text-ink">
                  {{ reais(l.dados.valorCentavos) }}
                </div>
              </div>

              <dl class="mt-1 grid gap-x-6 gap-y-0.5 text-[12.5px] sm:grid-cols-2">
                <div class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-faint">Fornecedor</dt>
                  <dd class="min-w-0 truncate text-ink">
                    {{ l.nomes.fornecedor ?? 'Não informado' }}
                    <span v-if="documentoDe(l)" class="tnum text-faint"
                      >· {{ documentoDe(l) }}</span
                    >
                    <span v-if="l.fornecedorNovo" class="badge ml-1">novo</span>
                  </dd>
                </div>
                <div class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-faint">Pagamento</dt>
                  <dd class="min-w-0 truncate text-ink">{{ textoPagamento(l) }}</dd>
                </div>
                <div class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-faint">Categoria</dt>
                  <dd class="min-w-0 truncate text-ink">
                    {{ l.nomes.categoria ?? 'Sem categoria' }}
                  </dd>
                </div>
                <div class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-faint">Empreendimento</dt>
                  <dd class="min-w-0 truncate text-ink">
                    {{ l.nomes.empreendimento ?? 'Sem empreendimento' }}
                  </dd>
                </div>
                <div v-if="l.dados.codigoIdentificacao" class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-faint">Código</dt>
                  <dd class="min-w-0 truncate text-ink">{{ l.dados.codigoIdentificacao }}</dd>
                </div>
              </dl>
              <p v-if="l.dados.observacao" class="mt-1 text-[12px] text-faint">
                {{ l.dados.observacao }}
              </p>

              <div v-if="l.original.comprovantes.length" class="mt-1.5 flex flex-wrap gap-1.5">
                <span
                  v-for="nome in l.original.comprovantes"
                  :key="nome"
                  class="badge max-w-full text-[11.5px] font-normal tracking-normal normal-case"
                  :title="arquivoDo(nome) ? 'Vai junto com o lançamento' : 'Arquivo não enviado'"
                >
                  <Paperclip v-if="arquivoDo(nome)" :size="12" class="shrink-0" />
                  <CircleAlert v-else :size="12" class="shrink-0 text-warn" />
                  <span class="truncate">{{ nome }}</span>
                </span>
              </div>

              <ul
                v-if="estadoL(l).situacao !== 'gravado' && problemasDe(l).length"
                class="mt-1.5 flex flex-col gap-1"
              >
                <li
                  v-for="(p, i) in problemasDe(l)"
                  :key="i"
                  class="flex items-start gap-1.5 text-[12.5px]"
                  :class="p.nivel === 'erro' ? 'text-neg' : 'text-ink'"
                >
                  <CircleAlert v-if="p.nivel === 'erro'" :size="14" class="mt-0.5 shrink-0" />
                  <TriangleAlert v-else :size="14" class="mt-0.5 shrink-0 text-warn" />
                  {{ p.texto }}
                </li>
              </ul>

              <div
                v-if="estadoL(l).situacao === 'gravando'"
                class="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted"
              >
                <Loader2 :size="13" class="animate-spin" /> Registrando…
              </div>
              <div
                v-else-if="estadoL(l).situacao === 'gravado'"
                class="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink"
              >
                <CircleCheck :size="14" class="text-pos" /> Registrado
                <NuxtLink
                  :to="`/lancamentos/${estadoL(l).lancamentoId}`"
                  target="_blank"
                  class="font-medium text-accent-text hover:underline"
                  >#{{ estadoL(l).lancamentoId }}</NuxtLink
                >
              </div>
              <div
                v-else-if="estadoL(l).situacao === 'duplicado'"
                class="mt-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-[12.5px]"
                role="alert"
              >
                <div class="flex items-center gap-1.5 font-medium text-ink">
                  <TriangleAlert :size="14" class="text-warn" /> Possível duplicidade: já existe
                  gasto parecido
                </div>
                <ul class="mt-1.5 flex flex-col gap-1">
                  <li v-for="d in estadoL(l).duplicados" :key="d.id" class="text-muted">
                    <NuxtLink
                      :to="`/lancamentos/${d.id}`"
                      target="_blank"
                      class="font-medium text-accent-text hover:underline"
                      >#{{ d.id }}</NuxtLink
                    >
                    · {{ data(d.dataGasto) }} · {{ reais(d.valorCentavos) }} · {{ d.descricao }}
                  </li>
                </ul>
                <div class="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn btn-sm btn-secondary"
                    :disabled="gravando"
                    @click="registrarMesmoAssim(l)"
                  >
                    Registrar mesmo assim
                  </button>
                  <button type="button" class="btn btn-sm btn-ghost" @click="deixarDeFora(l)">
                    Deixar de fora
                  </button>
                </div>
              </div>
              <div
                v-else-if="estadoL(l).situacao === 'erro'"
                class="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-neg"
              >
                <CircleAlert :size="14" class="mt-0.5 shrink-0" /> {{ estadoL(l).mensagem }}
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- registrar -->
      <div
        class="sticky bottom-0 z-10 -mx-5 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface px-5 py-3 sm:-mx-6 sm:px-6"
      >
        <p v-if="gravados" class="mr-auto flex items-center gap-1.5 text-[12.5px] text-ink">
          <CircleCheck :size="14" class="text-pos" />
          {{ plural(gravados, 'item registrado', 'itens registrados') }}.
          <NuxtLink to="/historico" class="font-medium text-accent-text hover:underline"
            >Ver no Histórico</NuxtLink
          >
        </p>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="
            gravando ||
            preparada.setorId === null ||
            !(lancamentosAGravar.length + recargasAGravar.length)
          "
          @click="registrar"
        >
          <Loader2 v-if="gravando" :size="15" class="animate-spin" />
          {{ textoDoBotao }}
        </button>
      </div>
    </template>

    <div v-else class="skeleton h-40" />
  </div>
</template>
