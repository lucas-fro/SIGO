<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 32 })
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center rounded-[9px] bg-ink font-bold text-surface"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.5)}px` }"
    aria-hidden="true"
  >
    S
    <span
      class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-canvas bg-accent"
    />
  </span>
</template>
