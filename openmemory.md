# OpenReview — Project Memory Guide

> **project_id:** deuex-solutions/OpenReview
> **Last updated:** 2026-03-23
> **Phase:** 1 (MVP) — Weeks 1–3 complete, Week 4 in backlog

---

## Overview

OpenReview is an open-source, agentic code review tool — AI-powered bug detection with sandboxed code execution, codebase-aware chat, and full GitHub workflow integration. Distributed as `npx openreview` CLI + GitHub Action. MIT licensed.

**Repository:** github.com/deuex-solutions/OpenReview
**Language:** TypeScript (strict mode, ESM-only)
**Runtime:** Node.js ≥ 20
**Package manager:** pnpm 10.x (monorepo workspaces)

---

## Architecture

### Monorepo Workspaces

| Package   | npm Name             | Role                                                         | Status              |
| --------- | -------------------- | ------------------------------------------------------------ | ------------------- |
| `core/`   | `@openreview/core`   | Review engine — all business logic, LLM calls, GitHub API    | Active (private)    |
| `cli/`    | `openreview`         | CLI wrapper (commander) — `review`, `ask`, `serve`, `traces` | Scaffold only       |
| `action/` | `@openreview/action` | GitHub Action entry point — PR + comment event handlers      | Scaffold only       |
| `web/`    | —                    | React 19 + Vite 8 web UI                                     | Phase 2 placeholder |

**Dependency flow:** `cli/` → `core/` ← `action/` (core is the shared dependency, never depends on cli/action)

### Build & Tooling

| Tool       | Version | Purpose                                                                           |
| ---------- | ------- | --------------------------------------------------------------------------------- |
| TypeScript | 5.9.x   | Strict mode, ES2022 target, Node16 module resolution                              |
| tsdown     | 0.21.x  | Bundling (ESM + CJS with .d.ts). Replaces tsup (unmaintained)                     |
| Vitest     | 4.1.x   | Testing. Replaces Jest (native ESM support)                                       |
| ESLint     | 10.x    | Flat config only (`eslint.config.js`). `import-x` plugin enforces import ordering |
| Prettier   | 3.8.x   | Formatting — single quotes, 100 char width, trailing commas                       |

---

## Components

### core/src/config/ — Configuration System ✅

| File              | Exports                                                                    | Purpose                                                                                                  |
| ----------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `env.ts`          | `loadConfig()`, `validateConfig()`, `config` singleton, `OpenReviewConfig` | Loads `.env` via dotenv, typed config object with defaults, validates API keys                            |
| `instructions.ts` | `findInstructionFiles()`, `loadInstructions()`                             | Globs for REVIEW.md/AGENTS.md/CLAUDE.md/.cursorrules/.windsurfrules, hierarchical scoping, 10k token cap |

### core/src/github/ — GitHub API Layer ✅

| File          | Exports                                                                                    | Purpose                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`   | `GitHubClient` class, `parsePRUrl()`, `getIssueComments()`, `PRMetadata`, `PRFile`         | Axios-based GitHub API client with rate-limit handling (403 + X-RateLimit-Remaining detection), 5xx retry (3x exponential backoff), 30s timeout, pagination, null-safe comment normalization    |
| `diff.ts`     | `parseDiff()`, `detectMovesAndCopies()`, `filterDiffs()`                                   | Unified diff parser, Jaccard similarity-based copy/move detection (threshold: 0.8), include/exclude glob filtering                                                                             |
| `comments.ts` | `CommentPoster` class, re-exports from `review/types.ts` + `review/formatter.ts`           | Batch review posting (single `POST /pulls/{pr}/reviews`), summary comment with replace-not-duplicate via `<!-- openreview-summary -->` HTML marker, chat reply via `/issues/{pr}/comments`, acknowledgement |

### core/src/llm/ — LLM Router ✅

| File        | Exports                                                                                | Purpose                                                                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `router.ts` | `createLLM()`, `createMainLLM()`, `createSubLLM()`, `detectProvider()`, `streamChat()` | Provider auto-detection from model string prefix (`gpt-*` → OpenAI, `claude-*` → Anthropic, `gemini-*` → Google), LangChain model instantiation, streaming support, custom OpenAI-compatible endpoint via `OPENAI_BASE_URL` |

### core/src/review/ — Review Engine ✅

| File              | Exports                                                                                                                            | Purpose                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`        | `ReviewFinding`, `ReviewSummary`, `PRContext`, `Citation`, `FindingSeverity`, `FindingCategory`, `FindingSource`, `sortFindings()` | **Canonical type definitions** — single source of truth. Severity ordering: severe → non-severe → investigate → informational                                                                                                                            |
| `formatter.ts`    | `formatSummaryComment()`, `formatInlineComment()`                                                                                  | Markdown formatters — severity badges (🔴🟠🔍ℹ️), severity breakdown table, GitHub `suggestion` syntax for fixes, linter attribution labels, trigger hints                                                                                               |
| `linters.ts`      | `runLinters()`, `deduplicateFindings()`, individual parsers                                                                        | Parallel linter execution (Promise.allSettled, 30s timeout each). Parsers: `parseEslintOutput`, `parseRuffOutput`, `parseSemgrepOutput`, `parseShellcheckOutput`, `parseGitleaksOutput`. All hardened against malformed JSON. ENOENT → skip with warning |
| `fast-review.ts`  | `runFastReview()`, `parseLLMResponse()`, `extractDiffLineMap()`                                                                    | Fast mode orchestrator: linters → structured LLM prompt (system + human) → robust JSON parsing (code fences, embedded arrays) → citation validation against diff line map → deduplication → severity sort                                                |
| `snapshot.ts`     | `SnapshotBuilder` class, `SnapshotOptions`                                                                                         | Hybrid lazy file loader for RLM mode — in-memory cache with in-flight dedup, per-file and total byte caps, binary detection, lazy file tree from GitHub API                                                                                              |
| `rlm-runner.ts`   | `runRLM()`, `RLMEvent`, `RLMEventHandler`, `RLMEventType`                                                                         | RLM deep mode LangGraph agentic loop: reason → code_writer → sandbox → observe → finalize. Max iteration/LLM call limits, finish_review signal, FETCH_FILE requests, event streaming                                                                    |

### core/src/chat/ — Codebase-Aware Chat ✅

| File               | Exports                                                    | Purpose                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat-handler.ts`  | `handleChatMention()`, `CommentEvent`, `ChatContext`       | Handles `@openreview` mentions in PR comments — question extraction, thread history loading via `getIssueComments()`, streaming LLM response, citation validation, bot loop prevention, empty answer guard |
| `suggestions.ts`   | `generateSuggestions()`                                    | Generates 4–5 follow-up questions (≤ 8 words each) using sub LLM, appended as blockquote list to chat replies                                                              |

### core/src/learnings/ — Persistent Learnings DB ✅

| File                  | Exports                                                           | Purpose                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `learnings-store.ts`  | `LearningsStore` class, `containsTrigger()`, `formatLearningsForPrompt()`, `Learning` | JSON-file CRUD per repo (`~/.openreview/learnings/<org>-<repo>.json`), trigger phrase detection ("false positive", "ignore this", etc.), max 50 learnings with auto-pruning of oldest unused, usage tracking, prompt injection with 2k token cap |

### core/src/sandbox/ — Deno Sandbox ✅

| File              | Exports                                              | Purpose                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deno-runner.ts`  | `executeSandboxed()`, `verifyDenoInstallation()`, `SandboxResult` | Deno 2.7+ sandboxed code execution with explicit permission flags (`--allow-read`, `--deny-net`, `--deny-write`, `--deny-env`, `--deny-run`), 30s hard timeout via AbortController, GLOBALS injection, env variable stripping to prevent secret leakage |

### core/src/server/ — Express API Server 🔲

Placeholder. Will contain Express 5 internal API for future web UI.

### core/src/trace/ — JSON Trace Logger ✅

| File         | Exports                                           | Purpose                                                                                                                                                                     |
| ------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logger.ts`  | `TraceLogger` class, `TraceEntry`, `TraceMeta`    | Per-review trace files at `~/.openreview/traces/<timestamp>-<owner>-<repo>-<pr>.json`. Logs fast review entries, RLM iterations, findings, and session metadata. Secret scrubbing (OpenAI/GitHub/Slack keys). Best-effort write (try/catch on close) |

---

## Key Patterns

### Type Ownership

All review types are defined in `core/src/review/types.ts`. Other modules (e.g., `github/comments.ts`) re-export from there. Never duplicate type definitions.

### Import Ordering

Enforced by `eslint-plugin-import-x`: `builtin → external → internal → parent → sibling`. Blank line between each group. Type imports sort after value imports. All internal imports use `.js` extensions (ESM requirement).

### Finding Flow

**Fast mode:**
```
PR Event
  → GitHubClient.getPRDiff() + getPRFiles()
  → filterDiffs() (include/exclude globs)
  → runLinters() (parallel, 30s timeout, skip if binary missing)
  → createMainLLM() → structured prompt → parseLLMResponse()
  → extractDiffLineMap() → citation validation (reject hallucinated lines)
  → deduplicateFindings() (AI + linter overlap by file + line range → source: 'both')
  → sortFindings() (severe first)
  → CommentPoster.postReview() (single batch) + postSummaryComment() (replace-not-duplicate)
```

**RLM deep mode:**
```
PR Event
  → SnapshotBuilder (pre-load diff files, lazy fetch others)
  → LangGraph StateGraph: reason → code_writer → sandbox → observe → repeat
  → Edge conditions: MAX_ITERATIONS / MAX_LLM_CALLS / finish_review signal → finalize
  → finalize_node → parseRLMFindings() → grounded findings with citations
  → CommentPoster.postReview() + postSummaryComment()
```

### Chat Flow

```
@openreview <question> comment
  → extractQuestion() (strip mention prefix)
  → loadThreadHistory() via getIssueComments()
  → buildChatMessages() (system + thread history + question + diff)
  → streamChat() → collect answer
  → validateAnswerCitations() against snapshot
  → generateSuggestions() (sub LLM, ≤ 8 words each)
  → CommentPoster.postChatReply()
```

### Linter Parser Hardening

All parsers validate entry shape before accessing nested fields (e.g., `if (!d?.file || !d?.line) continue`). This prevents crashes on malformed JSON output from linter child processes that exit with code 1.

### Comment Strategy

- Findings → single `POST /pulls/{pr}/reviews` with `event: 'COMMENT'` (never APPROVE or REQUEST_CHANGES)
- Summary → top-level PR comment with `<!-- openreview-summary -->` marker for update-in-place
- Chat → reply via `POST /issues/{prNumber}/comments`

### Sandbox Security

- Deno runs with `--allow-read` only, explicit `--deny-net/write/env/run`
- Environment stripped to PATH/HOME/DENO_DIR only — no inherited API keys
- 30s hard timeout via AbortController
- GLOBALS object injected as serialized JSON constant

---

## User Defined Namespaces

- core
- cli
- action
- config
- github-api
- review-engine
- llm
- chat
- learnings
- sandbox
- trace

---

## Test Coverage

320 tests across 22 test files in centralized `tests/` directory. All tests run from `tests/core/` mirroring the source module structure.

### Test Structure

```
tests/core/
├── config/     (28 tests)  — env parsing, defaults, validation, instruction file discovery
├── github/     (32 tests)  — URL parsing, pagination, diff parsing, move/copy detection, comment posting, null-safety
├── llm/        (20 tests)  — provider detection, createLLM for all 3 providers, baseURL, streamChat chunking
├── review/     (175 tests) — linter parsers (5×), orchestration, deduplication, LLM response parsing, citation validation, fast-review integration, formatters, severity sorting, snapshot caching/concurrency, RLM deep mode
├── chat/       (13 tests)  — mention handling, bot loop prevention, empty answer guard, follow-up suggestions
├── learnings/  (17 tests)  — CRUD, pruning, trigger detection, prompt formatting, token cap
├── sandbox/    (20 tests)  — Deno verification, permission flags, timeout, env stripping, exit codes, edge cases
└── trace/      (18 tests)  — file creation, JSON structure, all secret formats (sk-/ghp_/ghs_/xoxb-), idempotent close
```

### Key Test Patterns

- **Unit tests:** All linter parsers (valid + malformed + empty + null), LLM response parsing (code fences, embedded text, missing fields), diff line map extraction, severity sorting
- **Integration tests:** `runFastReview()` end-to-end (citation validation, dedup, sorting, summary), `runRLM()` (iteration limits, finish signal, event streaming, code blocks, FETCH_FILE)
- **Orchestration tests:** `runLinters()` (enable/disable, graceful failure), `CommentPoster` (batch review, summary create/update, pagination)
- **Edge case tests:** Concurrent snapshot access, empty LLM responses, deleted GitHub users, exit code extraction, Deno version boundaries, large globals, secret scrubbing formats
- **Security tests:** Sandbox permission flags, env variable stripping, trace secret redaction

---

## Bugs Found & Fixed (Week 3 QA)

| # | Severity | Module | Fix |
|---|----------|--------|-----|
| 1 | Bug | `comments.ts` | `postChatReply` was POSTing to invalid GitHub endpoint — fixed to `/issues/{prNumber}/comments` |
| 2 | Security | `deno-runner.ts` | Added explicit `--deny-net/write/env/run` flags (was relying on Deno defaults) |
| 3 | Bug | `chat-handler.ts` | Replaced private `client['api']` access with public `getIssueComments()` method |
| 4 | Bug | `snapshot.ts` | Used `ParsedDiff.newPath` (non-existent) — fixed to `ParsedDiff.file` |
| 5 | Bug | `client.ts` | `getIssueComments` crashed on deleted users (null `user`) — added null-safety filter |
| 6 | Bug | `snapshot.ts` | Concurrent `getFile` calls caused double-fetching — added in-flight promise tracking |
| 7 | Bug | `learnings-store.test.ts` | Floating promise — assertions never ran — fixed to `async`/`await` |
| 8 | Bug | `suggestions.test.ts` | Error-path test was testing empty-answer instead of LLM throw — fixed mock |
| 9 | Edge | `chat-handler.ts` | Empty LLM response posted blank reply — added guard |
| 10 | Edge | `trace/logger.ts` | `writeFileSync` in `close()` could crash review — added try/catch |

---

## Progress

| Phase | Week | Status      | Key Deliverables                                                                         |
| ----- | ---- | ----------- | ---------------------------------------------------------------------------------------- |
| 1     | 1    | ✅ Complete | Monorepo scaffold, config system, GitHub client, diff parser, comment poster, LLM router |
| 1     | 2    | ✅ Complete | Review types, fast review engine, linter orchestration, formatters, SETUP.md             |
| 1     | 3    | ✅ Complete | Deno sandbox, hybrid snapshot, RLM loop, trace logger, chat handler, learnings store, 320 tests, comprehensive QA |
| 1     | 4    | 🔲 Backlog  | CLI commands, GitHub Action handlers, SKILL.md, README, final testing & launch           |

Planning docs: `progress-docs/` (PRD, Milestones, TodoList, Feature Spec)
Weekly breakdowns: `local-docs/phase1-week{1-4}-todo.md`
