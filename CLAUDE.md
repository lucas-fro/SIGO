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
- Sienge (só leitura, `src/sienge/`): o limite de 200 req/min é do subdomínio e dividido
  com o Painel Sienge. Nenhuma rota chama o Sienge no caminho da requisição: o
  `SiengeService` lê a cópia `sienge_*` e agenda busca em segundo plano quando ela vence.
  Gasto do setor = título a pagar emitido no mês, pela parte apropriada aos centros de
  custo cujo nome contém `setores.sienge_centro_custo`. As tabelas `sienge_*` são cache
  (podem ser apagadas), a exceção ao "nada é apagado".
- Conferência de pagamentos (`sienge/conferencia.service.ts`, regras puras em
  `casamento.ts`): na dúvida não casa e não marca (marcar pago errado é pior que não
  marcar); sem pagamento no extrato lido, não marca (pode ser baixa sem dinheiro).
  O casamento é por provas: vetos (número de nota, valor ou empreendimento que se
  contradizem), uma âncora de provas fortes e desempate só por número, empreendimento,
  vencimento exato e centro do setor; empate é ambíguo. Com CNPJ, os candidatos são os
  títulos do credor; sem CNPJ, os da cópia do setor, pelo nome do fornecedor e pela nota.
  A mesma agência emite notas iguais por empreendimento: não afrouxe âncora nem desempate.
  Evento automático é do usuário `sienge@sigo.interno` (seed, inativo). Desfazer pagamento
  marcado pelo Sienge pausa o lançamento (`sienge_pausado_em`); editar o que serve de
  prova (fornecedor, valor, código, parcelas, empreendimento, data do gasto, setor) solta
  o vínculo. Informação que falta (título fora da cópia) nunca desempata nem veta. Falha de um fornecedor ou título vai para
  `detalhe.falhas` e a rodada segue. Nada que roda em segundo plano pode lançar promessa
  rejeitada sem `catch`: isso derruba a API.
- Comprovantes (`src/anexos/`): arquivo em `COMPROVANTES_DIR` com nome gerado; tipo pelo
  conteúdo (`tipoPeloConteudo`); ver/baixar só pela API conferindo o setor. Rascunho (sem
  lançamento) é de quem enviou e some em 24 h; comprovante de lançamento sai só da lista
  (`removidoEm`) e o arquivo fica. A leitura por IA só sugere: `montarLeitura` confere
  tudo e nada é gravado no lançamento sem a pessoa salvar. Leitores: `leitor-openai.ts` e
  `leitor-claude.ts`, com instruções e esquema comuns em `instrucoes-leitura.ts`.
- Configuração da IA (`src/configuracoes/`, só admin): API, modelo e chave são cadastrados
  na tela (Cadastros → Leitura por IA), nunca no `.env`. A chave vai cifrada para a tabela
  `configuracoes` (`config/cofre.ts`), é conferida na API antes de salvar e nunca volta
  inteira para a tela nem vai para o log.
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
