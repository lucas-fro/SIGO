<script setup lang="ts">
import { mesCurto, reais, reaisEixo } from '~/composables/useFormat'

/*
  Gasto por mês em colunas. Uma série só, então a cor não identifica nada: o
  mês em destaque (o escolhido no dashboard) vai no acento e os outros no
  cinza, e só o valor dele é escrito sobre a coluna. O valor de cada mês
  aparece ao passar o mouse (ou com as setas do teclado); clicar numa coluna
  (ou Enter) abre aquele mês. A série inteira está numa tabela escondida para
  leitor de tela.
*/
const props = defineProps<{
  serie: Array<{ mes: string; centavos: number }>
  /** "AAAA-MM" do mês em destaque. */
  destaque: string
}>()
const emit = defineEmits<{ escolher: [mes: string] }>()

/** A coluna sob o mouse ou o cursor do teclado (índice na série). */
const ativo = ref<number | null>(null)
const raiz = ref<HTMLElement | null>(null)
const indiceDestaque = computed(() => {
  const i = props.serie.findIndex((s) => s.mes === props.destaque)
  return i < 0 ? props.serie.length - 1 : i
})

/* O foco pelo clique não pode tirar o cursor da coluna sob o mouse. */
function aoFocar() {
  if (ativo.value === null) ativo.value = indiceDestaque.value
}

/*
  Mudou o mês em destaque (e a janela pode ter andado): com o foco no gráfico,
  o cursor do teclado vai para o mês novo; sem foco, o do mouse volta a valer
  no próximo movimento.
*/
watch(
  () => props.destaque,
  () => {
    ativo.value = document.activeElement === raiz.value ? indiceDestaque.value : null
  },
)

/** Teto "redondo" do eixo (1, 2, 2,5 ou 5 × 10ⁿ), para as linhas de grade caírem em números legíveis. */
function tetoBonito(valor: number): number {
  // Sem gasto nenhum: um eixo de R$ 1 mil (com R$ 1 o rótulo do meio arredondaria para R$ 1 também).
  if (valor <= 0) return 100_000
  const ordem = 10 ** Math.floor(Math.log10(valor))
  const f = valor / ordem
  const passo = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return passo * ordem
}

const teto = computed(() => tetoBonito(Math.max(...props.serie.map((s) => s.centavos), 0)))
const linhas = computed(() => [teto.value, teto.value / 2, 0])
const rotuloMaisLargo = computed(() =>
  linhas.value.map(reaisEixo).reduce((a, b) => (b.length > a.length ? b : a)),
)
const altura = (centavos: number) =>
  `${Math.max((centavos / teto.value) * 100, centavos ? 1.5 : 0)}%`

function escolher(i: number) {
  const s = props.serie[i]
  if (s && s.mes !== props.destaque) emit('escolher', s.mes)
}

function tecla(evento: KeyboardEvent) {
  const n = props.serie.length
  const atual = ativo.value ?? indiceDestaque.value
  if (evento.key === 'ArrowLeft') ativo.value = Math.max(0, atual - 1)
  else if (evento.key === 'ArrowRight') ativo.value = Math.min(n - 1, atual + 1)
  else if (evento.key === 'Enter' || evento.key === ' ') escolher(atual)
  else if (evento.key === 'Escape') ativo.value = null
  else return
  evento.preventDefault()
}
</script>

<template>
  <div
    ref="raiz"
    class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 outline-none"
    tabindex="0"
    role="group"
    aria-label="Gasto por mês. Use as setas para ler cada mês e Enter para abrir um mês."
    @keydown="tecla"
    @focus="aoFocar"
    @blur="ativo = null"
  >
    <!-- eixo: o rótulo invisível dá a largura da coluna ("R$ 12,5 mil" não quebra) -->
    <div class="relative h-52 min-w-10" aria-hidden="true">
      <span class="tnum invisible block text-[11px] whitespace-nowrap">{{ rotuloMaisLargo }}</span>
      <span
        v-for="(v, i) in linhas"
        :key="v"
        class="tnum absolute right-0 -translate-y-1/2 text-[11px] whitespace-nowrap text-faint"
        :style="{ top: `${i * 50}%` }"
        >{{ reaisEixo(v) }}</span
      >
    </div>

    <!-- colunas -->
    <div class="relative h-52">
      <div
        v-for="(v, i) in linhas"
        :key="v"
        class="absolute inset-x-0 border-t border-line-soft"
        :class="i === linhas.length - 1 ? 'border-line' : ''"
        :style="{ top: `${i * 50}%` }"
        aria-hidden="true"
      />
      <div class="absolute inset-0 flex items-end gap-1.5 sm:gap-2">
        <div
          v-for="(s, i) in serie"
          :key="s.mes"
          class="group relative flex h-full flex-1 items-end justify-center"
          :class="s.mes === destaque ? '' : 'cursor-pointer'"
          @pointerenter="ativo = i"
          @pointerleave="ativo = null"
          @click="escolher(i)"
        >
          <span
            v-if="s.mes === destaque && s.centavos"
            class="tnum pointer-events-none absolute mb-1 text-[11px] font-semibold whitespace-nowrap text-ink"
            :class="i === serie.length - 1 ? 'right-0' : i === 0 ? 'left-0' : ''"
            :style="{ bottom: altura(s.centavos) }"
            >{{ reaisEixo(s.centavos) }}</span
          >
          <div
            class="w-full max-w-9 rounded-t-[4px] transition-colors"
            :class="
              s.mes === destaque
                ? ativo === i
                  ? 'bg-accent-hover'
                  : 'bg-dado'
                : ativo === i
                  ? 'bg-muted'
                  : 'bg-dado-neutro'
            "
            :style="{ height: altura(s.centavos) }"
          />
          <div
            v-if="ativo === i"
            class="pointer-events-none absolute bottom-[calc(100%+6px)] z-10 rounded-md bg-ink px-2 py-1 text-[11.5px] whitespace-nowrap text-surface shadow-float"
            :class="
              i > serie.length - 4 ? 'right-0' : i < 3 ? 'left-0' : 'left-1/2 -translate-x-1/2'
            "
          >
            <span class="tnum font-semibold">{{ reais(s.centavos) }}</span>
            <span class="ml-1.5 opacity-70">{{ mesCurto(s.mes) }}</span>
            <div v-if="s.mes !== destaque" class="text-[10.5px] opacity-70">
              Clique para ver o mês
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- meses: no celular, um sim, outro não, contando a partir do destaque (sempre visível) -->
    <div />
    <div class="mt-2 flex gap-1.5 sm:gap-2" aria-hidden="true">
      <span
        v-for="(s, i) in serie"
        :key="s.mes"
        class="flex-1 text-center text-[11px]"
        :class="[
          s.mes === destaque ? 'font-semibold text-ink' : 'text-faint',
          (indiceDestaque - i) % 2 === 0 ? '' : 'max-sm:invisible',
        ]"
        >{{ mesCurto(s.mes).split('/')[0] }}</span
      >
    </div>

    <table class="sr-only">
      <caption>
        Gasto por mês
      </caption>
      <tbody>
        <tr v-for="s in serie" :key="s.mes">
          <th scope="row">{{ mesCurto(s.mes) }}</th>
          <td>{{ reais(s.centavos) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
