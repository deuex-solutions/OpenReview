# OpenReview

[![CI](https://github.com/deuex-solutions/OpenReview/actions/workflows/ci.yml/badge.svg)](https://github.com/deuex-solutions/OpenReview/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Open-source, agentic code review tool. AI-powered bug detection, sandboxed code execution, codebase-aware chat, and full GitHub workflow integration.

## Why OpenReview?

- **Self-hosted** — runs entirely on your infrastructure. Code never leaves your machine except to your chosen LLM API.
- **Dual review modes** — Fast mode (single-shot, < 60s) and Deep/RLM mode (agentic loop with sandboxed code execution).
- **Any LLM** — bring your own API key. OpenAI, Anthropic Claude, Google Gemini, or any OpenAI-compatible endpoint.
- **Full GitHub sync** — findings posted as native PR review comments with inline suggestions.
- **Built-in linters** — ESLint, Ruff, Semgrep, ShellCheck, Gitleaks run in parallel alongside AI review.
- **Codebase-aware chat** — ask questions about your PR with full repo context via `@openreview`.
- **Learns from feedback** — persistent learnings database avoids repeating false positives.
- **Language & framework aware** — detects TypeScript, Python, Go, Rust, React, Next.js, and more for targeted review.

## Quick Start

### GitHub Action (auto-review on every PR)

Add to `.github/workflows/openreview.yml`:

```yaml
name: OpenReview
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  pull_request_review_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: deuex-solutions/OpenReview@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

### CLI (review any PR from your terminal)

For users who want to evaluate OpenReview without cloning:

```bash
# Review a PR (Fast mode)
npx openreview review --url https://github.com/owner/repo/pull/123
```

For developers working in a local clone:

```bash
# 1. Build the project
pnpm build

# 2. Run a review
node cli/dist/main.mjs review --url https://github.com/owner/repo/pull/123
# OR
pnpm review --url https://github.com/owner/repo/pull/123
```

### GitHub Comment Commands

| Command                             | Description                         |
| ----------------------------------- | ----------------------------------- |
| `@openreview review`                | Trigger a fresh Fast mode review    |
| `@openreview rlm`                   | Trigger Deep/RLM mode review        |
| `@openreview <question>`            | Ask a codebase-aware question       |
| `@openreview list learnings`        | List stored learnings for this repo |
| `@openreview forget: <description>` | Delete a stored learning            |

## CLI Commands

### `review` — Review a Pull Request

```bash
npx openreview review --url <PR-URL> [options]
```

| Option           | Default  | Description                                       |
| ---------------- | -------- | ------------------------------------------------- |
| `--url <url>`    | required | GitHub PR URL                                     |
| `--mode <mode>`  | `fast`   | Review mode: `fast` or `rlm`                      |
| `--output <fmt>` | `text`   | Output format: `text`, `markdown`, or `json`       |
| `--model <id>`   | —        | Override the LLM model at runtime                  |
| `--expert`       | off      | Comprehensive SOLID, security, and quality review  |
| `--submit`       | off      | Post findings as GitHub PR comment (inline + summary) |
| `--quiet`        | off      | Suppress progress output (only print findings)     |

**Expert mode** (`--expert`) adds deep analysis covering:
- SOLID principles (single responsibility, open/closed, Liskov, interface segregation, dependency inversion)
- Security (OWASP Top 10, injection, auth/authz, data exposure)
- Code quality (complexity, readability, maintainability, test coverage gaps)
- Performance (algorithmic complexity, resource leaks, unnecessary allocations)

### `ask` — Interactive Q&A

```bash
npx openreview ask [--url <PR-URL>] [--repo <path>]
```

Opens an interactive REPL for codebase-aware Q&A. Supports commands: `reset`, `history`, `files`, `exit`.

### `traces` — View Review Logs

```bash
npx openreview traces --list             # List recent traces (last 20)
npx openreview traces --pr <PR-URL>      # Traces for a specific PR
npx openreview traces --open <file>      # Pretty-print a trace file
```

Every review (Fast or RLM) generates a JSON trace at `~/.openreview/traces/` with full audit trail: prompts, responses, findings, duration, and iteration details.

### `serve` — API Server

```bash
npx openreview serve [--port <n>] [--host <host>]
```

Starts an Express.js server for the web UI (Phase 2) and API integrations.

## Configuration

Copy `.env.example` to `.env` and set your API key:

```bash
cp .env.example .env
```

Key settings:

| Variable              | Default       | Description                                  |
| --------------------- | ------------- | -------------------------------------------- |
| `OPENAI_API_KEY`      | —             | OpenAI API key                               |
| `ANTHROPIC_API_KEY`   | —             | Anthropic API key                            |
| `GEMINI_API_KEY`      | —             | Google Gemini API key                        |
| `MAIN_MODEL`          | `gpt-4o`      | Primary model for review and chat            |
| `SUB_MODEL`           | `gpt-4o-mini` | Secondary model for suggestions              |
| `MAX_FILES`           | `100`         | Max files per review                         |
| `MAX_ITERATIONS`      | `12`          | Max RLM loop iterations                      |
| `MAX_LLM_CALLS`       | `35`          | Max LLM calls per RLM session               |
| `DEFAULT_REVIEW_MODE` | `fast`        | Default mode: `fast` or `rlm`               |
| `INCLUDE_GLOBS`       | —             | File patterns to include (e.g. `src/**/*.ts`) |
| `EXCLUDE_GLOBS`       | —             | File patterns to exclude (e.g. `dist/**`)    |
| `OPENAI_BASE_URL`     | —             | Custom OpenAI-compatible endpoint URL        |
| `GITHUB_PAT`          | —             | GitHub Personal Access Token (Optional for public repos) |

See [`.env.example`](.env.example) for the full list with all linter toggles and review behavior settings.

## Review Modes

### Fast Mode

Single-shot structured LLM call over the diff. Large diffs are automatically chunked by file (~40K chars per chunk) and reviewed in parallel. Non-reviewable files (lock files, generated code, images) are skipped automatically. Runs bundled linters in parallel.

**Smart prompting:**
- Small PRs (≤ 5 files, ≤ 3000 chars) use a compact, focused prompt for high accuracy
- Large PRs use a comprehensive prompt with full category checklist
- File-type detection adapts the reviewer persona (code reviewer / K8s auditor / docs reviewer / config specialist)

Findings are categorized:

| Severity                    | Description                              |
| --------------------------- | ---------------------------------------- |
| 🔴 **Bug — Severe**         | Requires immediate fix. Security risk or broken functionality. |
| 🟠 **Bug — Non-severe**     | Should be reviewed. Incorrect but not critical.               |
| 🔍 **Flag — Investigate**   | Warrants closer examination. May or may not be an issue.      |
| ℹ️ **Flag — Informational** | Explanatory annotation. No action required.                   |

### Deep / RLM Mode

Agentic review using LangGraph.js. The LLM reasons about the code, writes verification scripts, executes them in a Deno sandbox, observes results, and repeats — up to `MAX_ITERATIONS`. Every finding includes grounded citations.

When Deno is not installed, RLM automatically operates in reasoning-only mode — still effective, just without sandbox execution.

Triggered via `@openreview rlm` or `--mode rlm`.

## Coverage Service — Automated Unit-Test Generation

A separate **coverage-service** microservice (`coverage-service/`) sits behind OpenReview and:

1. Clones the PR at its head SHA.
2. Runs `npm test` under `c8 --reporter=cobertura` to measure coverage.
3. Runs Python `diff-cover` to compute coverage *on the PR's changed lines only*.
4. Asks an LLM (OpenAI / Anthropic) to generate unit tests for files below the threshold.
5. Verifies the new tests pass with `node --test`, then recomputes coverage.
6. Records LLM token usage and calculates estimated cost based on the model pricing.
7. Displays PR runs, coverage deltas, token usage, and total spend in the Next.js **Coverage Dashboard** (`web/`).

OpenReview then takes those generated files, **opens a stacked PR** against the original feature branch, and **posts a coverage-delta comment** on the original PR. See [Kenil27/band#4](https://github.com/Kenil27/band/pull/4) for an example.

### Architecture

```text
                              ┌────────────────────────────────────────────┐
GitHub App ──webhook─────────►│ OpenReview service (:3003)                 │
  pull_request                │   • POST /webhook                          │
  installation*               │   • POST /webhooks/github  (alias)         │
                              │   • POST /coverage-runs/trigger (manual) │
                              │   → review-fast + coverage-analysis jobs   │
                              └──────┬─────────────────────┬───────────────┘
                                     │ installation*       │ HTTP (localhost)
                                     │ forwarded           │ POST /repositories/:id/analyze
                                     ▼                     ▼
                              ┌────────────────────────────────────────────┐
                              │ coverage-service (:3010)                   │
                              │   Nest API + BullMQ worker                 │
                              │   clone → install → c8 → diff-cover →      │
                              │   LLM test gen → node --test → re-cover    │
                              └─────────────┬──────────────────────────────┘
                                            │  generatedTestFiles[]
                                            ▼
                              ┌────────────────────────────────────────────┐
                              │ OpenReview worker                          │
                              │   • commit test files to                   │
                              │     openreview/tests/pr-<N>                │
                              │   • open stacked PR → feature branch       │
                              │   • post coverage-delta comment on PR      │
                              └────────────────────────────────────────────┘

* `installation` / `installation_repositories` events received by OpenReview
  are forwarded to coverage-service so per-repo `githubInstallationId` values
  are stored automatically.
```

### Prerequisites

| Dep | What | How |
|---|---|---|
| **Node 20+** | Runs every service | `node -v` |
| **pnpm** | Package manager | `pnpm -v` |
| **Postgres** | Coverage-service Prisma DB (`prcoverage`) | `createdb prcoverage` (or your DB UI) |
| **Redis** | BullMQ for both services (queue names are disjoint, safe to share) | `brew services start redis` / `docker run redis` |
| **Python 3** + **diff-cover** | The coverage worker shells out to it | `pnpm coverage:setup:worker-deps` (creates `coverage-service/worker/.venv-tools/`) |
| **GitHub App** (recommended) | Posts reviews and coverage comments as your bot (`deuex-reviewer[bot]`), not a personal account | Install the app on target repos; set `GITHUB_AUTH_MODE=app` in `service/.env` and `coverage-service/.env` (see below) |
| **GitHub PAT** (fallback) | Local dev without a GitHub App installation | Classic `ghp_…` token with `repo` scope, or fine-grained with Contents + Pull requests read/write |
| **OpenAI key** | LLM that writes the tests (Anthropic also supported) | Paste into `coverage-service/.env` → `OPENAI_API_KEY=` |

#### GitHub App setup (recommended for self-hosted bot)

Install your GitHub App on the repos you want to review. Configure **both** env files with the same app credentials:

```bash
# service/.env — OpenReview web + worker (posts PR comments)
GITHUB_AUTH_MODE=app
GITHUB_APP_ID=<your-app-id>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
# Leave blank to resolve per-repo via GitHub API; set only for single-org dev.
# GITHUB_APP_INSTALLATION_ID=

# coverage-service/.env — clone + analyze PRs
GITHUB_AUTH_MODE=app
GITHUB_APP_ID=<same-app-id>
GITHUB_APP_PRIVATE_KEY=<same-private-key>
```

Webhook secret must match across the GitHub App settings, `service/.env` (`GITHUB_WEBHOOK_SECRET`), and `coverage-service/.env` (`WEBHOOK_SECRET`).

When `GITHUB_AUTH_MODE=app`, comments and stacked PRs are attributed to the **app bot**, not your personal GitHub account.

#### GitHub PAT scopes (when using `GITHUB_AUTH_MODE=pat`)

OpenReview's PR-author path needs to create git blobs → trees → commits → refs. The review-only path (just commenting on a PR) only needs `pull-requests: write`, but **opening a stacked PR additionally needs `contents: write`**.

- **Fine-grained PAT** (`github_pat_…`): the token must explicitly grant the target repo:
  - **Contents** → Read **and write**
  - **Pull requests** → Read **and write**
  - Metadata is auto-granted.
- **Classic PAT** (`ghp_…`): the single `repo` scope covers everything we need. Easiest if you don't want to fiddle with fine-grained permissions.

After regenerating a PAT, **the same value must be in all three `.env` files** (the rotated token will 401 wherever it isn't updated). Skip this when using GitHub App auth (`GITHUB_AUTH_MODE=app`).

```
.env                      # root — used by @openreview/core (CLI / action)
service/.env              # OpenReview service (web + worker)
coverage-service/.env     # coverage-service (api + worker)
```

Only needed when `GITHUB_AUTH_MODE=pat` in the service / coverage env files.

### One-time setup

```bash
# 1. Install deps + build everything
pnpm install
pnpm build

# 2. Configure env files (copy templates, paste your secrets)
cp .env.example .env                                # OPENAI_API_KEY, ...
cp service/.env.example service/.env                # GITHUB_WEBHOOK_SECRET, GITHUB_AUTH_MODE=app, app creds
cp coverage-service/.env.example coverage-service/.env  # WEBHOOK_SECRET (same as above), GITHUB_AUTH_MODE=app, OPENAI_API_KEY

# 3. Generate the Prisma client + run database migrations
pnpm coverage:db:generate
pnpm coverage:db:migrate

# 4. Install the Python diff-cover binary the coverage worker shells out to
pnpm coverage:setup:worker-deps

# 5. Enable the integration on the OpenReview side
#    Add to service/.env (already in .env.example):
#       COVERAGE_SERVICE_ENABLED=true
#       COVERAGE_SERVICE_URL=http://localhost:3010
```

### Run the stack (4–5 terminals)

| # | Command | Binds | Role |
|---|---|---|---|
| 1 | `pnpm coverage:dev:api` | `:3010` | Coverage-service HTTP API (Nest) — **internal**, not the public webhook target |
| 2 | `pnpm coverage:dev:worker` | (none) | Coverage-service worker — clone + coverage + LLM test generation |
| 3 | `pnpm --filter @openreview/service start:web` | `:3003` | OpenReview HTTP — **GitHub App webhook entrypoint** + `/coverage-runs/trigger` |
| 4 | `pnpm --filter @openreview/service start:worker` | (none) | OpenReview worker — review, stacked PR, coverage comment |
| 5 | `cd web && pnpm dev` | `:3000` | Next.js Coverage & Cost Monitoring Dashboard (optional) |

> **Ports:** `:3010` = `API_PORT` in `coverage-service/.env`; `:3003` = `PORT` in `service/.env`.
>
> **Local tunnel:** point ngrok (or similar) at **`:3003`**, not `:3010`. Example: `ngrok http 3003` → set the GitHub App webhook URL to `https://<tunnel>/webhooks/github`.


### Verified end-to-end flow (curl path, no webhook needed)

This is the exact sequence verified on [Kenil27/band#3 → #4](https://github.com/Kenil27/band/pull/4).

```bash
# ── Step 1: register the repo with the coverage service (idempotent) ──
REPO_ID=$(curl -sS -X POST http://localhost:3010/repositories \
  -H 'Content-Type: application/json' \
  -d '{"githubRepo":"<owner>/<repo>"}' | jq -r .id)
echo "repo: $REPO_ID"

# ── Step 2: trigger coverage analysis on a specific PR ──
PR_RUN_ID=$(curl -sS -X POST "http://localhost:3010/repositories/$REPO_ID/analyze" \
  -H 'Content-Type: application/json' \
  -d '{"prNumber": <pr-number>}' | jq -r .prRunId)
echo "prRun: $PR_RUN_ID"

# ── Step 3 (optional): watch the coverage-service run progress ──
#    Statuses cycle: PENDING → CLONING → RUNNING_COVERAGE → ANALYZING
#                  → GENERATING_TESTS → RUNNING_TESTS → RECALCULATING → COMPLETED
curl -sS "http://localhost:3010/pr-runs/$PR_RUN_ID" | jq '{status, diffCoverageBefore, diffCoverageAfter, generatedTestsCount, executionStatus}'

# ── Step 4: hand the prRunId to OpenReview to open the stacked PR ──
#    Safe to call before, during, or after the coverage run completes — OpenReview
#    will poll for the terminal status and only then commit + open the PR.
curl -sS -X POST http://localhost:3003/coverage-runs/trigger \
  -H 'Content-Type: application/json' \
  -d "{\"prRunId\":\"$PR_RUN_ID\"}"
# → 202 { "status": "accepted", "prRunId": "...", "headSha": "..." }
```

### What you should see when it works

In terminal 4 (OpenReview worker):

```text
job enqueued                          kind=coverage-analysis
starting coverage analysis            prRunId=<id>
resuming polling for existing pr-run
coverage analysis finished            status=COMPLETED  diffCoverageAfter=100  generatedTests=1
stacked test PR ready                 branch=openreview/tests/pr-<N>  testPrNumber=<M>  created=true
```

On GitHub:

- A new branch on the same repo: `openreview/tests/pr-<N>`.
- A new PR `openreview/tests/pr-<N>` → original PR's feature branch, body containing:
  - A Before / After / Delta table for diff coverage *and* overall coverage.
  - A `Test file | Covers | Status` table mapping each generated `filePath` to its `targetFile` with ✅ / ❌ / — for the test execution result.
- A `[INFO] OpenReview — Coverage` summary comment on the original PR.

### Webhook path (GitHub App — recommended)

Point your **GitHub App** webhook at OpenReview on **port 3003** (not coverage-service on 3010):

| Setting | Value |
| --- | --- |
| **Payload URL** | `https://<your-tunnel>/webhooks/github` or `https://<host>:3003/webhook` |
| **Content type** | `application/json` |
| **Secret** | Same string in GitHub App settings, `service/.env` → `GITHUB_WEBHOOK_SECRET`, and `coverage-service/.env` → `WEBHOOK_SECRET` |
| **Events** | `Pull requests` (`opened`, `synchronize`, `reopened`, `ready_for_review`) and `Installation` (so coverage-service stores per-repo installation IDs) |

Both `POST /webhook` and `POST /webhooks/github` are accepted on OpenReview — use whichever matches your GitHub App configuration.

On each qualifying `pull_request` event, OpenReview enqueues:

- `review-fast` — gitar-style summary + inline findings (cached when the reviewable diff matches a prior run; see `REVIEW_CACHE_ENABLED` in `service/.env.example`)
- `coverage-analysis` — calls coverage-service, then opens the stacked test PR and posts the coverage comment

**Ignored by design:** `edited` (e.g. CodeRabbit updating the PR body), `closed`, and other non-code events return `200` with `ignored` — push a new commit or redeliver an `opened`/`synchronize` delivery to re-run.

The curl path in the previous section remains supported for repos without a webhook.

### `GET /pr-runs/:id` — response fields OpenReview consumes

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `PENDING \| CLONING \| RUNNING_COVERAGE \| ANALYZING \| GENERATING_TESTS \| RUNNING_TESTS \| RECALCULATING \| COMPLETED \| FAILED` | Run lifecycle. OpenReview polls until `COMPLETED` or `FAILED`. |
| `diffCoverageBefore` / `diffCoverageAfter` | `number` | % of PR-changed lines covered before/after generation. |
| `coverageBefore` / `coverageAfter` | `number` | Overall (whole-repo) coverage before/after. |
| `fileCoverage[]` | `{ file, before, after }[]` | Per-file deltas — rendered in the summary comment. |
| `generatedTestFiles[]` | `{ filePath, targetFile, passed, fileContent }[]` | The files OpenReview commits to the stacked PR. `fileContent` is the test source verbatim. |
| `executionStatus` | `PASS \| FAIL \| PARTIAL \| SKIPPED` | Aggregate of the per-file `passed` flags. |
| `workflowSummary` | `{ status, thresholdReached, ... }` | Summary the coverage worker emits at the end of the run. |

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Comments appear under your personal account, not the bot | OpenReview is using `GITHUB_AUTH_MODE=pat` (or `GITHUB_PAT` only) | Set `GITHUB_AUTH_MODE=app` with `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` in `service/.env`; restart the worker |
| Webhook delivery `200` but `action edited ignored` | PR description was edited (e.g. by another bot), not new code | Push a commit (`synchronize`) or redeliver the `opened` webhook; only `opened` / `synchronize` / `reopened` / `ready_for_review` trigger runs |
| Nothing hits OpenReview web logs; coverage API logs webhooks instead | Tunnel or GitHub App webhook points at `:3010` instead of `:3003` | `ngrok http 3003` and set Payload URL to `https://<tunnel>/webhooks/github` |
| `Cannot POST /repositories/.../analyze` (HTML 404) | Hitting the wrong port — coverage-service is on `:3010`, OpenReview on `:3003`. | Use the right port. Confirm with `lsof -iTCP:3010 -sTCP:LISTEN`. |
| `No GitHub App installation ID found for owner/repo` on `POST .../analyze` | Repo not linked to an app installation in the coverage DB | Install the app on the repo; ensure `installation` events reach OpenReview (forwarded to coverage-service), or set `GITHUB_APP_INSTALLATION_ID` |
| `Repository not found` on analyze | Wrong `repo-id`. `GET /repositories` returns every registered repo — pick the row with the matching `githubRepo`. | Pipe `POST /repositories` straight into the analyze call (see Step 1 above); avoids retyping the cuid. |
| `GitHub API access forbidden (403) for /git/blobs` | PAT has `pull-requests: write` but not `contents: write`. | Update the fine-grained PAT to **Contents: read & write** (or switch to a classic PAT with `repo`, or use GitHub App auth). |
| `GitHub API access denied for owner/repo` (401) on analyze | PAT was rotated and `coverage-service/.env` still has the old string. | Same token must be in all three `.env` files when using PAT mode. With App auth, verify `GITHUB_APP_PRIVATE_KEY` is correct. |
| `ModuleNotFoundError: No module named 'diff_cover'` in the coverage worker | The Python venv wasn't created. | `pnpm coverage:setup:worker-deps` (creates `coverage-service/worker/.venv-tools/`). |
| `Custom Id cannot contain :` from BullMQ | Stale jobId format from a pre-fix build. | `pnpm build && pnpm --filter @openreview/service start:worker` to pick up the new code. |
| `status: "duplicate"` on `/coverage-runs/trigger` | A job for the same head SHA was already enqueued (and possibly failed). | `redis-cli del 'bull:openreview:coverage-analysis~<owner>/<repo>#<N>@<sha>'` to drop it, then re-trigger. Or push a new commit to bump the head SHA. |
| Coverage-service worker fails on a React/CRA repo with `Unexpected token '<'` | The current worker runs generated tests with `node --test`, which doesn't understand JSX. | Use a plain Node.js repo for now (a CLI / library). JSX-aware test execution is a known gap. |

### Configuration reference

- OpenReview service settings (webhook secret, **GitHub App auth**, review cache, `COVERAGE_SERVICE_*` timeouts and branch prefix) live in [`service/.env.example`](service/.env.example).
- Coverage-service settings (DB, Redis, LLM provider, `WEBHOOK_SECRET`, `GITHUB_AUTH_MODE`, `TEST_THRESHOLD`, `MAX_GENERATION_ATTEMPTS`, `DIFF_COVER_BIN`, worker concurrency) live in [`coverage-service/.env.example`](coverage-service/.env.example).

## Instruction Files

OpenReview automatically reads these files from your repository to customize reviews:

1. `REVIEW.md` — project-specific review rules (any directory level)
2. `AGENTS.md`
3. `CLAUDE.md`
4. `.cursorrules`
5. `.windsurfrules`

Files at subdirectory level are scoped to code in that subtree. Total instruction content is capped at 40KB.

## Tech Stack

| Layer             | Technology                    |
| ----------------- | ----------------------------- |
| Core language     | TypeScript / Node.js (≥ 20)   |
| LLM orchestration | LangGraph.js                  |
| LLM providers     | OpenAI, Anthropic, Google     |
| Package manager   | pnpm                          |
| Build tool        | tsdown                        |
| Testing           | Vitest                        |
| Linting           | ESLint 10 + Prettier          |
| Sandbox           | Deno (MVP) → Docker (Phase 2) |
| CLI               | commander                     |
| API server        | Express.js                    |

## Development

```bash
# Prerequisites: Node.js ≥ 20, pnpm, Deno ≥ 2.7 (optional, for RLM sandbox)
git clone https://github.com/deuex-solutions/OpenReview.git
cd OpenReview
pnpm install

# Build all packages
pnpm build

# Run tests (376 tests)
pnpm test

# Type checking
pnpm typecheck

# Lint & format
pnpm lint
pnpm format:check
```

See [GETTING_STARTED.md](GETTING_STARTED.md) for the full setup guide, [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines, and [SETUP.md](SETUP.md) for detailed configuration reference.

## Roadmap

- **Phase 1 (MVP)** ✅ — CLI + GitHub Action, Fast + RLM review, codebase chat, learnings, trace logging
- **Phase 2 (Growth)** — Web UI, auto-fix, Jira/Linear integration, 30+ linters, Docker sandbox, Impact Analysis
- **Phase 3 (Enterprise)** — Multi-platform (GitLab, Azure DevOps, Bitbucket), IDE extension, cloud hosting, analytics

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
