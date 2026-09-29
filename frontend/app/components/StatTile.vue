<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-vue-next'

/*
  Indicador: rótulo, valor e, quando existir, a variação contra um período
  nomeado. O valor usa algarismos proporcionais — `tabular-nums` deixa número
  grande com cara de espaçado.
*/
defineProps<{
  rotulo: string
  valor: string
  /** Valor sem abreviação, mostrado ao passar o mouse ("R$ 45.320,18"). */
  valorExato?: string
  legenda?: string
  variacao?: { texto: string; direcao: 'sobe' | 'desce' | 'estavel' } | null
  icone?: Component
  /** Cor do ícone: a situação fica no ícone, o número continua na cor do texto. */
  tom?: 'neg' | 'warn' | 'pos' | 'neutro'
  /** Etiqueta curta ao lado do rótulo, ex.: "hoje" quando a faixa mostra outro mês. */
  marca?: string
  carregando?: boolean
}>()

const CORES = { neg: 'text-neg', warn: 'text-warn', pos: 'text-pos', neutro: 'text-faint' } as const
</script>

<template>
  <div class="flex min-h-[108px] items-stretch justify-between gap-4 bg-surface px-5 py-4 sm:px-6">
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
        <component :is="icone" v-if="icone" :size="14" :class="CORES[tom ?? 'neutro']" />
        <span class="truncate">{{ rotulo }}</span>
        <span v-if="marca" class="badge h-[18px] shrink-0 px-1.5">{{ marca }}</span>
      </div>

      <div v-if="carregando" class="skeleton mt-2.5 h-7 w-28" />
      <div v-else class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          class="text-[24px] leading-none font-semibold tracking-[-0.02em] whitespace-nowrap text-ink"
          :title="valorExato"
          >{{ valor }}</span
        >
        <span
          v-if="variacao"
          class="inline-flex items-center gap-0.5 rounded-md bg-sunken px-1.5 py-0.5 text-[11.5px] font-semibold text-muted"
        >
          <ArrowUpRight v-if="variacao.direcao === 'sobe'" :size="13" />
          <ArrowDownRight v-else-if="variacao.direcao === 'desce'" :size="13" />
          <Minus v-else :size="13" />
          {{ variacao.texto }}
        </span>
      </div>

      <div v-if="legenda && !carregando" class="mt-auto pt-2 text-[12px] text-faint">
        {{ legenda }}
      </div>
    </div>
  </div>
</template>
