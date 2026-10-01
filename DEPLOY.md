# Deploy na VPS

O SIGO sobe em dois containers e reaproveita o Postgres e o Caddy que já rodam
na VPS (SmartInfra): nada de banco novo, nada de proxy novo.

| Container | O que é | Porta interna |
| --- | --- | --- |
| `sigo-backend` | API NestJS | 3340 |
| `sigo-frontend` | Nginx servindo a SPA já compilada | 80 |

Nenhuma porta é publicada no host. Os dois entram na rede externa `web`, que é
por onde o Caddy os alcança e por onde o backend fala com o Postgres.

## Primeiro deploy

```bash
git clone <repositório> sigo && cd sigo
cp .env.example .env
openssl rand -base64 48   # copie o resultado para AUTH_SECRET no .env (obrigatório)
nano .env          # DATABASE_URL aponta para o container `postgres`, não localhost
chmod 600 .env
# Pasta dos comprovantes, do usuário `node` do container (uid 1000). Sem isso o
# Docker cria como root e todo envio de comprovante falha.
mkdir -p dados/comprovantes && sudo chown -R 1000:1000 dados

docker compose build
docker compose up -d
docker compose logs -f backend    # cria o banco, aplica migrations, listas e admin
```

O entrypoint do backend roda, a cada subida e de forma idempotente:
`create-database` → migrations → listas iniciais (só as vazias) → administrador do `.env`.

Confira a saúde antes de mexer no Caddy:

```bash
docker compose ps                                  # os dois (healthy)
docker compose exec backend wget -qO- http://127.0.0.1:3340/health
```

## Caddy

Copie o bloco de [deploy/Caddyfile.exemplo](deploy/Caddyfile.exemplo) para o
Caddyfile da VPS e recarregue:

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Use `handle /api/*`, nunca `handle_path`: o Nest registra as rotas sob `/api`.

## Usuários

O administrador vem do `.env` e tem a senha reaplicada a cada subida (é a forma
de recuperar acesso; a senha de exemplo do `.env.example` não sobe em produção).
Os demais são cadastrados pela linha de comando. A senha entra pela variável
`SENHA`, digitada sem eco: nunca como argumento nem escrita no comando, para não
ficar no histórico do shell nem aparecer no `ps`:

```bash
read -rs SENHA && export SENHA   # digite a senha e Enter (não aparece na tela)

# alguém do Marketing que lança gastos
docker compose exec -e SENHA backend \
  node dist/auth/cli.js criar maria@smart.com.br --nome="Maria Souza" --papel=editor --setores=marketing

# diretoria, só consulta
docker compose exec -e SENHA backend \
  node dist/auth/cli.js criar diretoria@smart.com.br --nome="Diretoria" --papel=leitor --setores=marketing

docker compose exec -e SENHA backend node dist/auth/cli.js senha maria@smart.com.br
unset SENHA

docker compose exec backend node dist/auth/cli.js listar
docker compose exec backend node dist/auth/cli.js desativar maria@smart.com.br
```

Rodar `criar` de novo com o mesmo e-mail atualiza nome, papel e setores (sem
`SENHA`, a senha fica como está). Papel e setores são lidos do banco a cada
requisição: a mudança vale na hora, sem esperar a sessão vencer.

| Papel | Pode |
| --- | --- |
| `admin` | tudo, em todos os setores, incluindo as listas de cadastro |
| `editor` | registrar, corrigir, pagar e cancelar lançamentos; criar campanhas e fornecedores |
| `leitor` | consultar |

## Sessão

Cookie `httpOnly` assinado com o `AUTH_SECRET`, válido por `AUTH_SESSION_DAYS` (7
por padrão), sem tabela de sessões: sobrevive ao restart e ninguém é deslogado quando
sobe código. Sair, trocar a senha ou ser desativado derruba as sessões da pessoa em
todos os aparelhos. Depois de 10 senhas erradas a conta fica bloqueada por 15 minutos (de
qualquer IP); 30 erros saindo do mesmo IP bloqueiam o IP (folgado porque o escritório
inteiro sai pelo mesmo IP público). Escrita vinda de navegador só é aceita com origem
do próprio SIGO (proteção contra requisição forjada a partir de outro serviço do domínio).

## Atualizar depois de mexer no código

As migrations rodam sozinhas na subida: faça o `pg_dump` do banco `sigo` antes.

```bash
git pull
# Só na primeira atualização depois dos comprovantes (não faz mal repetir):
mkdir -p dados/comprovantes && sudo chown -R 1000:1000 dados
# Só na primeira atualização depois do AUTH_SECRET obrigatório: sem ele o backend não
# sobe. Gere (openssl rand -base64 48) e ponha no .env. Todo mundo entra de novo uma vez.
docker compose build
docker compose up -d
```

Antes da primeira atualização de uma instalação antiga, confira que as migrations já
aplicadas estão registradas (senão o backend tenta aplicar tudo de novo e não sobe):
`select created_at from drizzle.__drizzle_migrations order by created_at` precisa listar
as que já rodaram.

Se a pasta estiver sem permissão, o log do backend avisa na subida ("a pasta dos
comprovantes … não aceita escrita").

Mudou só o backend? `docker compose build backend && docker compose up -d backend`.

## Pontos de atenção

- **O endereço da API é embutido na build do front.** Mudou `PUBLIC_API_BASE`?
  Precisa de `docker compose build frontend`.
- **A build do front usa a raiz do repositório como contexto**, porque importa
  `backend/src/contracts`. O `.dockerignore` da raiz mantém o contexto leve.
- **Backup**: o banco `sigo` fica no Postgres compartilhado; entre na rotina de
  `pg_dump` que já existir para os outros bancos. **A pasta `dados/comprovantes` também
  precisa de backup**: o banco só guarda o registro, o arquivo está nela. Guarde também
  o `.env` (em lugar seguro): sem o mesmo `AUTH_SECRET`, a chave da IA do banco não abre.
- **Banco já criado**: o `create-database` primeiro tenta entrar no próprio banco e só usa
  a base administrativa (`postgres`) quando ele não existe. Se o Postgres compartilhado não
  deixa o usuário do SIGO criar banco, crie à mão uma vez e ponha `CREATE_DATABASE=false`.
- **Pasta dos comprovantes**: `dados/comprovantes` na pasta do projeto, montada em
  `/app/dados/comprovantes` pelo compose. Precisa ser do uid 1000 (o usuário `node`
  do container); o comando está nos blocos de deploy acima.
- **Leitura por IA**: o admin liga em Cadastros → Leitura por IA, colando a chave da API
  (OpenAI por padrão; Anthropic também serve). A chave é conferida na própria API antes de
  salvar e fica no banco cifrada com o `AUTH_SECRET`: trocar esse segredo deixa a chave
  ilegível, e a tela pede para colar de novo. O backend precisa de saída HTTPS para
  `api.openai.com` (ou `api.anthropic.com`). Sem chave, o arquivo continua sendo anexado.
  Se houver proxy com tempo limite curto na frente da API, deixe ao menos 5 minutos para
  a rota `/api/anexos/:id/ler` (até 3 tentativas de 90 s). O Caddy não tem limite padrão.
- **`npm run db:exemplo` recusa rodar com `NODE_ENV=production`** e em banco que
  já tenha lançamento: dados de exemplo nunca chegam à produção.
- **Sienge**: `SIENGE_SUBDOMAIN`, `SIENGE_USER` e `SIENGE_PASSWORD` no `.env` ligam o
  quadro "No Sienge em <mês>" (sem elas, ele aparece como sem conexão). O backend
  precisa de saída HTTPS para `api.sienge.com.br`. Prefira um usuário de API próprio do
  SIGO no Painel de Integrações, com leitura de títulos a pagar (e parcelas), centros de
  custo, credores e extrato de contas (a conferência de pagamentos usa os três últimos). O
  limite de 200 req/min é do subdomínio inteiro e dividido com o Painel Sienge: mantenha
  `SIENGE_RATE_LIMIT_PER_MINUTE` baixo (40 por padrão). As tabelas `sienge_*` são
  cópia e podem ser apagadas; a próxima consulta refaz.
