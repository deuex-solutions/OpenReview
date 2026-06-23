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
COPY coverage-service/worker/package.json ./coverage-service/worker/
COPY coverage-service/api/package.json ./coverage-service/api/
COPY coverage-service/api/prisma ./coverage-service/api/prisma
COPY coverage-service/api/scripts ./coverage-service/api/scripts

RUN pnpm install --frozen-lockfile --ignore-scripts \
    --filter @openreview/coverage-lib \
    --filter @openreview/coverage-worker \
    --filter @openreview/coverage-api

COPY coverage-service/lib ./coverage-service/lib
COPY coverage-service/worker ./coverage-service/worker

RUN pnpm --filter @openreview/coverage-lib build
# Generate from @openreview/coverage-api — it owns the schema and prisma CLI.
RUN pnpm --filter @openreview/coverage-api exec prisma generate
RUN pnpm --filter @openreview/coverage-worker build

FROM node:24-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    openssl \
    ca-certificates \
  && pip3 install --break-system-packages diff-cover \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY coverage-service/lib/package.json ./coverage-service/lib/
COPY coverage-service/worker/package.json ./coverage-service/worker/
COPY coverage-service/api/package.json ./coverage-service/api/
COPY coverage-service/api/prisma ./coverage-service/api/prisma
COPY coverage-service/api/scripts ./coverage-service/api/scripts

RUN pnpm install --frozen-lockfile --ignore-scripts \
    --filter @openreview/coverage-lib \
    --filter @openreview/coverage-worker \
    --filter @openreview/coverage-api

COPY --from=builder /app/coverage-service/lib/dist ./coverage-service/lib/dist
COPY --from=builder /app/coverage-service/worker/dist ./coverage-service/worker/dist
COPY --from=builder /app/coverage-service/api/prisma ./coverage-service/api/prisma

ENV CI=true
RUN pnpm --filter @openreview/coverage-api exec prisma generate

WORKDIR /app/coverage-service/worker

ENV NODE_ENV=production
ENV WORK_DIR=/tmp/pr-coverage-runs
ENV EXECUTION_TIMEOUT_MS=3600000

USER node

CMD ["node", "dist/main.js"]
