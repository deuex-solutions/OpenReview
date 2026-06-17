# PR Coverage Service

PR diff coverage analysis and LLM unit test generation, integrated into the OpenReview monorepo.

## Architecture

```
┌─────────┐     webhook      ┌─────────┐     BullMQ     ┌─────────┐
│ GitHub  │ ───────────────► │   API   │ ─────────────► │ Worker  │
└─────────┘                  └────┬────┘                └────┬────┘
                                  │                          │
                             ┌────▼────┐                ┌────▼────┐
                             │ Postgres│                │  Redis  │
                             └─────────┘                └─────────┘
```

| Package | Role |
|---------|------|
| `@openreview/coverage-lib` | Shared types, coverage providers, LLM providers, code analysis |
| `@openreview/coverage-api` | NestJS API — repos, webhooks, job enqueue |
| `@openreview/coverage-worker` | BullMQ worker — clone, coverage, test generation, execution |

## Database Step Up:

### 1. Create DB
```bash
create db <database-name>
```

## Quick Start

### 1. Configure environment

```bash
cd coverage-service
cp .env.example .env
# Edit .env with your GitHub PAT and OpenAI API key
```

Note: Create database before booting up coverage service

### 2. Start services (Docker)

```bash
cd coverage-service
docker compose up -d --build
```

### 3. Local development

From the OpenReview repo root:

```bash
pnpm install
pnpm coverage:db:generate
pnpm coverage:db:push
pnpm coverage:setup:worker-deps

# Terminal 1
pnpm coverage:dev:api

# Terminal 2
pnpm coverage:dev:worker
```

### 4. Register a repository

```bash
curl -X POST http://localhost:3000/repositories \
  -H "Content-Type: application/json" \
  -d '{
    "githubRepo": "owner/repo",
    "defaultBranch": "main",
    "coverageCommand": "npm test -- --coverage",
    "testCommand": "npm test"
  }'
```

### 5. Configure GitHub webhook

- **URL:** `http://<your-host>:3000/webhooks/github`
- **Content type:** `application/json`
- **Secret:** same value as `WEBHOOK_SECRET` in `.env`
- **Events:** Pull requests

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/repositories` | Register repository |
| GET | `/repositories` | List repositories |
| GET | `/repositories/:id` | Get repository with recent PR runs |
| POST | `/repositories/:id/analyze` | Trigger analysis by PR # |
| POST | `/repositories/:id/generate-test` | Generate unit test for a single file (`filePath` optional — auto-picks from diff coverage when omitted) |
| POST | `/webhooks/github` | GitHub webhook handler |
| GET | `/pr-runs/:id` | Get PR run results |
| GET | `/pr-runs/:id/tests/:testId` | Download generated test |
| POST | `/pr-runs/:id/retry` | Re-enqueue analysis |
| GET | `/pr-runs/repository/:repositoryId` | List runs for a repo |
| GET | `/test-generation-runs/:id` | Get test generation run status and JSON result (`generatedTest.fileName`, `generatedTest.content`) |

## Integration with OpenReview

The main OpenReview review service (`@openreview/service`) can forward PR events to this service via its downstream dispatcher when `COVERAGE_SERVICE_URL` is configured (future integration).
