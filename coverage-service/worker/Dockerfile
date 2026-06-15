FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY coverage-service/lib/package.json ./coverage-service/lib/
COPY coverage-service/worker/package.json ./coverage-service/worker/
COPY coverage-service/api/prisma ./coverage-service/api/prisma

RUN pnpm install --frozen-lockfile --filter @openreview/coverage-lib --filter @openreview/coverage-worker

COPY coverage-service/lib ./coverage-service/lib
COPY coverage-service/worker ./coverage-service/worker

RUN pnpm --filter @openreview/coverage-lib build
RUN pnpm --filter @openreview/coverage-worker exec prisma generate --schema=../api/prisma/schema.prisma
RUN pnpm --filter @openreview/coverage-worker build

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    ca-certificates \
  && pip3 install --break-system-packages diff-cover \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY coverage-service/lib/package.json ./coverage-service/lib/
COPY coverage-service/worker/package.json ./coverage-service/worker/

RUN pnpm install --frozen-lockfile --prod --filter @openreview/coverage-lib --filter @openreview/coverage-worker

COPY --from=builder /app/coverage-service/lib/dist ./coverage-service/lib/dist
COPY --from=builder /app/coverage-service/worker/dist ./coverage-service/worker/dist
COPY --from=builder /app/coverage-service/api/prisma ./coverage-service/api/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

WORKDIR /app/coverage-service/worker

ENV WORK_DIR=/tmp/pr-coverage-runs
ENV EXECUTION_TIMEOUT_MS=600000

USER node

CMD ["node", "dist/main.js"]
