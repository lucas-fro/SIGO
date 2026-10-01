# SIGO — Sistema Integrado de Gestão Orçamentária

Registro e acompanhamento de gastos por setor da Smart. O Marketing é o primeiro
setor: cartão, boleto, Pix e reembolso entram pelo mesmo formulário, com
parcelas, pagamento e histórico.

- **Dashboard** (`/`): gasto do mês (e o mesmo mês no Sienge, ao lado) e do ano, em
  aberto, gasto por mês, por categoria e por empreendimento, orçamento de cada cartão e o
  que vence nos próximos 30 dias.
  O seletor no topo (ou um clique no gráfico) troca o mês, que fica na URL
  (`/?mes=AAAA-MM`); em aberto, "vence em 7 dias" e "a pagar" são sempre de hoje.
- **Histórico** (`/historico`): todos os lançamentos, com filtros, busca,
  exportação CSV e o detalhe num painel lateral (com os comprovantes para ver e baixar).
  O clipe marca quem tem comprovante e "Sem comprovante" mostra quem falta.
- **Novo lançamento**: o comprovante (PDF, JPG ou PNG) sobe primeiro e, com a chave da
  IA configurada, é lido e preenche o formulário; a pessoa confere e salva.
- **Cadastros**: listas do formulário, **cartões** (orçamento do mês, fatura e
  gastos fixos, com o botão que lança os fixos do mês) e, para o admin, **Leitura por
  IA** (a API, o modelo e a chave que leem os comprovantes; OpenAI por padrão).

| Camada | Tecnologia |
| --- | --- |
| Frontend | Nuxt 4 (SPA), Vue 3, Tailwind CSS 4, TanStack Query, zod |
| Backend | NestJS 12, TypeScript 6, zod, Drizzle ORM (Postgres) |
| Banco | Postgres 16 em produção (o da VPS); qualquer 16+ em desenvolvimento |

## Estrutura

```
backend/
  src/contracts/     esquemas zod e tipos da API — compartilhados com o frontend
  src/db/            schema Drizzle, migrations, seed e dados de exemplo
  src/auth/          login por cookie assinado, papéis, CLI de usuários
  src/cadastros/     listas (categorias, formas, empreendimentos, campanhas, fornecedores) e cartões
  src/lancamentos/   lançamentos, parcelas, histórico, indicadores, lançar gastos fixos
  src/painel/        dados do dashboard (categorias, empreendimentos, cartões, a pagar)
  src/anexos/        comprovantes (disco, ver/baixar) e leitura por IA (OpenAI ou Claude)
  src/configuracoes/ configuração da leitura por IA feita pelo admin (chave cifrada no banco)
  src/sienge/        cópia dos títulos do Sienge e conferência de pagamentos
  drizzle/           migrations geradas (SQL)
frontend/
  app/pages/         dashboard (index), historico, lancamentos/novo, editar, cadastros, login
  app/components/    formulário, painel de detalhe, indicadores, etiquetas...
  app/assets/css/    tokens do visual (cores, raios, sombras) — claro e escuro
deploy/              trecho do Caddyfile para a VPS
```

**Contratos compartilhados.** O frontend importa `backend/src/contracts` pelo
alias `#contracts`. O mesmo esquema zod valida o formulário no navegador e a
requisição na API, então a regra não tem como divergir. Por isso essa pasta só
pode importar `zod` — nada de Nest, Drizzle ou Vue.

## Rodando em desenvolvimento

Pré-requisitos: Node 24 e um Postgres acessível.

```bash
# backend (API em http://localhost:3340/api)
cd backend
cp .env.example .env        # ajuste DATABASE_URL e a senha do admin
npm install
npm run db:create           # cria o banco se não existir
npm run db:migrate
npm run db:seed             # listas iniciais do Marketing
npm run usuarios -- seed-admin
npm run db:exemplo          # opcional: um ano de gastos de exemplo
npm run dev

# frontend (http://localhost:3040), em outro terminal
cd frontend
npm install
npm run dev
```

Entre com o e-mail e a senha de `ADMIN_EMAIL`/`ADMIN_PASSWORD` do `backend/.env`.

### Scripts úteis

| Onde | Comando | O que faz |
| --- | --- | --- |
| backend | `npm test` | testes (Vitest) das regras compartilhadas |
| backend | `npm run typecheck` | checagem de tipos |
| backend | `npm run db:generate` | gera migration a partir do `src/db/schema.ts` |
| backend | `npm run db:studio` | Drizzle Studio para olhar o banco |
| backend | `npm run usuarios -- listar` | usuários (ver `src/auth/cli.ts` para os demais comandos) |
| frontend | `npm run typecheck` | checagem de tipos (inclui os contratos) |
| frontend | `npm run build` | gera a SPA estática em `.output/public` |

## Regras do domínio

- **Dinheiro em centavos** (`bigint` no banco, inteiro na API). Nada de ponto flutuante.
- **Três datas**: data do gasto (decide o mês nos totais), vencimento e pagamento (por parcela).
- **Nada se apaga.** Lançamento é cancelado com motivo; cadastro é desativado.
  Toda criação, edição, pagamento e cancelamento vai para `eventos`, com antes e depois.
- **Soma das parcelas = valor total**, conferido no contrato.
- **Só descrição e valor são obrigatórios.** Categoria, forma de pagamento,
  empreendimento, fornecedor, campanha e cartão podem ficar em branco e ser completados
  depois; data do gasto em branco vale hoje. No dashboard, o que ficou sem categoria ou
  empreendimento aparece como "Sem categoria"/"Sem empreendimento".
- **Aviso de duplicidade**: mesmo fornecedor com mesmo código, ou mesmo valor em até
  7 dias (sem fornecedor, compara com os outros sem fornecedor). A API responde 409 com
  os candidatos; a pessoa confirma e grava.
- **Cartões.** Com forma de pagamento de cartão, o lançamento pode dizer qual cartão
  (opcional; com um cartão só, ele já vem escolhido). Com fechamento e vencimento da
  fatura, o vencimento da compra sai da fatura (compra no dia do fechamento ou depois
  cai na fatura seguinte). Cartão sem fatura (pré-pago) lança o gasto fixo já pago.
  Orçamento do mês = lançado + fixos ainda não lançados.
- **Gastos fixos** viram lançamento pelo botão "Lançar gastos fixos", um por mês
  (repetir não duplica).
- **Permissão = papel + setor.** `admin` vê e altera tudo; `editor` lança nos
  setores dele; `leitor` só consulta. Setor novo é uma linha em `setores`.
- **Sienge (só leitura).** O quadro "No Sienge em <mês>" soma os títulos a pagar
  emitidos no mês que caem nos centros de custo do setor: os que têm no nome o trecho de
  `setores.sienge_centro_custo` ("MARKETING" pega os "<EMPREENDIMENTO> - MARKETING").
  Título rateado entra só com o percentual desses centros; "em inclusão" fica de fora; no
  mês corrente, vai até hoje, como o gasto do SIGO. O SIGO guarda uma cópia (`sienge_*`)
  e só busca o Sienge quando alguém olha um mês cuja cópia venceu (30 min para o mês
  corrente e o anterior, um dia para os outros), em segundo plano e dentro do teto
  `SIENGE_RATE_LIMIT_PER_MINUTE`, porque o limite do Sienge é dividido com o Painel
  Sienge. A primeira leitura de um mês faz uma requisição por título (a apropriação).
- **Conferência de pagamentos com o Sienge** (00h e 12h de São Paulo, ou "Conferir
  agora" no Histórico, só admin). Olha os lançamentos ativos com parcela em aberto, fora
  do cartão (compra no cartão é paga pela fatura). Primeiro casa com o título a pagar,
  por provas: CNPJ/CPF ou nome do fornecedor, número da nota, valor (ou até 15% menor,
  por imposto retido, com o mesmo número), vencimento, quantidade de parcelas, emissão
  perto da data do gasto e empreendimento (o centro de custo "<EMPREENDIMENTO> -
  MARKETING" do nome dele). Número, valor ou empreendimento que se contradizem vetam o
  título. Com CNPJ, os candidatos são os títulos do credor numa janela de emissão; sem
  CNPJ, os títulos do setor na cópia do Sienge. Casa quando um conjunto de provas fortes
  fecha e nenhum outro título empata no número, no empreendimento, no vencimento exato e
  no centro de custo do setor: a mesma agência emite notas de mesmo valor e dia, uma por
  empreendimento. Título que ainda não está na cópia não perde nem é vetado por falta de
  informação. Empate, ou dois lançamentos querendo o mesmo título, não casa (aparece
  como pendência). O vínculo e as provas ficam em `lancamentos.sienge_titulo_id` e
  `sienge_provas`; editar fornecedor, valor, código, parcelas, empreendimento, data do
  gasto ou setor solta o vínculo e o lançamento volta a ser procurado. Depois, parcela "Totalmente paga" lá é
  paga aqui, com a data do extrato de contas (`/accounts-statements`). Sem pagamento no
  extrato já lido, a baixa pode ter sido sem dinheiro (substituição, renegociação): não
  marca e aparece como pendência; só marca, com o vencimento de lá como data aproximada,
  quando venceu antes do período já lido do extrato. Quem assina no histórico é o
  usuário "Sienge (automático)", que não entra no sistema. Se uma pessoa desfaz um
  pagamento que a conferência marcou (no detalhe ou na edição), a conferência daquele
  lançamento fica pausada. Lançamento cancelado solta o título. A edição manda a versão
  que abriu: se a conferência mudou o lançamento nesse meio tempo, o salvar é recusado
  em vez de desfazer o pagamento.
- **Comprovantes.** Ficam em `COMPROVANTES_DIR` (no servidor, `dados/comprovantes` do
  projeto), com nome gerado; o banco guarda nome original, tipo e hash (o mesmo arquivo
  em dois lançamentos gera aviso). O tipo é conferido pelo conteúdo, não pela extensão.
  Ver e baixar passam pela API, que confere o setor. Rascunho (arquivo enviado e
  lançamento não salvo) some depois de um dia; comprovante de lançamento só sai da lista,
  com registro no histórico.

## Deploy

Ver [DEPLOY.md](DEPLOY.md).
