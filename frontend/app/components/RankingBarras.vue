<script setup lang="ts">
import { reais } from '~/composables/useFormat'

/*
  Para onde foi o gasto: uma linha por item, com o valor e a fatia do total
  escritos. A barra mostra a fatia; o número é que se lê. Depois de `limite`
  itens, o resto vira "Outros" — lista longa de barrinhas não se compara. O
  gasto sem classificação (id null, "Sem categoria") fica no cinza, como "Outros".
*/
const props = withDefaults(
  defineProps<{
    itens: Array<{ id: number | null; nome: string; centavos: number }>
    limite?: number
    vazio?: string
  }>(),
  { limite: 6, vazio: 'Nenhum gasto neste mês.' },
)

const total = computed(() => props.itens.reduce((t, i) => t + i.centavos, 0))

const linhas = computed(() => {
  if (props.itens.length <= props.limite) return props.itens
  const principais = props.itens.slice(0, props.limite - 1)
  const resto = props.itens.slice(props.limite - 1)
  return [
    ...principais,
    {
      id: -1,
      nome: `Outros (${resto.length})`,
      centavos: resto.reduce((t, i) => t + i.centavos, 0),
    },
  ]
})

const fatia = (centavos: number) => (total.value ? centavos / total.value : 0)
const pct = (centavos: number) =>
  fatia(centavos).toLocaleString('pt-BR', { style: 'percent', maximumFractionDigits: 0 })
</script>

<template>
  <p v-if="!itens.length" class="py-6 text-center text-[13px] text-faint">{{ vazio }}</p>
  <ul v-else class="flex flex-col gap-3.5">
    <li v-for="item in linhas" :key="item.id ?? 'sem'">
      <div class="flex items-baseline justify-between gap-3 text-[13px]">
        <span class="min-w-0 truncate" :class="item.id === null ? 'text-muted' : 'text-ink'">{{
          item.nome
        }}</span>
        <span class="shrink-0 whitespace-nowrap">
          <span class="tnum font-medium text-ink">{{ reais(item.centavos) }}</span>
          <span class="tnum ml-2 inline-block w-9 text-right text-[12px] text-faint">{{
            pct(item.centavos)
          }}</span>
        </span>
      </div>
      <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-trilho" aria-hidden="true">
        <div
          class="h-full rounded-full"
          :class="item.id === -1 || item.id === null ? 'bg-dado-neutro' : 'bg-dado'"
          :style="{ width: `${Math.max(fatia(item.centavos) * 100, 1)}%` }"
        />
      </div>
    </li>
  </ul>
</template>
