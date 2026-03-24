# OpenReview — Product Requirements Document (PRD)

> Version 1.2 | 2026-03-24
> Audience: Solo Founder / Product Manager / Technical Lead
> Status: In Development — Phase 1 Core Features Complete (2026-03-24) — All feature sections implemented, launch checklist pending

---

## 1. Product Overview

**OpenReview** is an open-source, agentic code review tool that combines automated bug detection, sandboxed code execution, codebase-aware chat, and full GitHub workflow integration. It is distributed as an `npx openreview` CLI and a GitHub Action, licensed MIT.

### Vision

Give every developer — regardless of team size or budget — access to the same depth of AI-powered code review that enterprise tools like CodeRabbit and Devin Review provide, with full data sovereignty and zero lock-in.

### Problem Statement

- Code review is the primary bottleneck as AI-generated code volume increases.
- Existing tools (CodeRabbit Pro, Devin Review) are closed-source, hosted, and expensive at scale.
- Open-source alternatives (CodeRabbit's archived ai-pr-reviewer, AsyncReview) are either unmaintained or lack GitHub workflow integration.
- No current open-source tool combines: agentic reasoning + linter integration + full GitHub sync + configurable LLM backend.

### Target Users

- Solo founders and indie developers maintaining open-source repos
- Small engineering teams (2–20 engineers) who self-host their tooling
- Product Managers and Technical Leads who want audit trails and grounded findings
- Open-source contributors who want a tool they can fork and extend

---

## 2. Tech Stack (Locked)

| Layer                      | Technology                                                       | Version                      | Rationale                                                                                                     |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Core language**          | TypeScript / Node.js                                             | TS 5.9, Node 24 LTS          | Single language across core, CLI, and Action. TS 6.0 RC available; TS 7 (Go rewrite, ~8x faster) in preview   |
| **Runtime**                | Node.js LTS                                                      | 24.14.0                      | Active LTS. Node 22/20 also supported. Starting Oct 2026, every release becomes LTS                           |
| **Package manager**        | pnpm                                                             | 10.x                         | Replaces Yarn Classic v1 (frozen/unmaintained since 2020). Fast, disk-efficient, strict dependency resolution |
| **LLM orchestration**      | LangGraph.js                                                     | 1.2.2 (@langchain/langgraph) | GA since 1.0. Type-safe streaming, automatic output coercion. Stable API until 2.0                            |
| **LLM providers**          | @langchain/openai, @langchain/anthropic, @langchain/google-genai | 1.2.13, 1.3.23, 2.1.25       | google-genai v2 uses new @google/genai SDK (REST-only, json_schema default)                                   |
| **LangChain core**         | @langchain/core                                                  | 1.1.32                       | Stable foundation types (Runnables, messages, chat models, tools). No breaking changes until 2.0              |
| **API server**             | Express.js                                                       | 5.2.1                        | Express 5 is now npm default. Simplified codebase, improved security                                          |
| **HTTP client**            | axios                                                            | 1.13.6                       | GitHub API calls, async-first. Continued 1.x maintenance                                                      |
| **Build tool**             | tsdown                                                           | Latest                       | Replaces tsup (unmaintained). Recommended successor by tsup maintainer. esbuild-powered                       |
| **Testing**                | Vitest                                                           | 3.x                          | Replaces Jest. Native ESM support, Vite-powered, faster execution. Jest 30 ESM still experimental             |
| **Linter / Formatter**     | ESLint 10 + Prettier 3.8                                         | 10.0.3 / 3.8.1               | ESLint 10: flat config only (no .eslintrc), requires Node ≥ 20.19.0                                           |
| **Sandbox execution**      | Deno (MVP) → Docker (Phase 2)                                    | 2.7.2                        | Temporal API stabilized, V8 14.5, improved Node.js compat                                                     |
| **CLI framework**          | commander                                                        | 14.0.3                       | Requires Node.js v20+. v15 planned May 2026                                                                   |
| **Env loader**             | dotenv                                                           | 17.3.1                       | v17 breaking: default quiet=false, DOTENV*CONFIG*\* env vars take precedence                                  |
| **Learnings storage**      | JSON files per repo                                              | —                            | `~/.openreview/learnings/<org>-<repo>.json`                                                                   |
| **Audit logs**             | JSON trace files                                                 | —                            | `~/.openreview/traces/<timestamp>-<pr>.json`                                                                  |
| **Web UI (Phase 2)**       | React 19 + TypeScript + Vite 8                                   | 19.2.4 / 8.0.0               | React 19: Server Components, use() hook, ref-as-prop. Vite 8: Rolldown bundler (10-30x faster)                |
| **GitHub Auth (MVP)**      | PAT (CLI) + GITHUB_TOKEN (Action)                                | —                            | Zero setup for self-hosted                                                                                    |
| **GitHub Auth (Phase 3)**  | GitHub App                                                       | —                            | Bot identity `openreview[bot]`                                                                                |
| **GitHub Actions toolkit** | @actions/core                                                    | 3.0.0                        | Major version bump from 1.x with breaking changes                                                             |

---

## 3. Repository Structure

```
openreview/                        # Monorepo (flat structure)
├── core/                          # TypeScript — LangGraph.js RLM engine
│   ├── src/
│   │   ├── review/                # Fast mode + Deep/RLM mode
│   │   │   ├── fast-review.ts     # Single-shot structured LLM review
│   │   │   ├── rlm-runner.ts      # LangGraph agentic loop
│   │   │   ├── snapshot.ts        # Hybrid codebase snapshot builder
│   │   │   └── linters.ts         # Linter orchestration
│   │   ├── github/                # GitHub API client
│   │   │   ├── client.ts          # axios-based async GitHub API
│   │   │   ├── comments.ts        # Review comment posting / batch submit
│   │   │   └── diff.ts            # Diff parsing + copy/move detection
│   │   ├── chat/                  # Codebase-aware Q&A
│   │   │   ├── chat-handler.ts    # @openreview mention processor
│   │   │   └── suggestions.ts     # Follow-up question generator
│   │   ├── learnings/             # Persistent learnings DB
│   │   │   └── learnings-store.ts # JSON file CRUD
│   │   ├── sandbox/               # Deno sandbox executor
│   │   │   └── deno-runner.ts
│   │   ├── config/                # .env loader + instruction file reader
│   │   │   ├── env.ts
│   │   │   └── instructions.ts    # REVIEW.md, AGENTS.md, .cursorrules etc.
│   │   └── server/                # Express.js internal API server
│   │       └── app.ts
│   ├── package.json
│   └── tsconfig.json
├── cli/                           # TypeScript — npx launcher
│   ├── src/
│   │   ├── main.ts                # Entry point — command routing
│   │   ├── commands/
│   │   │   ├── review.ts          # `npx openreview review --url`
│   │   │   ├── ask.ts             # `npx openreview ask --repo`
│   │   │   └── serve.ts           # `npx openreview serve`
│   │   └── formatter.ts           # text / markdown / JSON output
│   ├── package.json
│   └── tsconfig.json
├── action/                        # GitHub Action
│   ├── action.yml                 # Action definition
│   └── src/
│       ├── index.ts               # Action entry point
│       ├── pr-handler.ts          # pull_request event handler
│       └── comment-handler.ts     # pull_request_review_comment handler
├── web/                           # React UI (Phase 2 — placeholder)
│   └── .gitkeep
├── SKILL.md                       # Agent skill definition (Claude, Cursor, Gemini CLI)
├── REVIEW.md                      # OpenReview's own review rules
├── .env.example                   # Environment variable template
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Tests + lint on push/PR
│       └── release.yml            # npm publish + GitHub release on tag
├── package.json                   # Root workspace (pnpm workspaces)
├── pnpm-lock.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc
└── README.md
```

---

## 4. Feature Specifications

### 4.1 Review Triggering

#### Auto-Review (GitHub Action)

**User story:** As a developer, when I open or update a PR, I want a review to start automatically without any manual steps.

**Acceptance criteria:**

- Action fires on: `pull_request` events — `opened`, `synchronize`, `reopened`, `ready_for_review`
- Action fires on: `pull_request_review_comment` events — `created` (for chat)
- Auto-review posts Fast mode findings within 60 seconds of PR event
- Draft PRs are skipped by default; configurable via `REVIEW_DRAFTS=true` in `.env`
- Review can be skipped by adding `openreview: skip` to the PR description

**Data model:**

```
PR Event → GitHub Action → core/review/fast-review.ts → GitHub Comments
```

**API contract (action inputs):**

```yaml
inputs:
  github-token: # required — GITHUB_TOKEN from secrets
  openai-api-key: # optional — if using OpenAI
  anthropic-api-key: # optional — if using Anthropic
  gemini-api-key: # optional — if using Gemini
  main-model: # default: gpt-4o
  sub-model: # default: gpt-4o-mini
  max-files: # default: 100
  review-drafts: # default: false
```

#### Manual Trigger (CLI)

**User story:** As a developer, I want to run a review on any PR from my terminal without configuring a GitHub Action.

**Acceptance criteria:**

- `npx openreview review --url <PR-URL>` fetches the PR and runs Fast mode
- `npx openreview review --url <PR-URL> --mode rlm` runs Deep/RLM mode
- `--output text|markdown|json` controls output format
- `--model <model-id>` overrides the configured model at runtime
- `--expert` triggers comprehensive SOLID/security/quality review
- `--submit` posts findings as a GitHub PR comment (batch review + summary comment)
- Works without a local clone of the repository

#### Manual Trigger (GitHub Comment)

**Acceptance criteria:**

- `@openreview review` in a PR comment triggers a fresh Fast mode review
- `@openreview rlm` in a PR comment triggers Deep/RLM mode
- `@openreview <question>` triggers the codebase-aware chat handler
- Bot posts a "Review started..." acknowledgement comment within 5 seconds
- Only repo members with write access can trigger reviews via comments (enforced by GitHub)

---

### 4.2 Fast Mode Review

**User story:** As a developer, I want instant categorized bug findings on my PR within 60 seconds of opening it.

**How it works:**

1. Fetch PR diff + changed files via GitHub API (axios)
2. Apply `INCLUDE_GLOBS` / `EXCLUDE_GLOBS` filters
3. Read instruction files: `REVIEW.md`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`
4. Run bundled linters in parallel (ESLint, Ruff, Semgrep, ShellCheck, Gitleaks)
5. Send structured prompt to LLM (single call) with diff + linter output + instructions
6. Parse JSON response into categorized findings
7. Post findings as a batch GitHub review with inline comments

**Finding categories:**

- 🔴 **Bug — Severe**: Requires immediate fix. Blocks functionality or introduces data loss/security risk.
- 🟠 **Bug — Non-severe**: Should be reviewed. Incorrect behavior but not critical.
- 🔍 **Flag — Investigate**: Warrants closer examination. May or may not be an issue.
- ℹ️ **Flag — Informational**: Explanatory annotation. No action required.

**Acceptance criteria:**

- Fast mode completes in < 60 seconds for PRs with ≤ 100 files
- All findings include: category, severity, file path, line number(s), explanation, suggested fix (as comment)
- Findings submitted as a single GitHub review object (batch), not individual comments
- One top-level summary comment posted with: total findings count, severity breakdown, list of reviewed files
- Each finding also posted as an inline comment on the specific line(s)
- Linter findings merged with AI findings (deduplication by file+line)
- Resolved findings dimmed when user marks thread as resolved

**Data model (finding):**

```typescript
interface ReviewFinding {
  id: string;
  category: 'bug' | 'flag';
  severity: 'severe' | 'non-severe' | 'investigate' | 'informational';
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  explanation: string;
  suggestedFix?: string; // Markdown code block — comment only, no auto-commit
  source: 'ai' | 'linter' | 'both';
  linterName?: string;
  citations: Citation[];
}

interface Citation {
  file: string;
  startLine: number;
  endLine: number;
}
```

---

### 4.3 Deep / RLM Mode

**User story:** As a developer, I want to trigger a thorough, agentic review that explores the full codebase context and executes verification code — triggered via `@openreview rlm`.

**How it works (LangGraph.js agentic loop):**

1. Triggered by `@openreview rlm` comment or `--mode rlm` CLI flag
2. Build hybrid codebase snapshot:
   - Fetch diff + changed files immediately via GitHub API
   - Full repo file tree fetched on demand as the agent requests files during reasoning
3. LangGraph agent starts iterative loop (up to `MAX_ITERATIONS`, default 12):
   - **Reason**: LLM reasons about the code given current context
   - **Write Code**: LLM writes TypeScript/Python verification script
   - **Execute**: Script runs in Deno sandbox (read-only)
   - **Observe**: Output fed back into agent context
   - Loop continues until agent calls `finish_review` tool or hits iteration limit
4. Final answer produced with grounded citations (file + line)
5. Findings posted to GitHub with same format as Fast mode
6. Full JSON trace saved to `~/.openreview/traces/`

**Acceptance criteria:**

- RLM mode triggered only via explicit `@openreview rlm` or `--mode rlm` (never auto)
- Bot posts "Deep review started (RLM mode)... this may take 2-5 minutes" acknowledgement immediately
- Every finding includes citations with exact file path and line number(s)
- Trace log saved per review: `~/.openreview/traces/<timestamp>-<owner>-<repo>-<pr>.json`
- Trace contains: all iterations, reasoning steps, code written, sandbox output, final answer
- RLM mode respects `MAX_ITERATIONS` (default: 12) and `MAX_LLM_CALLS` (default: 35)
- Deno sandbox is read-only: no file writes, no network calls outside approved list

**LangGraph node definitions:**

```
[START] → reason_node → code_writer_node → sandbox_node → observe_node → [decision]
                                                                          ↓ (continue)
                                                                     reason_node
                                                                          ↓ (done)
                                                                    finalize_node → [END]
```

---

### 4.4 Copy/Move Detection

**User story:** As a reviewer, I want to see when code was moved between files displayed as a relocation — not as a delete + insert — to reduce visual noise.

**How it works:**

- After fetching diff, `core/github/diff.ts` runs a similarity analysis between deleted and added blocks
- Blocks with >80% token similarity across different files are classified as moves
- Classified as copies if the original also remains in the source file

**Acceptance criteria:**

- Move detected: shown in summary comment as "📦 Moved: `src/utils.ts` → `src/helpers/utils.ts`"
- Copy detected: shown as "📋 Copied: `src/auth.ts` → `src/auth-v2.ts`"
- Moved/copied blocks are excluded from line-by-line bug analysis (unless the content itself changed)
- Threshold configurable via `MOVE_DETECTION_THRESHOLD` (default: 0.8)

---

### 4.5 Codebase-Aware Chat / Q&A

**User story:** As a developer, I want to ask questions about the PR changes and get answers that reference the full codebase — not just the diff.

**How it works:**

1. User posts `@openreview <question>` in any PR comment or reply thread
2. GitHub fires `pull_request_review_comment` webhook → Action's `comment-handler.ts`
3. Chat handler fetches: full diff, PR metadata, question context, prior conversation thread
4. Hybrid snapshot: diff files pre-loaded, other files fetched lazily as needed
5. LangGraph.js chat agent answers with full codebase context
6. Response streamed (SSE internally, final answer posted as GitHub comment)
7. 4–5 follow-up question suggestions auto-appended to response

**Acceptance criteria:**

- Response posted within 90 seconds for questions requiring no deep file exploration
- Answers include grounded citations: file path + line number for every claim
- Prior thread context carried forward (conversation is stateful within a PR)
- Follow-up suggestions are ≤ 8 words each, relevant to the question asked
- Bot does not respond to its own comments (loop prevention)
- `@openreview` mention required in every new question (no ambient processing)

**Data model (chat state):**

```typescript
interface ChatState {
  prUrl: string;
  thread: ChatMessage[];
  snapshotFiles: Map<string, string>; // lazily populated
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  timestamp: string;
}
```

---

### 4.6 Linter Integration

**MVP linter set (Phase 1):**

| Linter     | Language(s)            | What it catches                              |
| ---------- | ---------------------- | -------------------------------------------- |
| ESLint     | JavaScript, TypeScript | Syntax errors, common bugs, bad patterns     |
| Ruff       | Python                 | Fast Python linting (replaces Flake8/Pylint) |
| Semgrep    | Multi-language         | Security vulnerabilities, SAST patterns      |
| ShellCheck | Bash/Shell             | Shell script bugs and portability issues     |
| Gitleaks   | All                    | Hardcoded secrets and API keys               |

**How it works:**

- Linters run in parallel on changed files only (not the full repo)
- Each linter runs in an isolated child process with a 30-second timeout
- Linter output parsed into `ReviewFinding[]` objects
- Merged with AI findings (same file+line = deduplicated, source = 'both')

**Acceptance criteria:**

- Linters run in parallel, total linter step completes in < 30 seconds
- If a linter is not installed on the system, it is skipped with a warning (not a fatal error)
- Linter findings are clearly labeled with the linter name in the GitHub comment
- Each linter enabled/disabled via `.env`: `LINTER_ESLINT=true`, `LINTER_RUFF=true`, etc.

---

### 4.7 Instruction File Reading

**User story:** As a team, I want to define our coding standards in a `REVIEW.md` file and have OpenReview automatically apply them during every review.

**Files read automatically (in priority order):**

1. `REVIEW.md` (any directory level — recursive glob `**/REVIEW.md`)
2. `AGENTS.md`
3. `CLAUDE.md`
4. `.cursorrules`
5. `.windsurfrules`

**Acceptance criteria:**

- All instruction files found in the repository are concatenated and passed as system context to the LLM
- Files at subdirectory level are applied to code in that subtree only (hierarchical scope)
- Total instruction content capped at 10,000 tokens to prevent prompt overflow
- If no instruction files found, review proceeds with built-in default prompt only

---

### 4.8 Persistent Learnings Database

**User story:** As a team, I want OpenReview to remember when we've told it a finding was a false positive, so it doesn't repeat the same mistake.

**How it works:**

- When a user replies to a bot finding comment saying "this is expected" or "ignore this", the bot learns
- Trigger phrases (configurable): "ignore this", "false positive", "this is expected", "not an issue"
- Learning stored in `~/.openreview/learnings/<org>-<repo>.json`
- On subsequent reviews, learnings are loaded and injected into the system prompt

**Data model:**

```typescript
interface Learning {
  id: string;
  repoSlug: string; // "org/repo"
  trigger: string; // The comment text that created this learning
  finding: string; // Description of what to ignore/remember
  createdAt: string;
  usedCount: number;
  lastUsedAt: string | null;
}
```

**Acceptance criteria:**

- Learnings file created automatically on first learning
- Bot acknowledges learning: "Got it! I'll remember this for future reviews."
- Learnings injected into review prompt on every subsequent review for that repo
- Max 50 learnings per repo (oldest unused pruned when limit hit)
- User can list learnings via `@openreview list learnings`
- User can delete a learning via `@openreview forget: <learning description>`

---

### 4.9 Audit Trail (JSON Trace Logs)

**Acceptance criteria:**

- Every review (Fast or RLM) produces a trace file: `~/.openreview/traces/<timestamp>-<pr-number>.json`
- Fast mode trace includes: PR metadata, files reviewed, linter output, LLM prompt/response, findings, duration
- RLM mode trace includes: all of above + every iteration (reasoning, code written, sandbox output, citations)
- Traces never contain secrets or API keys
- Traces retained indefinitely (user responsible for cleanup)
- `npx openreview traces --pr <url>` lists all traces for a given PR

---

### 4.10 GitHub Comment Strategy

**Acceptance criteria:**

- All findings submitted as a single GitHub review object via `POST /repos/{owner}/{repo}/pulls/{pr}/reviews`
- Review state: `COMMENT` (not `APPROVE` or `REQUEST_CHANGES`) by default
- Each finding posted as an inline review comment (`path`, `line`, `body`)
- Summary comment posted as a separate top-level PR comment (not part of the review object)
- Summary comment format:

  ```
  ## OpenReview Summary
  **Files reviewed:** 12 | **Duration:** 34s | **Mode:** Fast

  | Severity | Count |
  |---|---|
  | 🔴 Bug — Severe | 2 |
  | 🟠 Bug — Non-severe | 3 |
  | 🔍 Investigate | 1 |
  | ℹ️ Informational | 4 |

  ---
  *Trigger deep review: `@openreview rlm` | Ask a question: `@openreview <your question>`*
  ```

- Bot uses `GITHUB_TOKEN` (Action) or `GITHUB_PAT` (CLI) for all API calls
- No duplicate summary comments — existing summary updated in place (replace-not-duplicate strategy using HTML marker tags)

---

### 4.11 Configuration (.env)

**Full `.env.example`:**

```bash
# LLM Provider (set the key for your chosen provider)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# Model selection
MAIN_MODEL=gpt-4o           # Primary model for deep review and chat
SUB_MODEL=gpt-4o-mini       # Secondary model for summarization and suggestions

# Review limits
MAX_ITERATIONS=12            # Max RLM loop iterations
MAX_LLM_CALLS=35             # Max total LLM calls per RLM session
MAX_FILES=100                # Max files per review
MAX_FILE_BYTES=200000        # Max bytes per individual file in snapshot
MAX_TOTAL_BYTES=5000000      # Max total snapshot size

# File filtering
INCLUDE_GLOBS=               # e.g. "src/**/*.ts,src/**/*.py"
EXCLUDE_GLOBS=               # e.g. "dist/**,node_modules/**"

# Linters (true/false)
LINTER_ESLINT=true
LINTER_RUFF=true
LINTER_SEMGREP=true
LINTER_SHELLCHECK=true
LINTER_GITLEAKS=true

# Review behavior
REVIEW_DRAFTS=false          # Review draft PRs (default: skip)
MOVE_DETECTION_THRESHOLD=0.8 # Similarity threshold for copy/move detection
DEFAULT_REVIEW_MODE=fast     # fast | rlm

# GitHub (CLI mode)
GITHUB_PAT=                  # Personal Access Token for CLI use

# Storage
OPENREVIEW_HOME=~/.openreview # Base path for learnings + traces
```

---

### 4.12 SKILL.md (Agent Ecosystem)

**Acceptance criteria:**

- `SKILL.md` at repo root enables installation as a skill in: Claude Code, Cursor, Gemini CLI, Codex
- Skill triggers automatically when an agent detects a GitHub PR URL in context
- `--expert` flag in skill definition triggers comprehensive SOLID + security + quality review
- Skill verifies `GITHUB_TOKEN` or `GITHUB_PAT` is available before running
- Skill outputs severity-tagged findings with suggested fixes in markdown format

---

## 5. Non-Functional Requirements

| Requirement                 | Target                                                       |
| --------------------------- | ------------------------------------------------------------ |
| Fast mode review completion | < 60 seconds (≤ 100 files)                                   |
| RLM mode completion         | < 5 minutes (typical PR)                                     |
| Chat response time          | < 90 seconds                                                 |
| Bot acknowledgement         | < 5 seconds of receiving event                               |
| Linter step completion      | < 30 seconds (parallel execution)                            |
| API rate limiting           | Respect GitHub's 5,000 req/hr limit via axios retry/throttle |
| Max files per review        | 100 (configurable via MAX_FILES)                             |
| Zero data retention         | Code/diffs never persisted post-review                       |
| Offline capability          | CLI works without server if LLM API is reachable             |
| Node.js version             | LTS (24.x recommended, ≥ 20 supported)                       |
| GitHub Actions runner       | ubuntu-latest, macos-latest, windows-latest                  |

---

## 6. MVP Success Metrics

| Metric      | Target                                                                          |
| ----------- | ------------------------------------------------------------------------------- |
| Functional  | Reviews a real public GitHub PR end-to-end (finds posted as GitHub comments)    |
| Performance | Fast mode completes in < 60 seconds                                             |
| Quality     | Catches ≥ 8 real bugs per 10 PRs (validated against test PRs with known issues) |
| Adoption    | 10 GitHub stars within 2 weeks of public launch                                 |

---

## 7. Out of Scope (MVP)

- Web UI (Phase 2)
- IDE extension (Phase 3)
- Auto-fix application / branch commits (Phase 2)
- PR walkthrough summary / sequence diagrams / release notes (Phase 2)
- Jira / Linear / Slack integrations (Phase 2)
- GitLab / Azure DevOps / Bitbucket / GitHub Enterprise (Phase 3)
- Analytics dashboard (Phase 3)
- GitHub App bot identity (Phase 3)
- Docker sandbox (Phase 2)
- MCP server integration (Phase 3)
- `.reviewbuddy.yaml` per-repo config (Phase 2)
- Central org-wide config repo (Phase 3)
- Local directory review (`--path` flag for reviewing local code without GitHub PR) (Phase 2)
- GitHub Issue review (`/issues/` URL support alongside `/pull/`) (Phase 2)

---

_PRD v1.3 — OpenReview — 2026-03-24_
