import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { importacaoSchema } from '../contracts/importacao.js'

/*
  Confere um arquivo de importação antes de ele ir para a aba Importar (em
  Cadastros): o formato, os totais e se cada comprovante citado está na pasta
  do JSON (é de lá que a pessoa arrasta tudo junto). Temporário, como a
  importação.

  npm run importacao:conferir -- "<caminho do importacao.json>"
*/

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const caminho = process.argv[2]
if (!caminho) {
  console.error('Informe o caminho do arquivo: npm run importacao:conferir -- "<arquivo.json>"')
  process.exit(1)
}

let json: unknown
try {
  // O Bloco de Notas grava UTF-8 com BOM, que o JSON.parse recusa.
  json = JSON.parse(readFileSync(caminho, 'utf8').replace(/^﻿/, ''))
} catch (erro) {
  console.error(`Não foi possível ler o JSON: ${(erro as Error).message}`)
  process.exit(1)
}

const r = importacaoSchema.safeParse(json)
if (!r.success) {
  console.error('Arquivo com problemas:')
  for (const issue of r.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(arquivo)'}: ${issue.message}`)
  }
  process.exit(1)
}

const arquivo = r.data
const pasta = dirname(caminho)
const faltando: string[] = []
const total = (itens: Array<{ valorCentavos: number }>) =>
  itens.reduce((soma, item) => soma + item.valorCentavos, 0)

console.log(arquivo.titulo ?? 'Importação')
if (arquivo.recargas.length) {
  console.log(`\nRecargas: ${arquivo.recargas.length} · ${reais(total(arquivo.recargas))}`)
  for (const recarga of arquivo.recargas) {
    console.log(
      `  ${recarga.data}  ${reais(recarga.valorCentavos).padStart(14)}  cartão ${recarga.cartao}`,
    )
  }
}
console.log(`\nLançamentos: ${arquivo.lancamentos.length} · ${reais(total(arquivo.lancamentos))}`)
for (const l of arquivo.lancamentos) {
  const pagamento = l.cartao ? `cartão ${l.cartao}` : (l.formaPagamento ?? 'sem forma')
  console.log(
    `  ${l.dataGasto ?? 'hoje      '}  ${reais(l.valorCentavos).padStart(14)}  ${l.descricao} · ${pagamento}`,
  )
  for (const nome of l.comprovantes) {
    const existe = existsSync(join(pasta, nome))
    if (!existe) faltando.push(nome)
    console.log(`      ${existe ? 'ok   ' : 'FALTA'} ${nome}`)
  }
  for (const aviso of l.avisos) console.log(`      aviso: ${aviso}`)
}
if (arquivo.saldoExtrato) {
  console.log(
    `\nSaldo do extrato em ${arquivo.saldoExtrato.em}: ${reais(arquivo.saldoExtrato.centavos)} (cartão ${arquivo.saldoExtrato.cartao})`,
  )
}

if (faltando.length) {
  console.error(`\n${faltando.length} comprovante(s) citado(s) e fora da pasta ${pasta}`)
  process.exit(1)
}
console.log('\nFormato ok.')
