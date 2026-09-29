# SIGO — instruções para agentes

Sistema de gestão orçamentária da Smart (construtora/incorporadora). Monorepo simples:
`backend/` (NestJS 12 + Drizzle + Postgres) e `frontend/` (Nuxt 4 SPA + Tailwind 4 +
TanStack Query), cada um com o próprio `package.json`. Idioma do domínio, da interface e
dos comentários: português do Brasil.

## Comandos

- Backend: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`,
  `npm run db:generate` (depois de mudar `src/db/schema.ts`), `npm run db:migrate`.
- Frontend: `npm run dev` (porta 3040), `npm run typecheck`, `npm run build`.
- Portas de desenvolvimento: API 3340, front 3040 (o Painel Sienge usa 3333/3000).

## Regras que não se quebram

- `backend/src/contracts/` é compartilhado com o front (alias `#contracts`): só pode
  importar `zod` e arquivos da própria pasta. Toda validação de entrada nasce ali e é
  usada nos dois lados (`zodDto(schema)` no Nest; `schema.safeParse` no formulário).
- Dinheiro sempre em centavos inteiros; datas de calendário como texto `AAAA-MM-DD`;
  "hoje" é o dia em São Paulo (`hoje()` dos contratos), nunca o `current_date` do banco.
- Nada é apagado: lançamento é cancelado com motivo, cadastro é desativado. Toda mudança
  num lançamento grava uma linha em `eventos` (criado, editado com antes/depois, pagamento,
  cancelamento).
- Permissão = papel (`admin`/`editor`/`leitor`) + setor. A guarda global exige sessão;
  as checagens de setor ficam nos serviços (`common/acesso.ts`, `escopoDeSetor`).
- Lançamento: só descrição e valor são obrigatórios. Categoria, forma de pagamento,
  empreendimento, fornecedor, campanha e cartão são opcionais (null); data do gasto vazia
  vale `hoje()`. Tudo que lista ou soma lançamentos usa `leftJoin` nesses cadastros, e o
  dashboard mostra o que ficou em branco como "Sem categoria"/"Sem empreendimento".
- Cartão (opcional): se informado, precisa de uma forma `cartao = true` e ser da mesma
  forma e setor; vencimento da compra = `vencimentoDaFatura` (contratos). Gasto fixo só
  vira lançamento por `POST /lancamentos/lancar-fixos` (idempotente por mês, com advisory lock).
- Campanha é detalhe secundário: fica no formulário, no detalhe (quando informada) e na
  exportação, não em filtros, colunas ou gráficos.
- Migrations: nunca editar SQL já aplicado; gerar outra com `db:generate`. Manter
  compatível com Postgres 16 (produção).
- `src/db/schema.ts` só importa valores de `drizzle-orm`; dos contratos, apenas `import type`
  (o drizzle-kit carrega o arquivo sozinho).

## Visual

Tokens em `frontend/app/assets/css/main.css` (claro e escuro). Acento laranja `#cf4a0f`
só para ação principal e seleção; cor de situação (verde/vermelho/âmbar) sempre com ícone
e texto. Componentes-base: `.card`, `.input`, `.btn-*`, `.badge`, `.tabs/.tab`, `.table`,
`StatTile`, `GraficoMensal`, `RankingBarras`, `OrcamentoCartao`, `SidePanel`,
`ModalDialog` (pilha: Esc fecha só o de cima). Cores de gráfico: tokens `dado`, `dado-2`,
`dado-neutro` e `trilho`, conferidos no validador de paleta. Texto de valor nunca na cor do dado.
- Vue + Prettier sem ponto e vírgula: handler com dois comandos em linhas separadas quebra o
  template. Use uma função nomeada no `@click`.
