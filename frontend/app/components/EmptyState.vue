<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ icone: Component; titulo: string; texto?: string }>()
</script>

<template>
  <div class="flex flex-col items-center px-6 py-14 text-center">
    <span class="flex size-11 items-center justify-center rounded-full bg-sunken text-faint">
      <component :is="icone" :size="20" />
    </span>
    <h3 class="mt-3 text-[14px] font-semibold text-ink">{{ titulo }}</h3>
    <p v-if="texto" class="mt-1 max-w-sm text-[13px] text-muted">{{ texto }}</p>
    <div v-if="$slots.default" class="mt-4 flex flex-wrap justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
