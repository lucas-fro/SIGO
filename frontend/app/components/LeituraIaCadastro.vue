<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { AlertTriangle, CheckCircle2, CircleOff, ExternalLink, Loader2 } from 'lucide-vue-next'
import {
  MODELOS_IA,
  PAINEL_CHAVES_IA,
  PROVEDORES_IA,
  ROTULO_PROVEDOR_IA,
  salvarLeituraIaSchema,
  type ConfiguracaoLeituraIa,
  type ProvedorIa,
} from '#contracts'
import { ApiError, useApi, useApiQuery } from '~/composables/useApi'
import { dataHora } from '~/composables/useFormat'
import { useToast } from '~/composables/useToast'

/*
  Aba "Leitura por IA" dos cadastros (só admin): a API, o modelo e a chave
  que leem o comprovante e pré-preenchem o lançamento. A chave nunca volta
  do servidor; a tela só mostra o final dela. Ao salvar, a API confere a
  chave e o modelo antes de guardar.
*/
const api = useApi()
const qc = useQueryClient()
const toast = useToast()
const { data: config, isPending } = useApiQuery<ConfiguracaoLeituraIa>(
  'config-leitura-ia',
  '/configuracoes/leitura-ia',
)

const form = reactive({
  provedor: 'openai' as ProvedorIa,
  modelo: MODELOS_IA.openai[0]!,
  chave: '',
})
const erros = ref<Record<string, string>>({})
const erroGeral = ref<string | null>(null)
const salvando = ref(false)
const removendo = ref(false)

/*
  Modelo: um select com os da lista e "Outro modelo…", que abre um campo para
  digitar qualquer outro da API (a conferência ao salvar diz se ele existe).
*/
const OUTRO = '__outro__'
const outroModelo = ref(false)
const campoOutro = ref<HTMLInputElement | null>(null)
const naLista = (modelo: string) => MODELOS_IA[form.provedor].includes(modelo)
const escolhaModelo = computed({
  get: () => (outroModelo.value || !naLista(form.modelo) ? OUTRO : form.modelo),
  set: (valor: string) => {
    if (valor === OUTRO) {
      outroModelo.value = true
      if (naLista(form.modelo)) form.modelo = ''
      void nextTick(() => campoOutro.value?.focus())
    } else {
      outroModelo.value = false
      form.modelo = valor
    }
  },
})

// Preenche com o que está guardado quando chega (e depois de salvar).
watch(
  config,
  (c) => {
    if (!c?.provedor) return
    form.provedor = c.provedor
    form.modelo = c.modelo ?? MODELOS_IA[c.provedor][0]!
    outroModelo.value = !naLista(form.modelo)
    form.chave = ''
  },
  { immediate: true },
)

/** A chave guardada serve para a API escolhida: dá para salvar sem colar de novo. */
const temChaveGuardada = computed(
  () =>
    !!config.value?.chaveFinal &&
    !config.value.chaveIlegivel &&
    config.value.provedor === form.provedor,
)

function trocarProvedor() {
  outroModelo.value = false
  if (!naLista(form.modelo)) form.modelo = MODELOS_IA[form.provedor][0]!
  erros.value = {}
  erroGeral.value = null
}

async function salvar() {
  erros.value = {}
  erroGeral.value = null
  const r = salvarLeituraIaSchema.safeParse({ ...form })
  if (!r.success) {
    for (const i of r.error.issues) erros.value[i.path.join('.')] ??= i.message
    return
  }
  if (!r.data.chave && !temChaveGuardada.value) {
    erros.value.chave = `Cole a chave da API da ${ROTULO_PROVEDOR_IA[form.provedor]}`
    return
  }
  salvando.value = true
  try {
    const salvo = await api.put<ConfiguracaoLeituraIa>('/configuracoes/leitura-ia', r.data)
    qc.setQueryData(['config-leitura-ia', '/configuracoes/leitura-ia', {}], salvo)
    await qc.invalidateQueries({ queryKey: ['config-leitura-ia'] })
    form.chave = ''
    toast.sucesso('Chave conferida e salva. A leitura por IA está ligada.')
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    if (e.issues.length) erros.value = e.porCampo
    else erroGeral.value = e.message
  } finally {
    salvando.value = false
  }
}

async function remover() {
  if (!confirm('Desligar a leitura por IA e apagar a chave guardada?')) return
  removendo.value = true
  try {
    await api.delete('/configuracoes/leitura-ia')
    await qc.invalidateQueries({ queryKey: ['config-leitura-ia'] })
    form.chave = ''
    toast.sucesso('Leitura por IA desligada')
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    toast.erro(e.message)
  } finally {
    removendo.value = false
  }
}
</script>

<template>
  <div class="max-w-[640px] px-5 py-5 sm:px-6">
    <p class="text-[13px] text-muted">
      Com uma chave de API, o comprovante enviado no lançamento é lido pela IA e o formulário já vem
      preenchido para você revisar. Cada leitura é cobrada pela empresa da IA, na conta dona da
      chave (centavos por documento).
    </p>

    <!-- situação -->
    <div class="mt-4 border-y border-line py-3 text-[13px]">
      <div v-if="isPending" class="skeleton h-3.5 w-64" />
      <template v-else-if="config?.chaveIlegivel">
        <p class="flex items-center gap-2 font-medium text-warn">
          <AlertTriangle :size="15" /> A chave guardada precisa ser cadastrada de novo
        </p>
        <p class="mt-1 text-faint">
          O segredo do servidor mudou depois que ela foi salva. Cole a chave outra vez abaixo.
        </p>
      </template>
      <template v-else-if="config?.ligada">
        <p class="flex items-center gap-2 font-medium text-pos">
          <CheckCircle2 :size="15" /> Ligada
        </p>
        <p class="mt-1 text-muted">
          {{ ROTULO_PROVEDOR_IA[config.provedor!] }} · modelo
          <span class="font-medium text-ink">{{ config.modelo }}</span> · chave terminada em
          <span class="tnum font-medium text-ink">…{{ config.chaveFinal }}</span>
        </p>
        <p v-if="config.atualizadoEm" class="mt-0.5 text-faint">
          Alterada {{ config.atualizadoPor ? `por ${config.atualizadoPor.nome} ` : '' }}em
          {{ dataHora(config.atualizadoEm) }}
        </p>
      </template>
      <p v-else class="flex items-center gap-2 text-muted">
        <CircleOff :size="15" /> Desligada: o comprovante é anexado, mas o formulário é preenchido à
        mão.
      </p>
    </div>

    <form class="mt-5 grid gap-4" novalidate @submit.prevent="salvar">
      <FormField rotulo="API" para="ia-provedor" :erro="erros.provedor">
        <select
          id="ia-provedor"
          v-model="form.provedor"
          class="input"
          :aria-invalid="!!erros.provedor"
          @change="trocarProvedor"
        >
          <option v-for="p in PROVEDORES_IA" :key="p" :value="p">
            {{ ROTULO_PROVEDOR_IA[p] }}
          </option>
        </select>
      </FormField>

      <FormField rotulo="Modelo" para="ia-modelo" :erro="erros.modelo">
        <select
          id="ia-modelo"
          v-model="escolhaModelo"
          class="input"
          :aria-invalid="!!erros.modelo && escolhaModelo !== OUTRO"
        >
          <option v-for="(m, i) in MODELOS_IA[form.provedor]" :key="m" :value="m">
            {{ i === 0 ? `${m} (sugerido)` : m }}
          </option>
          <option :value="OUTRO">Outro modelo…</option>
        </select>
        <input
          v-if="escolhaModelo === OUTRO"
          id="ia-modelo-outro"
          ref="campoOutro"
          v-model="form.modelo"
          class="input"
          maxlength="80"
          autocomplete="off"
          spellcheck="false"
          placeholder="Nome do modelo, como a API escreve"
          aria-label="Nome do modelo"
          :aria-invalid="!!erros.modelo"
        />
      </FormField>

      <FormField rotulo="Chave da API" para="ia-chave" :erro="erros.chave">
        <input
          id="ia-chave"
          v-model="form.chave"
          type="password"
          class="input tnum"
          maxlength="400"
          autocomplete="off"
          spellcheck="false"
          :placeholder="
            temChaveGuardada
              ? `Chave …${config?.chaveFinal} guardada`
              : form.provedor === 'openai'
                ? 'sk-proj-…'
                : 'sk-ant-…'
          "
          :aria-invalid="!!erros.chave"
        />
        <template #dica>
          {{
            temChaveGuardada
              ? 'Em branco, mantém a guardada. Para trocar, crie outra em'
              : 'Crie em'
          }}
          <a
            :href="PAINEL_CHAVES_IA[form.provedor]"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-accent-text hover:underline"
          >
            {{ PAINEL_CHAVES_IA[form.provedor].replace('https://', '') }}
            <ExternalLink :size="12" /></a
          >. A chave fica guardada cifrada no servidor e não aparece de novo nesta tela.
        </template>
      </FormField>

      <p v-if="erroGeral" class="error-text flex items-start gap-1.5">
        <AlertTriangle :size="14" class="mt-0.5 shrink-0" /> {{ erroGeral }}
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" class="btn btn-primary" :disabled="salvando || removendo">
          <Loader2 v-if="salvando" :size="15" class="animate-spin" />
          {{ salvando ? 'Conferindo a chave…' : 'Salvar' }}
        </button>
        <button
          v-if="config?.provedor"
          type="button"
          class="btn btn-ghost"
          :disabled="salvando || removendo"
          @click="remover"
        >
          <Loader2 v-if="removendo" :size="15" class="animate-spin" />
          Desligar e apagar a chave
        </button>
      </div>
    </form>
  </div>
</template>
