<script setup lang="ts">
/*
  Campo de dinheiro em centavos, no estilo caixa registradora: cada dígito
  entra pela direita ("1", "12", "1234" → 0,01 · 0,12 · 12,34). Não há vírgula
  para errar nem ponto para confundir com milhar, e o valor que sai é sempre
  um inteiro em centavos — o formato da API.
*/
const model = defineModel<number | null>({ required: true })
withDefaults(
  defineProps<{ id?: string; invalid?: boolean; disabled?: boolean; compacto?: boolean }>(),
  { compacto: false },
)

const formato = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const texto = computed(() => (model.value === null ? '' : formato.format(model.value / 100)))

/**
 * Colar é diferente de digitar: quem cola "1.500" ou "R$ 1.234,56" copiou um
 * valor pronto, não uma sequência de dígitos da caixa registradora (que daria
 * R$ 15,00). Lê no formato brasileiro (ponto de milhar, vírgula decimal) e, sem
 * vírgula, aceita ponto decimal com 1 ou 2 casas ("1234.5"). O que não for um
 * valor reconhecível segue o caminho normal da digitação.
 */
function centavosColados(texto: string): number | null {
  const limpo = texto.replace(/R\$|\s/g, '')
  let reais: number
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(limpo)) {
    reais = Number(limpo.replace(/\./g, '').replace(',', '.'))
  } else if (/^\d+\.\d{1,2}$/.test(limpo)) {
    reais = Number(limpo)
  } else return null
  const centavos = Math.round(reais * 100)
  return Number.isFinite(centavos) && centavos > 0 && centavos <= 99_999_999_999 ? centavos : null
}

function aoColar(evento: ClipboardEvent) {
  const centavos = centavosColados(evento.clipboardData?.getData('text') ?? '')
  if (centavos === null) return
  evento.preventDefault()
  model.value = centavos
  const alvo = evento.target as HTMLInputElement
  alvo.value = formato.format(centavos / 100)
}

function aoDigitar(evento: Event) {
  const alvo = evento.target as HTMLInputElement
  const digitos = alvo.value
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, 13)
  const valor = digitos ? Number(digitos) : null
  model.value = valor
  // Reescreve na hora, mesmo quando o valor não mudou (uma letra digitada some).
  alvo.value = valor === null ? '' : formato.format(valor / 100)
}
</script>

<template>
  <div class="relative">
    <span
      class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-faint"
      aria-hidden="true"
      >R$</span
    >
    <input
      :id="id"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      class="input tnum pl-9 text-right"
      :class="compacto ? 'input-sm' : ''"
      :value="texto"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
      placeholder="0,00"
      @input="aoDigitar"
      @paste="aoColar"
    />
  </div>
</template>
