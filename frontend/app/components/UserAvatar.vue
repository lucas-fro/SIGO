<script setup lang="ts">
const props = withDefaults(defineProps<{ nome: string; size?: number }>(), { size: 28 })

/** Iniciais do primeiro e do último nome: "Maria Clara Souza" → "MS". */
const iniciais = computed(() => {
  const partes = props.nome.trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  const primeira = partes[0]![0] ?? ''
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
})
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-text ring-1 ring-accent-line"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }"
    :title="nome"
    aria-hidden="true"
  >
    {{ iniciais }}
  </span>
</template>
