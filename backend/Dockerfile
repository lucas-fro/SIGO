# syntax=docker/dockerfile:1

# ---------- dependências completas (inclui devDependencies para compilar) ----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- compilação (Nest CLI + TypeScript) ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------- dependências de produção ----------
FROM node:24-alpine AS prod-deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- imagem final ----------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3340

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# O migrator lê ./drizzle a partir do diretório de trabalho.
COPY drizzle ./drizzle
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# O repositório é editado no Windows: um CRLF sobrando quebra o shebang.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 3340

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
