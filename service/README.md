# @openreview/service

Self-hosted webhook service that receives GitHub PR events and runs OpenReview reviews. It is the only component in the architecture that talks to GitHub — workers and any future downstream services consume normalized job payloads.

## Architecture

```
                              ┌──────────────────────────┐
GitHub PR ── webhook ────────►│  web.mjs (Express)       │
                              │  - verifies HMAC         │
                              │  - acks 202 immediately  │
                              │  - enqueues to BullMQ    │
                              └──────────┬───────────────┘
                                         │ Redis
                                         ▼
                              ┌──────────────────────────┐
                              │  worker.mjs (BullMQ)     │
                              │  - runFastReview         │
                              │  - runRLM                │
                              │  - handleChatMention     │
                              │  - learnings list/forget │
                              └──────────┬───────────────┘
                                         │
                                         ▼
                              GitHub PR review comments
```

Two processes share one codebase. Both are stateless — scale by running more workers.

## Project layout

```
service/
├── src/
│   ├── web.ts                    HTTP entrypoint (express)
│   ├── worker.ts                 BullMQ entrypoint
│   ├── app.ts                    Express factory (testable)
│   ├── config.ts                 zod-validated env config
│   ├── logger.ts                 pino logger
│   ├── routes/
│   │   ├── health.ts             GET /health, GET /ready
│   │   └── webhook.ts            POST /webhook
│   ├── webhook/
│   │   ├── verify.ts             HMAC SHA-256 signature check
│   │   ├── router.ts             dispatch by X-GitHub-Event
│   │   └── handlers/
│   │       ├── pull-request.ts   opened/synchronize/reopened/ready_for_review
│   │       ├── issue-comment.ts  @openreview commands and chat
│   │       └── types.ts          minimal payload shapes
│   ├── jobs/
│   │   ├── connection.ts         ioredis factory for BullMQ
│   │   ├── queue.ts              ReviewQueue (producer)
│   │   ├── types.ts              OpenReviewJob discriminated union
│   │   └── processors/
│   │       ├── context.ts        shared PRContext + client builder
│   │       ├── review.ts         fast review
│   │       ├── rlm.ts            deep (RLM) review
│   │       ├── chat.ts           @openreview question
│   │       └── learnings.ts      list / forget
│   ├── github/
│   │   └── auth.ts               token resolver (PAT today, App-ready)
│   └── dispatch/
│       └── downstream.ts         no-op stub for future fan-out
├── Dockerfile
├── .env.example
└── package.json
```

## Required environment

Set the variables in `service/.env.example` plus the standard OpenReview review-engine ones (`OPENAI_API_KEY` etc.) at the project root `.env`.

| Variable                | Required | Notes                                                                                |
| ----------------------- | -------- | ------------------------------------------------------------------------------------ |
| `GITHUB_WEBHOOK_SECRET` | yes      | Same string you configure on the GitHub webhook. Generate via `openssl rand -hex 32`. |
| `GITHUB_PAT`            | yes      | PAT used by the service to read PRs and post review comments.                         |
| `REDIS_URL`             | yes      | BullMQ connection string. Local dev: `redis://localhost:6379`.                        |
| `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) | yes | Read by `@openreview/core` from the root `.env`. |
| `PORT`, `HOST`          | no       | Default `3000` / `0.0.0.0`.                                                           |
| `LOG_LEVEL`             | no       | pino level. Default `info`.                                                          |
| `WORKER_CONCURRENCY`    | no       | Default `4`. Number of jobs the worker runs in parallel.                              |
| `JOB_MAX_ATTEMPTS`      | no       | Default `3`. Retries before a job is moved to the failed set.                         |

## Local development

```bash
# 1. From the repo root
pnpm install
pnpm -r --filter @openreview/core --filter @openreview/service build

# 2. Make sure Redis is running locally
docker run -p 6379:6379 -d redis:7-alpine
#   or: brew install redis && brew services start redis

# 3. Configure
cp service/.env.example service/.env
# fill in GITHUB_WEBHOOK_SECRET. GITHUB_PAT and OPENAI_API_KEY are inherited
# from the project-root .env.

# 4. Run web + worker in two terminals
pnpm --filter @openreview/service start:web
pnpm --filter @openreview/service start:worker

# 5. Expose your local port for GitHub to reach
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
# prints: https://<random>.trycloudflare.com
```

In `userName/repo` → Settings → Webhooks → Add webhook:
- **Payload URL**: `https://<random>.trycloudflare.com/webhook`
- **Content type**: `application/json`
- **Secret**: the same value as `GITHUB_WEBHOOK_SECRET`
- **Events**: select *Pull requests*, *Issue comments*, *Pull request review comments*

GitHub will send a `ping` event immediately — you should see `webhook ignored — GitHub ping event` in your logs.

## Production deploy (Docker)

```bash
# Build
docker build -f service/Dockerfile -t openreview-service:latest .

# Run web
docker run --rm -p 3000:3000 --env-file service/.env openreview-service

# Run worker (same image, different command)
docker run --rm --env-file service/.env openreview-service node dist/worker.mjs
```

For Render / Fly / Railway / Kubernetes / Nomad, define two services from the same image:

- **web** — runs `node dist/web.mjs`, exposes port 3000, health check on `GET /ready`.
- **worker** — runs `node dist/worker.mjs`, no port. Can scale independently.

Both must share `REDIS_URL`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_PAT`, and the LLM provider key.

## How requests flow

1. `POST /webhook` receives a delivery; raw body is preserved via `express.raw`.
2. `verifySignature` confirms `X-Hub-Signature-256` matches HMAC-SHA-256 of the body using `GITHUB_WEBHOOK_SECRET`. Mismatch → `401`.
3. Body is JSON-parsed; service replies `202 Accepted` immediately.
4. `routeWebhook` dispatches by `X-GitHub-Event`:
   - `pull_request` → `handlePullRequest` enqueues a `review-fast` job.
   - `issue_comment` / `pull_request_review_comment` → `handleComment` parses the `@openreview` command and enqueues `review-fast`, `review-rlm`, `chat`, `learnings-list`, or `learnings-forget`.
   - `ping` and unknown events → ignored.
5. `ReviewQueue.enqueue` computes a deterministic job ID for idempotency. Duplicate deliveries (same headSha, same comment) collapse.
6. A worker process pulls the job; the matching processor in `src/jobs/processors/` calls into `@openreview/core` and posts results via `CommentPoster`.
7. On failure, BullMQ retries with exponential backoff up to `JOB_MAX_ATTEMPTS`.

## Adding downstream services

When the mock's downstream services exist (linters, indexers, etc.), replace `createNoopDispatcher` in `web.ts` with a real implementation of `DownstreamDispatcher`. The webhook handler will keep enqueuing for in-process review AND forward the normalized payload to those services — no GitHub access on the downstream side.

## Security checklist

- Always set a strong `GITHUB_WEBHOOK_SECRET`; verification uses constant-time comparison.
- Run web behind TLS (load balancer or reverse proxy). GitHub will not send to plain HTTP.
- Restrict the PAT scopes: `repo` for private repos, no scopes for public.
- Bot-loop prevention: comments from `*[bot]` accounts are ignored.
- Idempotency keys prevent duplicate work if GitHub redelivers (it can and does).
- Workers run with the same secrets as the web process — keep both inside the same trust boundary.
