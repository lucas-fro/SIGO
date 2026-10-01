<script setup lang="ts">
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-vue-next'
import type { OrcamentoCartao } from '#contracts'
import { reais } from '~/composables/useFormat'

/*
  Medidor do orçamento de um cartão no mês. No cartão de recarga avulsa, o
  trilho é o disponível no mês: saldo de antes mais as recargas do mês.

  O trilho é o orçamento. O primeiro trecho é o que já foi lançado; o
  segundo, os gastos fixos que ainda não viraram lançamento (vão cair, então
  já contam). A cor do lançado carrega a situação — acento, âmbar a partir
  de 80%, vermelho quando estoura — e a situação também vem escrita, com ícone.
  Num mês encerrado, o que restou "sobrou" e o fixo que ficou de fora "não foi
  lançado".
*/
const props = defineProps<{ cartao: OrcamentoCartao; encerrado?: boolean }>()

const avulsa = computed(() => props.cartao.recarga === 'avulsa')
const comprometido = computed(
  () => props.cartao.lancadoCentavos + props.cartao.fixosPendentesCentavos,
)
const disponivel = computed(() => props.cartao.orcamentoCentavos - comprometido.value)
const uso = computed(() =>
  props.cartao.orcamentoCentavos ? comprometido.value / props.cartao.orcamentoCentavos : 0,
)

const situacao = computed(() => {
  if (!props.cartao.orcamentoCentavos) return 'sem' as const
  if (uso.value > 1) return 'estourou' as const
  if (uso.value >= 0.8) return 'atencao' as const
  return 'ok' as const
})

/* Estourado, a escala passa a ser o comprometido, e uma marca mostra onde estava o limite. */
const escala = computed(() => Math.max(props.cartao.orcamentoCentavos, comprometido.value, 1))
const largura = (centavos: number) => `${(centavos / escala.value) * 100}%`
const marcaLimite = computed(() =>
  situacao.value === 'estourou' ? largura(props.cartao.orcamentoCentavos) : null,
)

const corLancado = computed(
  () => ({ ok: 'bg-dado', sem: 'bg-dado', atencao: 'bg-warn', estourou: 'bg-neg' })[situacao.value],
)
</script>

<template>
  <div>
    <!-- O nome tem a linha inteira; os valores vêm logo abaixo da barra. -->
    <div class="flex items-baseline justify-between gap-3">
      <div class="min-w-0 truncate text-[13.5px] font-medium text-ink">
        {{ cartao.nome }}
        <span v-if="cartao.final" class="tnum ml-1 text-[12px] font-normal text-faint"
          >•••• {{ cartao.final }}</span
        >
      </div>
      <span v-if="cartao.orcamentoCentavos" class="tnum shrink-0 text-[12px] text-faint">{{
        uso.toLocaleString('pt-BR', { style: 'percent', maximumFractionDigits: 0 })
      }}</span>
    </div>

    <div class="relative mt-2 flex h-2.5 overflow-hidden rounded-full bg-trilho" aria-hidden="true">
      <div
        class="h-full shrink-0"
        :class="[corLancado, cartao.fixosPendentesCentavos ? 'border-r-2 border-surface' : '']"
        :style="{ width: largura(cartao.lancadoCentavos) }"
      />
      <div
        v-if="cartao.fixosPendentesCentavos"
        class="h-full shrink-0 bg-dado-2"
        :style="{ width: largura(cartao.fixosPendentesCentavos) }"
      />
      <div
        v-if="marcaLimite"
        class="absolute inset-y-0 w-0.5 bg-ink"
        :style="{ left: marcaLimite }"
      />
    </div>

    <div class="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px]">
      <span class="text-muted">
        <span class="tnum font-semibold text-ink">{{ reais(comprometido) }}</span>
        <template v-if="cartao.orcamentoCentavos">
          de <span class="tnum">{{ reais(cartao.orcamentoCentavos) }}</span
          ><template v-if="avulsa"> disponível</template>
        </template>
      </span>
      <span v-if="situacao === 'sem'" class="text-faint">{{
        avulsa ? 'Sem saldo nem recarga' : 'Sem orçamento definido'
      }}</span>
      <span
        v-else-if="situacao === 'estourou'"
        class="flex items-center gap-1 font-medium text-neg"
      >
        <CircleAlert :size="13" /> Acima em <span class="tnum">{{ reais(-disponivel) }}</span>
      </span>
      <span
        v-else-if="situacao === 'atencao'"
        class="flex items-center gap-1 font-medium text-warn"
      >
        <TriangleAlert :size="13" /> {{ encerrado ? 'Sobrou' : 'Restam' }}
        <span class="tnum">{{ reais(disponivel) }}</span>
      </span>
      <span v-else class="flex items-center gap-1 text-muted">
        <CircleCheck :size="13" class="text-pos" /> {{ encerrado ? 'Sobrou' : 'Disponível' }}
        <span class="tnum font-medium text-ink">{{ reais(disponivel) }}</span>
      </span>
    </div>
    <div v-if="avulsa" class="mt-0.5 text-[11.5px] text-faint">
      Saldo anterior <span class="tnum">{{ reais(cartao.saldoAnteriorCentavos) }}</span> · recargas
      no mês <span class="tnum">{{ reais(cartao.recarregadoCentavos) }}</span>
    </div>
    <div class="mt-0.5 text-[11.5px] text-faint">
      Lançado <span class="tnum">{{ reais(cartao.lancadoCentavos) }}</span>
      <template v-if="cartao.fixosPendentes">
        · {{ encerrado ? 'fixos não lançados' : 'fixos a lançar' }}
        <span class="tnum">{{ reais(cartao.fixosPendentesCentavos) }}</span> ({{
          cartao.fixosPendentes
        }})
      </template>
    </div>
  </div>
</template>
