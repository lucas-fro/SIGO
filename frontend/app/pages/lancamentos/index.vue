<script setup lang="ts">
// A lista mudou para /historico; links e favoritos antigos continuam funcionando.
definePageMeta({ redirect: (to) => ({ path: '/historico', query: to.query }) })
</script>

<template>
  <div />
</template>
