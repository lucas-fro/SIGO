<script setup lang="ts">
import { ChevronRight, SearchX } from 'lucide-vue-next'
import { useLancamento } from '~/composables/useLancamentos'

definePageMeta({ title: 'Lançamento' })

const route = useRoute()
const id = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})

const { data: lancamento, isPending, isError, error } = useLancamento(id)
</script>

<template>
  <div>
    <PageHeader :titulo="`Lançamento #${id ?? ''}`">
      <template #migalha>
        <NuxtLink to="/historico" class="hover:text-ink">Histórico</NuxtLink>
        <ChevronRight :size="13" />
        <span class="text-muted">#{{ id }}</span>
      </template>
    </PageHeader>

    <div class="px-5 pb-10 sm:px-6">
      <div class="card max-w-3xl overflow-hidden">
        <LancamentoDetalhe v-if="lancamento" :lancamento="lancamento" />
        <EmptyState
          v-else-if="isError || id === null"
          :icone="SearchX"
          titulo="Lançamento não encontrado"
          :texto="error?.message ?? 'Confira o número no endereço.'"
        >
          <NuxtLink to="/historico" class="btn btn-secondary">Voltar para o histórico</NuxtLink>
        </EmptyState>
        <div v-else-if="isPending" class="flex flex-col gap-3 p-5">
          <div class="skeleton h-5 w-24" />
          <div class="skeleton h-5 w-2/3" />
          <div class="skeleton h-4 w-1/3" />
          <div class="skeleton mt-2 h-8 w-40" />
        </div>
      </div>
    </div>
  </div>
</template>
