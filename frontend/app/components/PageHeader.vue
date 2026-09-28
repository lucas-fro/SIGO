<script setup lang="ts">
defineProps<{
  titulo: string
  /** Número ao lado do título, em cinza (ex.: total de lançamentos no filtro). */
  contagem?: number | null
  subtitulo?: string
}>()
</script>

<template>
  <header
    class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 pt-5 pb-4 sm:px-6"
  >
    <div class="min-w-0">
      <div v-if="$slots.migalha" class="mb-1 flex items-center gap-1 text-[12.5px] text-faint">
        <slot name="migalha" />
      </div>
      <h1 class="flex items-baseline gap-2 text-[20px] font-semibold tracking-[-0.015em] text-ink">
        <span class="truncate">{{ titulo }}</span>
        <span
          v-if="contagem !== undefined && contagem !== null"
          class="tnum text-[15px] font-medium text-faint"
          >{{ contagem.toLocaleString('pt-BR') }}</span
        >
      </h1>
      <p v-if="subtitulo" class="mt-0.5 text-[13px] text-muted">{{ subtitulo }}</p>
    </div>
    <div v-if="$slots.acoes" class="flex flex-wrap items-center gap-2">
      <slot name="acoes" />
    </div>
  </header>
</template>
