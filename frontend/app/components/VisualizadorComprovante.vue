<script setup lang="ts">
import { Download, ExternalLink } from 'lucide-vue-next'
import type { Anexo } from '#contracts'
import { useApi } from '~/composables/useApi'
import { tamanhoArquivo } from '~/composables/useFormat'

/*
  Mostra um comprovante sem sair do sistema: PDF no leitor do próprio
  navegador, foto como imagem. O arquivo vem direto da API (o cookie de
  sessão vai junto), que confere se a pessoa enxerga o lançamento.
  No celular o leitor de PDF embutido costuma não abrir: por isso o
  "Abrir em outra aba" fica sempre à mão.
*/
const props = defineProps<{ anexo: Anexo | null }>()
const emit = defineEmits<{ fechar: [] }>()

const api = useApi()
const endereco = computed(() => (props.anexo ? api.url(`/anexos/${props.anexo.id}/arquivo`) : ''))
const ehPdf = computed(() => props.anexo?.tipo === 'application/pdf')
</script>

<template>
  <ModalDialog
    :open="!!anexo"
    :titulo="anexo?.nome ?? ''"
    :descricao="
      anexo ? `${ehPdf ? 'PDF' : 'Imagem'} · ${tamanhoArquivo(anexo.tamanho)}` : undefined
    "
    largura="960px"
    @fechar="emit('fechar')"
  >
    <template v-if="anexo">
      <iframe
        v-if="ehPdf"
        :key="anexo.id"
        :src="endereco"
        :title="anexo.nome"
        class="h-[68vh] w-full rounded-md border border-line bg-surface-alt"
      />
      <div
        v-else
        class="flex max-h-[68vh] justify-center overflow-auto rounded-md border border-line bg-surface-alt"
      >
        <img :src="endereco" :alt="anexo.nome" class="max-w-full object-contain" />
      </div>
    </template>
    <template #rodape>
      <a v-if="anexo" :href="endereco" target="_blank" rel="noopener" class="btn btn-ghost mr-auto">
        <ExternalLink :size="15" /> Abrir em outra aba
      </a>
      <button type="button" class="btn btn-secondary" @click="emit('fechar')">Fechar</button>
      <a v-if="anexo" :href="`${endereco}?baixar=1`" class="btn btn-primary" download>
        <Download :size="15" /> Baixar
      </a>
    </template>
  </ModalDialog>
</template>
