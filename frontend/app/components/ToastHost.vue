<script setup lang="ts">
import { CircleAlert, CircleCheck, X } from 'lucide-vue-next'
import { useAvisos, useToast } from '~/composables/useToast'

const avisos = useAvisos()
const { remover } = useToast()
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex flex-col items-center gap-2 px-4"
    aria-live="polite"
  >
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-for="aviso in avisos"
        :key="aviso.id"
        class="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl bg-ink py-2 pr-2 pl-3.5 text-[13px] text-surface shadow-float"
        :role="aviso.tom === 'erro' ? 'alert' : 'status'"
      >
        <CircleCheck v-if="aviso.tom === 'ok'" :size="16" class="shrink-0 text-pos" />
        <CircleAlert v-else :size="16" class="shrink-0 text-neg" />
        <span class="min-w-0">{{ aviso.texto }}</span>
        <NuxtLink
          v-if="aviso.acao"
          :to="aviso.acao.to"
          class="shrink-0 rounded-md px-2 py-1 font-semibold text-surface underline-offset-2 hover:underline"
          @click="remover(aviso.id)"
          >{{ aviso.acao.rotulo }}</NuxtLink
        >
        <button
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded-md opacity-60 hover:opacity-100"
          aria-label="Fechar aviso"
          @click="remover(aviso.id)"
        >
          <X :size="15" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
