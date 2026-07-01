# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Builder — installs all workspace deps and produces dist/ for service + deps
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# Workspace manifests first for better layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY core/package.json core/
COPY cli/package.json cli/
COPY action/package.json action/
COPY service/package.json service/

RUN pnpm install --frozen-lockfile --filter @openreview/service... --filter @openreview/core

COPY core ./core
COPY service ./service

RUN pnpm -r --filter @openreview/core --filter @openreview/service build

# Prune dev dependencies for the runtime image.
RUN pnpm --filter @openreview/service --prod deploy /out

# -----------------------------------------------------------------------------
# Runtime — slim Node image with only the service + its prod deps
# -----------------------------------------------------------------------------
FROM node:24-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /out ./

EXPOSE 3000

# Default to the web process. Override to "node dist/worker.mjs" for workers.
CMD ["node", "dist/web.mjs"]
