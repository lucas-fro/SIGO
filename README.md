# SIGO — Sistema Integrado de Gestão Orçamentária

Registro e acompanhamento de gastos por setor da Smart. O Marketing é o primeiro
setor: cartão, boleto, Pix e reembolso entram pelo mesmo formulário, com
parcelas, pagamento e histórico, e a lista mostra os indicadores do mês.

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
  src/cadastros/     listas: categorias, formas de pagamento, empreendimentos, campanhas, fornecedores
  src/lancamentos/   lançamentos, parcelas, histórico, indicadores
  drizzle/           migrations geradas (SQL)
frontend/
  app/pages/         lancamentos (lista + painel), novo, editar, cadastros, login
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
- **Aviso de duplicidade**: mesmo fornecedor com mesmo código, ou mesmo valor em até
  7 dias. A API responde 409 com os candidatos; a pessoa confirma e grava.
- **Permissão = papel + setor.** `admin` vê e altera tudo; `editor` lança nos
  setores dele; `leitor` só consulta. Setor novo é uma linha em `setores`.

## Deploy

Ver [DEPLOY.md](DEPLOY.md).
