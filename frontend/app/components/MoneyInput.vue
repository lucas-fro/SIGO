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
    />
  </div>
</template>
