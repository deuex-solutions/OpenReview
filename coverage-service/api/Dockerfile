FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY coverage-service/lib/package.json ./coverage-service/lib/
COPY coverage-service/api/package.json ./coverage-service/api/

RUN pnpm install --frozen-lockfile --filter @openreview/coverage-lib --filter @openreview/coverage-api

COPY coverage-service/lib ./coverage-service/lib
COPY coverage-service/api ./coverage-service/api

RUN pnpm --filter @openreview/coverage-lib build
RUN pnpm --filter @openreview/coverage-api exec prisma generate
RUN pnpm --filter @openreview/coverage-api build

FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY coverage-service/lib/package.json ./coverage-service/lib/
COPY coverage-service/api/package.json ./coverage-service/api/

RUN pnpm install --frozen-lockfile --prod --filter @openreview/coverage-lib --filter @openreview/coverage-api

COPY --from=builder /app/coverage-service/lib/dist ./coverage-service/lib/dist
COPY --from=builder /app/coverage-service/api/dist ./coverage-service/api/dist
COPY --from=builder /app/coverage-service/api/prisma ./coverage-service/api/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

WORKDIR /app/coverage-service/api

EXPOSE 3000

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
