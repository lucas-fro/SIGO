<script setup lang="ts">
import { ChevronRight, Lock } from 'lucide-vue-next'
import type { LancamentoDetalhe } from '#contracts'
import { useToast } from '~/composables/useToast'

definePageMeta({ title: 'Novo lançamento' })

const router = useRouter()
const { canEdit } = useAuth()
const toast = useToast()

function aoSalvar(lancamento: LancamentoDetalhe) {
  toast.sucesso(`Lançamento #${lancamento.id} registrado`, {
    rotulo: 'Registrar outro',
    to: '/lancamentos/novo',
  })
  // Volta para a lista com o lançamento novo aberto no painel.
  void router.push({ path: '/historico', query: { id: lancamento.id } })
}
</script>

<template>
  <div>
    <PageHeader
      titulo="Novo lançamento"
      subtitulo="Cartão, boleto, Pix ou reembolso: todo gasto entra pelo mesmo formulário."
    >
      <template #migalha>
        <NuxtLink to="/historico" class="hover:text-ink">Histórico</NuxtLink>
        <ChevronRight :size="13" />
        <span class="text-muted">Novo</span>
      </template>
    </PageHeader>

    <div class="px-5 pb-10 sm:px-6">
      <LancamentoForm v-if="canEdit" @salvo="aoSalvar" @cancelar="router.push('/historico')" />
      <EmptyState
        v-else
        :icone="Lock"
        titulo="Seu acesso é só de consulta"
        texto="Para registrar gastos, peça a um administrador o papel de lançamentos no seu setor."
      />
    </div>
  </div>
</template>
