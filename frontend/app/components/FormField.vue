<script setup lang="ts">
defineProps<{
  rotulo: string
  /** Id do campo, para o rótulo focá-lo ao ser clicado. */
  para?: string
  erro?: string
  dica?: string
  opcional?: boolean
}>()
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1.5">
    <label :for="para" class="label">
      {{ rotulo }}
      <span v-if="opcional" class="font-normal text-faint">(opcional)</span>
    </label>
    <slot />
    <p v-if="erro" class="error-text">{{ erro }}</p>
    <p v-else-if="dica" class="hint">{{ dica }}</p>
  </div>
</template>
