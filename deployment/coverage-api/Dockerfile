# syntax=docker/dockerfile:1.7

FROM node:24-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY coverage-service/lib/package.json ./coverage-service/lib/
COPY coverage-service/api/package.json ./coverage-service/api/
COPY coverage-service/api/prisma ./coverage-service/api/prisma
COPY coverage-service/api/scripts ./coverage-service/api/scripts

RUN pnpm install --frozen-lockfile --ignore-scripts \
    --filter @openreview/coverage-lib \
    --filter @openreview/coverage-api

COPY coverage-service/lib ./coverage-service/lib
COPY coverage-service/api ./coverage-service/api

RUN pnpm --filter @openreview/coverage-lib build
RUN pnpm --filter @openreview/coverage-api exec prisma generate
RUN pnpm --filter @openreview/coverage-api build

FROM node:24-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY coverage-service/lib/package.json ./coverage-service/lib/
COPY coverage-service/api/package.json ./coverage-service/api/
COPY coverage-service/api/prisma ./coverage-service/api/prisma
COPY coverage-service/api/scripts ./coverage-service/api/scripts

RUN pnpm install --frozen-lockfile --ignore-scripts \
    --filter @openreview/coverage-lib \
    --filter @openreview/coverage-api

COPY --from=builder /app/coverage-service/lib/dist ./coverage-service/lib/dist
COPY --from=builder /app/coverage-service/api/dist ./coverage-service/api/dist

ENV CI=true
RUN pnpm --filter @openreview/coverage-api exec prisma generate

WORKDIR /app/coverage-service/api

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
