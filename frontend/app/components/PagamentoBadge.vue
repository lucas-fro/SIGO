<script setup lang="ts">
import { Ban, CircleAlert, CircleCheck, CircleDashed, Clock } from 'lucide-vue-next'
import type { SituacaoPagamento } from '#contracts'

/*
  Situação de pagamento. A moldura e o texto são neutros; a cor fica só no
  ícone. Cada situação tem ícone próprio, então a leitura não depende de
  distinguir verde de vermelho.
*/
const props = defineProps<{ situacao: SituacaoPagamento | 'cancelado' }>()

const MAPA = {
  pago: { rotulo: 'Pago', icone: CircleCheck, cor: 'text-pos' },
  parcial: { rotulo: 'Parcial', icone: CircleDashed, cor: 'text-warn' },
  em_aberto: { rotulo: 'Em aberto', icone: Clock, cor: 'text-faint' },
  vencido: { rotulo: 'Vencido', icone: CircleAlert, cor: 'text-neg' },
  cancelado: { rotulo: 'Cancelado', icone: Ban, cor: 'text-faint' },
} as const

const info = computed(() => MAPA[props.situacao])
</script>

<template>
  <span class="badge">
    <component :is="info.icone" :size="12" :stroke-width="2.5" :class="info.cor" />
    {{ info.rotulo }}
  </span>
</template>
