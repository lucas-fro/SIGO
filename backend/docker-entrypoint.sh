#!/bin/sh
set -e

# Cria o banco caso ainda não exista. Usa ADMIN_DATABASE_URL (ou o DATABASE_URL
# apontando para a base `postgres`). Com o banco criado à mão, desligue com
# CREATE_DATABASE=false.
if [ "${CREATE_DATABASE:-true}" = "true" ]; then
  echo "[entrypoint] verificando banco"
  node dist/db/create-database.js
fi

# Idempotente: o Drizzle pula o que já foi aplicado.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] aplicando migrations"
  node dist/db/migrate.js
fi

# Listas iniciais (só as vazias) e o administrador do .env. Depois das
# migrations, de propósito: as tabelas precisam existir. Idempotente.
if [ "${SEED:-true}" = "true" ]; then
  echo "[entrypoint] listas iniciais e administrador"
  node dist/db/seed.js
  node dist/auth/cli.js seed-admin
fi

exec "$@"
