# syntax=docker/dockerfile:1
#
# Contexto de build: a RAIZ do repositório (ver docker-compose.yml). O front
# importa os contratos da API (esquemas zod) de backend/src/contracts, então
# essa pasta precisa estar no contexto.

# ---------- build da SPA estática ----------
FROM node:24-alpine AS build
WORKDIR /app/frontend

# A build é estática: não há processo Node em produção para ler variável de
# ambiente depois, então o endereço da API é embutido no bundle aqui. O padrão
# relativo assume front e API publicados no mesmo domínio pelo Caddy.
ARG NUXT_PUBLIC_API_BASE=/api
ENV NUXT_PUBLIC_API_BASE=$NUXT_PUBLIC_API_BASE
ENV NUXT_TELEMETRY_DISABLED=1

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
COPY backend/src/contracts /app/backend/src/contracts
RUN npm run build

# ---------- Nginx servindo os arquivos gerados ----------
FROM nginx:1.29-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/.output/public /usr/share/nginx/html
EXPOSE 80
