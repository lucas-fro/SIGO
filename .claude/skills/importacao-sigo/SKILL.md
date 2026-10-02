---
name: importacao-sigo
description: Monta o pacote de importação do SIGO (importacao.json + comprovantes) a partir de notas fiscais, boletos, faturas, recibos, comprovantes de Pix, prints do extrato do cartão e fotos de cupom. Use SEMPRE que o usuário mandar esses documentos para entrar no SIGO ("faz o json", "importa isso", "lança no SIGO", "joga no sistema", "o cartão desse mês"), enquanto a leitura por IA não está ligada no sistema. Não é para o Termo de Aprovação (isso é a skill termo-aprovacao).
---

# Pacote de importação do SIGO

Temporário: existe até a leitura por IA ir ao ar no SIGO. Os documentos são lidos
aqui no chat e viram um pacote que o usuário arrasta inteiro para **SIGO → Cadastros → Importar**.
Lá ele confere linha a linha e registra. O formato oficial, com todas as regras de
validação, está em `backend/src/contracts/importacao.ts`.

## O que entregar

1. Uma pasta `E:\Projetos\SIGO\importacoes\AAAA-MM-DD <assunto>\`. A pasta é ignorada
   pelo git, porque guarda documentos reais. Exemplos de assunto: `boleto Grafica Exemplo NF 123`,
   `cartao 7730 setembro`.
2. Dentro dela, o `importacao.json` (UTF-8, indentado) e uma cópia de cada comprovante
   com nome limpo: `AAAA-MM-DD <fornecedor curto> <valor>.<ext>`, por exemplo
   `2026-09-17 Auto Posto Exemplo 70,00.jpg`. O campo `comprovantes` de cada lançamento usa
   exatamente esses nomes.
3. Conferir antes de entregar e só entregar quando aparecer "Formato ok":

   ```bash
   npm --prefix E:/Projetos/SIGO/backend run importacao:conferir -- "E:/Projetos/SIGO/importacoes/<pasta>/importacao.json"
   ```

4. No chat, entregar:
   - o caminho da pasta;
   - uma tabela curta do que vai entrar (data, descrição, valor, forma);
   - os avisos;
   - a instrução: "arraste todos os arquivos da pasta em SIGO → Cadastros → Importar".

## Lendo os documentos

- **PDF.** O Read não renderiza PDF nesta máquina (falta o pdftoppm). Use
  `pdftotext -layout "<arquivo>" -` no Git Bash. Se o texto sair embaralhado (fonte
  embutida, comum em NFS-e), renderize a página para PNG com pymupdf e leia a imagem:
  `python -c "import pymupdf; d=pymupdf.open(r'<pdf>'); d[0].get_pixmap(dpi=150).save(r'<png>')"`.
- **Imagem colada no chat.** O caminho vem na mensagem (`[Image: source: ...\images\N.jpg]`).
  Copie de lá para a pasta do pacote.
- **Tipo de arquivo.** O SIGO aceita PDF, JPG ou PNG, até 15 MB e até 10 comprovantes por
  lançamento. HEIC precisa virar JPG antes.

## O arquivo

```json
{
  "formato": "sigo-importacao/1",
  "titulo": "Cartão 7730 — setembro de 2026",
  "setor": null,
  "saldoExtrato": { "cartao": "7730", "centavos": 123456, "em": "2026-09-30" },
  "recargas": [
    { "cartao": "7730", "data": "2026-09-05", "valorCentavos": 300000, "observacao": "Transferência de entrada" }
  ],
  "lancamentos": [
    {
      "descricao": "Gasolina",
      "valorCentavos": 7000,
      "dataGasto": "2026-09-17",
      "fornecedor": { "nome": "AUTO POSTO EXEMPLO LTDA", "documento": "11.222.333/0001-81" },
      "codigoIdentificacao": "NFC-e 123456",
      "categoria": "Outros",
      "empreendimento": null,
      "formaPagamento": null,
      "cartao": "7730",
      "vencimento": null,
      "pagoEm": "2026-09-17",
      "parcelas": null,
      "observacao": null,
      "comprovantes": ["2026-09-17 Auto Posto Exemplo 70,00.jpg"],
      "avisos": ["Combustível ainda não tem categoria própria: ficou em Outros"]
    }
  ]
}
```

- **Valores e datas.** Dinheiro sempre em centavos inteiros (R$ 1.234,56 = 123456).
  Datas no formato `AAAA-MM-DD`. Campo sem informação fica `null`.
- **Cadastros pelo nome.** Categoria, empreendimento e forma de pagamento vão pelo nome
  exato do SIGO. O cartão vai pelos 4 últimos dígitos. A aba Importar acha o cadastro sem
  ligar para acento ou maiúscula, e também por parte do nome, desde que só um sirva.
  - Cadastro não encontrado fica em branco, com aviso.
  - Cartão não encontrado é erro, e a linha fica de fora.
- **Nomes do SIGO.** Use a lista que o usuário copia no botão **Copiar cadastros** da
  aba Importar. Se ela não estiver na conversa, peça. Até lá, use os nomes do seed:
  - categorias: Mídia digital, Mídia off-line, Gráfica e impressos, Stand de vendas,
    Eventos e ações, Brindes, Criação e produção, Ferramentas e assinaturas, Outros;
  - formas: Cartão de crédito, Cartão pré-pago, Boleto, Pix, Transferência bancária,
    Dinheiro, Reembolso a colaborador.
- **Parcela única ou várias.** À vista usa `vencimento` e `pagoEm`. Parcelado usa
  `parcelas: [{ "valorCentavos", "vencimento", "pagoEm" }]`, e a soma tem que dar o
  valor. Nunca os dois juntos.

## Regras de preenchimento

São as mesmas da leitura por IA (`backend/src/anexos/instrucoes-leitura.ts`) e do Termo de
Aprovação.

- **Um gasto, um lançamento.** NF e boleto do mesmo gasto são um lançamento só, com os dois
  comprovantes. Comece pela NF, que diz o que foi contratado.
- **Fornecedor.** É o emitente da nota ou o beneficiário do boleto, nunca o
  tomador/pagador (a Smart ou a SPE).
  - Boleto de processadora (dLocal, EBANX, Pagar.me, PagSeguro, Stripe): o fornecedor é a
    processadora, e o serviço real (Meta Ads, Google Ads) vai na descrição.
  - O `documento` é o CNPJ/CPF que aparece no documento.
  - Sem documento, use sempre o mesmo nome curto: "Google", "OpenAI", "Mercado Livre",
    "Amazon".
- **Descrição.** O que foi comprado ou contratado, numa frase curta. Número de contrato e
  outras referências entram aqui, por exemplo "Revisão de imagens – contrato 77".
- **Código de identificação: um número só.**
  - Use o número da nota ("NFS-e 123", "NFC-e 123456").
  - Sem nota, use o número do documento ou recibo.
  - Nunca use a linha digitável, o nosso número ou dois números juntos. A conferência com
    o Sienge junta os dígitos do campo, e um número errado impede que o pagamento seja
    reconhecido.
- **Data do gasto.** Emissão da nota. Boleto sem nota: data do documento. Cartão e Pix:
  dia da compra ou do pagamento.
- **Boleto.** `formaPagamento: "Boleto"`, com o `vencimento` do boleto e o valor do boleto.
  Quando a nota tem imposto retido, use o valor bruto da nota e explique na `observacao`:
  "ISS retido pelo tomador: R$ 51,36 (líquido ao prestador: R$ 1.148,64)".
- **Já pago.** Use `pagoEm` só quando o documento prova o pagamento: comprovante de Pix ou
  transferência, recibo quitado.
- **Cartão.** Informe `cartao` com os 4 últimos dígitos; a forma vem do cartão.
  - Cartão sem fatura (pré-pago, recarga avulsa): a compra já sai paga, então
    `pagoEm` = dia da compra.
  - Cartão com fatura: deixe `vencimento` e `pagoEm` nulos, e o SIGO calcula a fatura.
- **Empreendimento.** Só quando o documento cita o empreendimento pelo nome ou o usuário
  diz qual é. Nunca deduza pelo endereço ou pela conta de anúncio. Quando ele vier do
  nome da SPE tomadora, diga isso num aviso.
- **Categoria.** Escolha pelo tipo de gasto, usando as descrições das categorias. Na
  dúvida, deixe `null` e explique num aviso.
- **Avisos.** Frases curtas sobre o que o usuário precisa conferir: categoria sugerida,
  documento que falta, valor que não fecha. Nunca invente: o que não está no documento
  fica `null`, com um aviso.

### Extrato do cartão

- **Débitos e créditos.** Cada débito vira um lançamento no cartão. Crédito (transferência
  de entrada, recarga) vira `recargas`.
- **IOF.** Compra no exterior aparece com uma segunda linha do mesmo estabelecimento, no
  mesmo horário, de cerca de 3,5% do valor. É o IOF: some ao valor da compra e explique
  na observação ("R$ 300,00 + IOF R$ 10,50").
- **"Pagamento de contas".** É um boleto pago com o saldo do cartão: o lançamento fica no
  cartão. O fornecedor é o beneficiário, que aparece no detalhe do app; peça o print se
  não tiver.
- **Cupons.** Case cada foto com a linha do extrato pela data, hora e valor. Linha sem
  cupom fica sem comprovante, com aviso. Não anexe o print do extrato como comprovante: o
  filtro "Sem comprovante" do Histórico serve para cobrar o que falta.
- **Saldo.** Informe `saldoExtrato` com o "Saldo atual" do app e a data. A aba Importar mostra
  se o saldo do cartão no SIGO bate com o do extrato depois de importar.
- **Conta antes de entregar.** A recarga menos os débitos lançados tem que dar o saldo do
  app (fora o que já estava no SIGO).
