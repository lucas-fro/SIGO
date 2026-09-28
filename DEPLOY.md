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
nano .env          # DATABASE_URL aponta para o container `postgres`, não localhost
chmod 600 .env

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
de recuperar acesso). Os demais são cadastrados pela linha de comando; a senha
entra pela variável `SENHA`, nunca como argumento, para não ficar no histórico:

```bash
# alguém do Marketing que lança gastos
docker compose exec -e SENHA='senha-dela' backend \
  node dist/auth/cli.js criar maria@smart.com.br --nome="Maria Souza" --papel=editor --setores=marketing

# diretoria, só consulta
docker compose exec -e SENHA='senha' backend \
  node dist/auth/cli.js criar diretoria@smart.com.br --nome="Diretoria" --papel=leitor --setores=marketing

docker compose exec backend node dist/auth/cli.js listar
docker compose exec -e SENHA='nova' backend node dist/auth/cli.js senha maria@smart.com.br
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

Cookie `httpOnly` assinado, válido por `AUTH_SESSION_DAYS` (7 por padrão), sem
tabela de sessões: sobrevive ao restart e ninguém é deslogado quando sobe
código. Depois de 8 tentativas erradas o IP fica bloqueado por 15 minutos.

## Atualizar depois de mexer no código

```bash
git pull
docker compose build
docker compose up -d
```

Mudou só o backend? `docker compose build backend && docker compose up -d backend`.

## Pontos de atenção

- **O endereço da API é embutido na build do front.** Mudou `PUBLIC_API_BASE`?
  Precisa de `docker compose build frontend`.
- **A build do front usa a raiz do repositório como contexto**, porque importa
  `backend/src/contracts`. O `.dockerignore` da raiz mantém o contexto leve.
- **Backup**: o banco `sigo` fica no Postgres compartilhado; entre na rotina de
  `pg_dump` que já existir para os outros bancos.
- **`npm run db:exemplo` recusa rodar com `NODE_ENV=production`** e em banco que
  já tenha lançamento: dados de exemplo nunca chegam à produção.
