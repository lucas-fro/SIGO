<script setup lang="ts">
import { Ban, ChevronRight, Lock, SearchX } from 'lucide-vue-next'
import type { LancamentoDetalhe } from '#contracts'
import { useLancamento } from '~/composables/useLancamentos'
import { useToast } from '~/composables/useToast'

definePageMeta({ title: 'Editar lançamento' })

const route = useRoute()
const router = useRouter()
const { canEdit } = useAuth()
const toast = useToast()

const id = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})

const { data: lancamento, isPending, isError, error } = useLancamento(id)

function aoSalvar(detalhe: LancamentoDetalhe) {
  toast.sucesso(`Alterações do lançamento #${detalhe.id} salvas`)
  void router.push({ path: '/historico', query: { id: detalhe.id } })
}
</script>

<template>
  <div>
    <PageHeader
      :titulo="`Editar lançamento #${id ?? ''}`"
      subtitulo="Toda alteração fica no histórico, com o valor de antes e o de depois."
    >
      <template #migalha>
        <NuxtLink to="/historico" class="hover:text-ink">Histórico</NuxtLink>
        <ChevronRight :size="13" />
        <NuxtLink :to="`/lancamentos/${id}`" class="hover:text-ink">#{{ id }}</NuxtLink>
        <ChevronRight :size="13" />
        <span class="text-muted">Editar</span>
      </template>
    </PageHeader>

    <div class="px-5 pb-10 sm:px-6">
      <EmptyState
        v-if="!canEdit"
        :icone="Lock"
        titulo="Seu acesso é só de consulta"
        texto="Para corrigir lançamentos, peça a um administrador o papel de lançamentos no seu setor."
      />
      <EmptyState
        v-else-if="isError || id === null"
        :icone="SearchX"
        titulo="Lançamento não encontrado"
        :texto="error?.message ?? 'Confira o número no endereço.'"
      />
      <EmptyState
        v-else-if="lancamento?.situacao === 'cancelado'"
        :icone="Ban"
        titulo="Lançamento cancelado"
        texto="Um lançamento cancelado não pode ser editado. Se o gasto existe, registre-o de novo."
      >
        <NuxtLink :to="`/lancamentos/${id}`" class="btn btn-secondary">Ver o lançamento</NuxtLink>
      </EmptyState>
      <LancamentoForm
        v-else-if="lancamento"
        :inicial="lancamento"
        @salvo="aoSalvar"
        @cancelar="router.back()"
      />
      <div v-else-if="isPending" class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div class="card flex flex-col gap-3 p-5">
          <div class="skeleton h-5 w-40" />
          <div class="skeleton h-9 w-full" />
          <div class="skeleton h-9 w-2/3" />
        </div>
      </div>
    </div>
  </div>
</template>
