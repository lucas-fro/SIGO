<script setup lang="ts">
import {
  Ban,
  CalendarCheck,
  Download,
  FileText,
  Image as ImagemIcone,
  Loader2,
  Paperclip,
  Pencil,
  Trash2,
  Undo2,
} from 'lucide-vue-next'
import {
  EXTENSOES_ANEXO,
  ROTULO_PROVA_SIENGE,
  TAMANHO_MAXIMO_ANEXO,
  cancelarLancamentoSchema,
  formatarDocumento,
  hoje,
  type Alteracao,
  type Anexo,
  type AnexoEnviado,
  type Evento,
  type LancamentoDetalhe,
  type Parcela,
  type ParcelaInput,
  type ProvaSienge,
  type SituacaoPagamento,
  type VinculoLancamentoSienge,
} from '#contracts'
import { ApiError, useApi } from '~/composables/useApi'
import { data, dataHora, reais, tamanhoArquivo } from '~/composables/useFormat'
import { useSincronizarLancamento } from '~/composables/useLancamentos'
import { useToast } from '~/composables/useToast'

/*
  Conteúdo do detalhe de um lançamento: o mesmo no painel lateral da lista e
  na página própria. As ações (pagar, editar, cancelar) atualizam o cache na
  hora com o que a API devolve. Os comprovantes (boleto, nota, recibo) ficam
  numa aba própria, com ver, baixar, anexar e tirar da lista.
*/
const props = defineProps<{ lancamento: LancamentoDetalhe }>()

const { canEdit } = useAuth()
const api = useApi()
const sincronizar = useSincronizarLancamento()
const toast = useToast()

const l = computed(() => props.lancamento)

/** Ordem de leitura das provas: as que identificam o documento primeiro. */
const ORDEM_PROVAS: ProvaSienge[] = [
  'numero',
  'fornecedor',
  'nomeFornecedor',
  'valor',
  'retencao',
  'vencimento',
  'vencimentoProximo',
  'empreendimento',
  'parcelas',
  'emissao',
]

/** "achado por número da nota, CNPJ/CPF do fornecedor e valor". O centro de custo do setor fica de fora: todo título do setor tem. */
function comoAchado(s: VinculoLancamentoSienge): string {
  if (!s.provas) {
    return s.vinculo === 'numero'
      ? 'achado pelo número do documento'
      : 'achado por valor e vencimento'
  }
  const itens = ORDEM_PROVAS.filter((p) => s.provas!.includes(p)).map((p) => ROTULO_PROVA_SIENGE[p])
  const lista =
    itens.length > 1 ? `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}` : (itens[0] ?? '')
  return `achado por ${lista}`
}

const ativo = computed(() => l.value.situacao === 'ativo')
const podeAlterar = computed(() => canEdit.value && ativo.value)
const emAberto = computed(() => l.value.parcelas.filter((p) => !p.pagoEm))

type Aba = 'detalhes' | 'parcelas' | 'comprovantes' | 'historico'
const aba = ref<Aba>('detalhes')
watch(
  () => props.lancamento.id,
  () => {
    aba.value = 'detalhes'
  },
)

const resumoPagamento = computed(() => {
  if (!ativo.value) return 'Fora dos totais desde o cancelamento'
  const p = l.value.pagamento
  if (p.situacao === 'pago') {
    const ultima = [...l.value.parcelas]
      .map((x) => x.pagoEm ?? '')
      .sort()
      .pop()
    return `Pago${ultima ? ` em ${data(ultima)}` : ''}`
  }
  const partes = [`Em aberto: ${reais(p.emAbertoCentavos)}`]
  if (p.proximoVencimento) partes.push(`próximo vencimento ${data(p.proximoVencimento)}`)
  return partes.join(' · ')
})

function situacaoParcela(p: Parcela): SituacaoPagamento {
  if (p.pagoEm) return 'pago'
  return p.vencimento < hoje() ? 'vencido' : 'em_aberto'
}

// ---------- pagamento ----------

const modalPagamento = ref(false)
const parcelaEscolhida = ref<number | null>(null)
const dataPagamento = ref(hoje())
const erroModal = ref<string | null>(null)
const salvando = ref(false)

function abrirPagamento(parcelaId?: number) {
  parcelaEscolhida.value = parcelaId ?? emAberto.value[0]?.id ?? null
  dataPagamento.value = hoje()
  erroModal.value = null
  modalPagamento.value = true
}

async function alterarPagamento(parcelaId: number, pagoEm: string | null): Promise<boolean> {
  salvando.value = true
  erroModal.value = null
  try {
    const detalhe = await api.patch<LancamentoDetalhe>(
      `/lancamentos/${l.value.id}/parcelas/${parcelaId}`,
      { pagoEm },
    )
    sincronizar(detalhe)
    return true
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    erroModal.value = e.issues[0]?.message ?? e.message
    if (!modalPagamento.value) toast.erro(erroModal.value)
    return false
  } finally {
    salvando.value = false
  }
}

async function registrarPagamento() {
  if (parcelaEscolhida.value === null) return
  if (!dataPagamento.value) {
    erroModal.value = 'Informe a data do pagamento'
    return
  }
  const numero = l.value.parcelas.find((p) => p.id === parcelaEscolhida.value)?.numero
  if (await alterarPagamento(parcelaEscolhida.value, dataPagamento.value)) {
    modalPagamento.value = false
    toast.sucesso(
      l.value.parcelas.length > 1
        ? `Pagamento da parcela ${numero} registrado`
        : 'Pagamento registrado',
    )
  }
}

async function desfazerPagamento(p: Parcela) {
  if (await alterarPagamento(p.id, null)) toast.sucesso(`Pagamento da parcela ${p.numero} desfeito`)
}

// ---------- cancelamento ----------

const modalCancelar = ref(false)
const motivo = ref('')

function abrirCancelar() {
  motivo.value = ''
  erroModal.value = null
  modalCancelar.value = true
}

async function cancelar() {
  const r = cancelarLancamentoSchema.safeParse({ motivo: motivo.value })
  if (!r.success) {
    erroModal.value = r.error.issues[0]?.message ?? 'Motivo inválido'
    return
  }
  salvando.value = true
  erroModal.value = null
  try {
    const detalhe = await api.post<LancamentoDetalhe>(`/lancamentos/${l.value.id}/cancelar`, r.data)
    sincronizar(detalhe)
    modalCancelar.value = false
    toast.sucesso(`Lançamento #${detalhe.id} cancelado`)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    erroModal.value = e.issues[0]?.message ?? e.message
  } finally {
    salvando.value = false
  }
}

// ---------- comprovantes ----------

const vendo = ref<Anexo | null>(null)
const seletor = ref<HTMLInputElement | null>(null)
const enviando = ref(false)
const removendo = ref<Anexo | null>(null)

function escolherArquivo() {
  seletor.value?.click()
}

/** Recarrega o detalhe depois de mexer nos comprovantes (a lista e o histórico mudam juntos). */
async function recarregar() {
  sincronizar(await api.get<LancamentoDetalhe>(`/lancamentos/${l.value.id}`))
}

async function aoEscolherArquivo(evento: Event) {
  const campo = evento.target as HTMLInputElement
  const arquivo = campo.files?.[0]
  campo.value = ''
  if (!arquivo) return
  if (arquivo.size > TAMANHO_MAXIMO_ANEXO) {
    toast.erro('O arquivo passa de 15 MB')
    return
  }
  const dados = new FormData()
  dados.append('arquivo', arquivo)
  dados.append('lancamentoId', String(l.value.id))
  enviando.value = true
  try {
    const enviado = await api.enviar<AnexoEnviado>('/anexos', dados)
    await recarregar()
    if (enviado.duplicadoDe) {
      toast.erro(
        `Este arquivo também é comprovante do lançamento #${enviado.duplicadoDe.lancamentoId}`,
      )
    } else {
      toast.sucesso('Comprovante anexado')
    }
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    toast.erro(e.message)
  } finally {
    enviando.value = false
  }
}

async function removerComprovante() {
  const alvo = removendo.value
  if (!alvo) return
  salvando.value = true
  try {
    await api.delete(`/anexos/${alvo.id}`)
    await recarregar()
    removendo.value = null
    toast.sucesso('Comprovante tirado da lista')
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    toast.erro(e.message)
  } finally {
    salvando.value = false
  }
}

// ---------- histórico ----------

function frase(e: Evento): string {
  switch (e.tipo) {
    case 'criado':
      return e.dados?.origem === 'gasto_fixo'
        ? 'lançou este gasto fixo do cartão'
        : 'registrou o lançamento'
    case 'editado':
      return 'editou o lançamento'
    case 'cancelado':
      return 'cancelou o lançamento'
    case 'pagamento_registrado':
      return e.dados?.origem === 'sienge'
        ? `conferiu no Sienge o pagamento da parcela ${e.dados?.parcela ?? ''}, feito em ${data(e.dados?.pagoEm)}${e.dados?.dataAproximada ? ' (data aproximada: a baixa não apareceu no extrato)' : ''}${e.dados?.tituloSienge ? `, título ${e.dados.tituloSienge}` : ''}`
        : `registrou o pagamento da parcela ${e.dados?.parcela ?? ''} em ${data(e.dados?.pagoEm)}`
    case 'pagamento_desfeito':
      return `desfez o pagamento da parcela ${e.dados?.parcela ?? ''}`
    case 'anexo_adicionado':
      return `anexou o comprovante ${e.dados?.anexo ?? ''}`
    case 'anexo_removido':
      return `tirou da lista o comprovante ${e.dados?.anexo ?? ''}`
  }
}

function valorAlterado(a: Alteracao, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (a.campo === 'valorCentavos') return reais(Number(valor))
  if (a.campo === 'dataGasto') return data(String(valor))
  if (a.campo === 'parcelas' && Array.isArray(valor)) {
    const lista = valor as ParcelaInput[]
    const soma = lista.reduce((t, p) => t + p.valorCentavos, 0)
    const pagas = lista.filter((p) => p.pagoEm).length
    return `${lista.length}× · ${reais(soma)}${pagas ? ` · ${pagas} paga(s)` : ''}`
  }
  return String(valor)
}
</script>

<template>
  <div class="flex flex-col">
    <!-- topo -->
    <div class="px-5 pt-5 pb-4">
      <div class="flex flex-wrap items-center gap-2">
        <PagamentoBadge :situacao="ativo ? l.pagamento.situacao : 'cancelado'" />
        <span class="badge">#{{ l.id }}</span>
      </div>

      <h3
        class="mt-3 text-[16px] leading-snug font-semibold text-ink"
        :class="!ativo && 'line-through decoration-ghost'"
      >
        {{ l.descricao }}
      </h3>
      <p v-if="l.fornecedor" class="mt-0.5 text-[13px] text-muted">
        {{ l.fornecedor.nome }}
        <span v-if="l.fornecedor.documento" class="tnum text-faint">
          · {{ formatarDocumento(l.fornecedor.documento) }}
        </span>
      </p>

      <div class="mt-4 text-[28px] leading-none font-semibold tracking-[-0.02em] text-ink">
        {{ reais(l.valorCentavos) }}
      </div>
      <p class="mt-1.5 text-[12.5px] text-faint">{{ resumoPagamento }}</p>

      <div v-if="podeAlterar" class="mt-4 flex flex-wrap gap-2">
        <button
          v-if="emAberto.length"
          type="button"
          class="btn btn-sm btn-primary"
          @click="abrirPagamento()"
        >
          <CalendarCheck :size="15" /> Registrar pagamento
        </button>
        <NuxtLink :to="`/lancamentos/${l.id}/editar`" class="btn btn-sm btn-secondary">
          <Pencil :size="14" /> Editar
        </NuxtLink>
        <button type="button" class="btn btn-sm btn-ghost !text-neg" @click="abrirCancelar">
          <Ban :size="14" /> Cancelar
        </button>
      </div>

      <div
        v-if="l.cancelamento"
        class="mt-4 rounded-lg border border-neg/20 bg-neg-soft px-3.5 py-3 text-[12.5px] text-ink"
      >
        <div class="font-medium">
          Cancelado por {{ l.cancelamento.por.nome }} em {{ dataHora(l.cancelamento.em) }}
        </div>
        <div class="mt-0.5 text-muted">“{{ l.cancelamento.motivo }}”</div>
      </div>
    </div>

    <!-- abas -->
    <div class="px-5">
      <div class="tabs" role="tablist" aria-label="Seções do lançamento">
        <button
          type="button"
          role="tab"
          class="tab"
          :aria-selected="aba === 'detalhes'"
          @click="aba = 'detalhes'"
        >
          Detalhes
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          :aria-selected="aba === 'parcelas'"
          @click="aba = 'parcelas'"
        >
          Parcelas <span class="count">{{ l.parcelas.length }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          :aria-selected="aba === 'comprovantes'"
          @click="aba = 'comprovantes'"
        >
          Comprovantes <span class="count">{{ l.anexos.length }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          :aria-selected="aba === 'historico'"
          @click="aba = 'historico'"
        >
          Histórico <span class="count">{{ l.eventos.length }}</span>
        </button>
      </div>
    </div>

    <!-- detalhes -->
    <dl v-if="aba === 'detalhes'" class="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-5 text-[13px]">
      <div>
        <dt class="eyebrow">Data do gasto</dt>
        <dd class="tnum mt-1 text-ink">{{ data(l.dataGasto) }}</dd>
      </div>
      <div>
        <dt class="eyebrow">Forma de pagamento</dt>
        <dd class="mt-1 text-ink">
          {{ l.formaPagamento?.nome ?? '—' }}
          <span v-if="l.cartao" class="block text-[12px] text-faint">{{ l.cartao.nome }}</span>
        </dd>
      </div>
      <div>
        <dt class="eyebrow">Categoria</dt>
        <dd class="mt-1 text-ink">{{ l.categoria?.nome ?? '—' }}</dd>
      </div>
      <div>
        <dt class="eyebrow">Empreendimento</dt>
        <dd class="mt-1 text-ink">{{ l.empreendimento?.nome ?? '—' }}</dd>
      </div>
      <!-- Campanha é detalhe secundário: só aparece quando foi informada. -->
      <div v-if="l.campanha">
        <dt class="eyebrow">Campanha</dt>
        <dd class="mt-1 text-ink">{{ l.campanha.nome }}</dd>
      </div>
      <div>
        <dt class="eyebrow">Código de identificação</dt>
        <dd class="mt-1 break-all text-ink">{{ l.codigoIdentificacao ?? '—' }}</dd>
      </div>
      <div v-if="l.sienge">
        <dt class="eyebrow">Título no Sienge</dt>
        <dd class="tnum mt-1 text-ink">
          {{ l.sienge.tituloId }}
          <span class="block text-[12px] text-faint">{{ comoAchado(l.sienge) }}</span>
          <span v-if="l.sienge.pausadoEm" class="block text-[12px] text-faint">
            conferência automática pausada: um pagamento marcado pelo Sienge foi desfeito à mão
          </span>
        </dd>
      </div>
      <div>
        <dt class="eyebrow">Setor</dt>
        <dd class="mt-1 text-ink">{{ l.setor.nome }}</dd>
      </div>
      <div>
        <dt class="eyebrow">Registrado por</dt>
        <dd class="mt-1 text-ink">
          {{ l.criadoPor.nome }}
          <span class="block text-[12px] text-faint">{{ dataHora(l.criadoEm) }}</span>
        </dd>
      </div>
      <div v-if="l.observacao" class="col-span-2">
        <dt class="eyebrow">Observação</dt>
        <dd class="mt-1 whitespace-pre-line text-ink">{{ l.observacao }}</dd>
      </div>
    </dl>

    <!-- parcelas -->
    <ul v-else-if="aba === 'parcelas'" class="divide-y divide-line-soft py-1">
      <li v-for="p in l.parcelas" :key="p.id" class="flex items-center gap-3 px-5 py-3">
        <span
          class="tnum flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-[12px] font-semibold text-muted"
          >{{ p.numero }}</span
        >
        <div class="min-w-0 flex-1">
          <div class="tnum text-[13.5px] font-medium text-ink">{{ reais(p.valorCentavos) }}</div>
          <div class="tnum text-[12px] text-faint">
            vence {{ data(p.vencimento)
            }}<template v-if="p.pagoEm"> · pago em {{ data(p.pagoEm) }}</template>
          </div>
        </div>
        <PagamentoBadge :situacao="situacaoParcela(p)" />
        <template v-if="podeAlterar">
          <button
            v-if="!p.pagoEm"
            type="button"
            class="btn btn-sm btn-secondary"
            @click="abrirPagamento(p.id)"
          >
            Pagar
          </button>
          <button
            v-else
            type="button"
            class="btn-icon"
            title="Desfazer pagamento"
            :aria-label="`Desfazer pagamento da parcela ${p.numero}`"
            :disabled="salvando"
            @click="desfazerPagamento(p)"
          >
            <Undo2 :size="15" />
          </button>
        </template>
      </li>
    </ul>

    <!-- comprovantes -->
    <div v-else-if="aba === 'comprovantes'" class="py-1">
      <div v-if="podeAlterar" class="flex flex-wrap items-center gap-2 px-5 pt-4 pb-2">
        <input
          ref="seletor"
          type="file"
          class="hidden"
          :accept="EXTENSOES_ANEXO"
          @change="aoEscolherArquivo"
        />
        <button
          type="button"
          class="btn btn-sm btn-secondary"
          :disabled="enviando"
          @click="escolherArquivo"
        >
          <Loader2 v-if="enviando" :size="14" class="animate-spin" />
          <Paperclip v-else :size="14" />
          Anexar comprovante
        </button>
        <span class="text-[12px] text-faint">PDF, JPG ou PNG, até 15 MB</span>
      </div>

      <p v-if="!l.anexos.length" class="px-5 py-6 text-[13px] text-muted">
        Nenhum comprovante. Anexe o boleto, a nota ou o recibo deste gasto.
      </p>
      <ul v-else class="divide-y divide-line-soft">
        <li v-for="a in l.anexos" :key="a.id" class="flex items-center gap-3 px-5 py-3">
          <FileText v-if="a.tipo === 'application/pdf'" :size="18" class="shrink-0 text-faint" />
          <ImagemIcone v-else :size="18" class="shrink-0 text-faint" />
          <div class="min-w-0 flex-1">
            <button
              type="button"
              class="block max-w-full truncate text-left text-[13.5px] font-medium text-ink hover:underline"
              :title="a.nome"
              @click="vendo = a"
            >
              {{ a.nome }}
            </button>
            <div class="text-[12px] text-faint">
              {{ tamanhoArquivo(a.tamanho) }} · {{ a.enviadoPor.nome }}, {{ dataHora(a.enviadoEm) }}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" @click="vendo = a">Ver</button>
          <a
            :href="api.url(`/anexos/${a.id}/arquivo?baixar=1`)"
            class="btn-icon"
            title="Baixar"
            :aria-label="`Baixar ${a.nome}`"
            download
          >
            <Download :size="15" />
          </a>
          <button
            v-if="podeAlterar"
            type="button"
            class="btn-icon"
            title="Tirar da lista"
            :aria-label="`Tirar ${a.nome} da lista`"
            @click="removendo = a"
          >
            <Trash2 :size="15" />
          </button>
        </li>
      </ul>
    </div>

    <!-- histórico -->
    <ol v-else class="flex flex-col px-5 py-5">
      <li v-for="(e, i) in l.eventos" :key="e.id" class="relative flex gap-3 pb-5 last:pb-0">
        <span
          v-if="i < l.eventos.length - 1"
          class="absolute top-8 bottom-0 left-[13.5px] w-px bg-line"
          aria-hidden="true"
        />
        <UserAvatar :nome="e.usuario.nome" :size="28" />
        <div class="min-w-0 flex-1 pt-0.5 text-[13px]">
          <p class="text-ink">
            <span class="font-medium">{{ e.usuario.nome }}</span>
            <!-- O espaço vai dentro da expressão: entre dois elementos em linhas
                 separadas o Vue descarta o espaço, e o nome grudaria na frase. -->
            <span class="text-muted">{{ ` ${frase(e)}` }}</span>
          </p>
          <p class="text-[11.5px] text-faint">{{ dataHora(e.em) }}</p>

          <ul
            v-if="e.dados?.alteracoes?.length"
            class="mt-2 flex flex-col gap-1.5 rounded-lg border border-line-soft bg-surface-alt px-3 py-2.5 text-[12.5px]"
          >
            <li v-for="a in e.dados.alteracoes" :key="a.campo">
              <span class="text-faint">{{ a.rotulo }}</span>
              <div class="flex flex-wrap items-baseline gap-x-1.5">
                <span class="text-faint line-through">{{ valorAlterado(a, a.de) }}</span>
                <span class="text-ghost">→</span>
                <span class="text-ink">{{ valorAlterado(a, a.para) }}</span>
              </div>
            </li>
          </ul>
          <p
            v-if="e.dados?.motivo"
            class="mt-2 rounded-lg border border-line-soft bg-surface-alt px-3 py-2 text-[12.5px] text-ink"
          >
            “{{ e.dados.motivo }}”
          </p>
        </div>
      </li>
    </ol>

    <ModalDialog
      :open="modalPagamento"
      titulo="Registrar pagamento"
      descricao="A data em que o dinheiro saiu. Para o cartão, a data em que a fatura foi paga."
      @fechar="modalPagamento = false"
    >
      <form
        id="form-pagamento"
        class="flex flex-col gap-4"
        novalidate
        @submit.prevent="registrarPagamento"
      >
        <FormField v-if="emAberto.length > 1" rotulo="Parcela" para="pg-parcela">
          <select id="pg-parcela" v-model="parcelaEscolhida" class="input">
            <option v-for="p in emAberto" :key="p.id" :value="p.id">
              Parcela {{ p.numero }} · {{ reais(p.valorCentavos) }} · vence {{ data(p.vencimento) }}
            </option>
          </select>
        </FormField>
        <FormField rotulo="Data do pagamento" para="pg-data" :erro="erroModal ?? undefined">
          <input
            id="pg-data"
            v-model="dataPagamento"
            type="date"
            class="input tnum"
            :max="hoje()"
            :aria-invalid="!!erroModal || undefined"
          />
        </FormField>
      </form>
      <template #rodape>
        <button type="button" class="btn btn-secondary" @click="modalPagamento = false">
          Voltar
        </button>
        <button type="submit" form="form-pagamento" class="btn btn-primary" :disabled="salvando">
          <Loader2 v-if="salvando" :size="15" class="animate-spin" />
          Registrar pagamento
        </button>
      </template>
    </ModalDialog>

    <VisualizadorComprovante :anexo="vendo" @fechar="vendo = null" />

    <ModalDialog
      :open="!!removendo"
      titulo="Tirar o comprovante da lista?"
      :descricao="`${removendo?.nome ?? ''} deixa de aparecer neste lançamento. O arquivo continua guardado e a remoção fica no histórico.`"
      @fechar="removendo = null"
    >
      <template #rodape>
        <button type="button" class="btn btn-secondary" @click="removendo = null">Voltar</button>
        <button
          type="button"
          class="btn btn-danger"
          :disabled="salvando"
          @click="removerComprovante"
        >
          <Loader2 v-if="salvando" :size="15" class="animate-spin" />
          Tirar da lista
        </button>
      </template>
    </ModalDialog>

    <ModalDialog
      :open="modalCancelar"
      :titulo="`Cancelar o lançamento #${l.id}`"
      descricao="Ele sai dos totais, mas continua consultável, com o motivo no histórico. Não dá para desfazer."
      @fechar="modalCancelar = false"
    >
      <form id="form-cancelar" novalidate @submit.prevent="cancelar">
        <FormField rotulo="Motivo" para="cn-motivo" :erro="erroModal ?? undefined">
          <textarea
            id="cn-motivo"
            v-model="motivo"
            class="input"
            maxlength="500"
            placeholder="Ex.: lançado em duplicidade com o #1042"
            :aria-invalid="!!erroModal || undefined"
          />
        </FormField>
      </form>
      <template #rodape>
        <button type="button" class="btn btn-secondary" @click="modalCancelar = false">
          Voltar
        </button>
        <button type="submit" form="form-cancelar" class="btn btn-danger" :disabled="salvando">
          <Loader2 v-if="salvando" :size="15" class="animate-spin" />
          Cancelar lançamento
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
