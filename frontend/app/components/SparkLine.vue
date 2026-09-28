<script setup lang="ts">
/*
  Minigráfico de tendência, dentro de um indicador.

  A linha fica no tom apagado e só o último trecho (o período atual) no
  acento: o olho vai direto para onde o mês está. O valor de cada ponto
  aparece ao passar o mouse ou ao navegar pelas setas do teclado, e a mesma
  série existe numa tabela escondida para leitor de tela — o gráfico nunca é o
  único caminho até o número.

  O SVG estica na largura (`preserveAspectRatio="none"`), então os pontos são
  desenhados em HTML por cima, para não virarem elipse.
*/
const props = defineProps<{
  valores: number[]
  rotulos: string[]
  formatar: (valor: number) => string
  descricao: string
}>()

const W = 120
const H = 40
const P = 4

const ativo = ref<number | null>(null)
const n = computed(() => props.valores.length)

const pontos = computed(() => {
  const max = Math.max(...props.valores, 1)
  return props.valores.map((v, i) => ({
    x: n.value <= 1 ? W / 2 : P + (i * (W - 2 * P)) / (n.value - 1),
    y: H - P - (v / max) * (H - 2 * P),
  }))
})

const caminho = (lista: Array<{ x: number; y: number }>) =>
  lista.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

const linha = computed(() => caminho(pontos.value))
const area = computed(() => {
  const lista = pontos.value
  if (lista.length < 2) return ''
  return `${caminho(lista)} L${lista[lista.length - 1]!.x},${H} L${lista[0]!.x},${H} Z`
})
const ultimoTrecho = computed(() => caminho(pontos.value.slice(-2)))

const pct = (v: number, total: number) => `${(v / total) * 100}%`
const ultimo = computed(() => pontos.value[pontos.value.length - 1])
const destaque = computed(() => (ativo.value === null ? null : pontos.value[ativo.value]))

const resumo = computed(() => {
  if (!n.value) return props.descricao
  const max = Math.max(...props.valores)
  const iMax = props.valores.indexOf(max)
  const atual = props.valores[n.value - 1] ?? 0
  return `${props.descricao}. Atual (${props.rotulos[n.value - 1]}): ${props.formatar(atual)}. Maior: ${props.rotulos[iMax]}, ${props.formatar(max)}.`
})

function mover(evento: PointerEvent) {
  const alvo = evento.currentTarget as SVGSVGElement
  const caixa = alvo.getBoundingClientRect()
  const x = ((evento.clientX - caixa.left) / caixa.width) * W
  let melhor = 0
  let distancia = Infinity
  pontos.value.forEach((p, i) => {
    const d = Math.abs(p.x - x)
    if (d < distancia) {
      distancia = d
      melhor = i
    }
  })
  ativo.value = melhor
}

function tecla(evento: KeyboardEvent) {
  const atual = ativo.value ?? n.value - 1
  if (evento.key === 'ArrowLeft') ativo.value = Math.max(0, atual - 1)
  else if (evento.key === 'ArrowRight') ativo.value = Math.min(n.value - 1, atual + 1)
  else if (evento.key === 'Escape') ativo.value = null
  else return
  evento.preventDefault()
}
</script>

<template>
  <div class="relative">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      class="block h-full w-full cursor-crosshair overflow-visible"
      tabindex="0"
      role="img"
      :aria-label="resumo"
      @pointermove="mover"
      @pointerleave="ativo = null"
      @focus="ativo = n - 1"
      @blur="ativo = null"
      @keydown="tecla"
    >
      <path v-if="area" :d="area" class="fill-sunken" />
      <path
        :d="linha"
        fill="none"
        class="stroke-ghost"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
      <path
        :d="ultimoTrecho"
        fill="none"
        class="stroke-accent"
        stroke-width="2"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
      <line
        v-if="destaque"
        :x1="destaque.x"
        :x2="destaque.x"
        :y1="0"
        :y2="H"
        class="stroke-line-strong"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <span
      v-if="ultimo"
      class="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
      :style="{ left: pct(ultimo.x, W), top: pct(ultimo.y, H) }"
    />
    <span
      v-if="destaque && ativo !== n - 1"
      class="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-surface"
      :style="{ left: pct(destaque.x, W), top: pct(destaque.y, H) }"
    />

    <div
      v-if="destaque && ativo !== null"
      class="pointer-events-none absolute bottom-[calc(100%+6px)] z-10 rounded-md bg-ink px-2 py-1 text-[11.5px] whitespace-nowrap text-surface shadow-float"
      :class="
        destaque.x / W > 0.6 ? '-translate-x-full' : destaque.x / W < 0.4 ? '' : '-translate-x-1/2'
      "
      :style="{ left: pct(destaque.x, W) }"
    >
      <span class="tnum font-semibold">{{ formatar(valores[ativo] ?? 0) }}</span>
      <span class="ml-1.5 opacity-70">{{ rotulos[ativo] }}</span>
    </div>

    <table class="sr-only">
      <caption>
        {{
          descricao
        }}
      </caption>
      <tbody>
        <tr v-for="(valor, i) in valores" :key="i">
          <th scope="row">{{ rotulos[i] }}</th>
          <td>{{ formatar(valor) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
