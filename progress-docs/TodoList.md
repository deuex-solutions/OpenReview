# OpenReview — Phase-wise Deep To-Do List

> Version 1.2 | 2026-03-24
> Structure: Phase → Feature → Task
> Audience: Solo Founder / Technical Lead
> Status: Phase 1 Weeks 1-4 complete. Sections 1-14.5 done (100% of core features). Section 16 (Impact Analysis) and launch checklist (Section 15) pending.

---

## Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked / needs decision

---

# PHASE 1 — MVP (4 Weeks)

---

## 1. Repository & Project Scaffold

### 1.1 Monorepo Setup

- [x] Create GitHub repository `openreview` (public, MIT license)
- [x] Initialize root `package.json` with pnpm workspaces (`core`, `cli`, `action`)
- [x] Add `pnpm-lock.yaml` and `.gitignore` (node_modules, dist, .env, \*.json.trace)
- [x] Create `tsconfig.base.json` with strict TypeScript settings (target ES2022, moduleResolution Node16)
- [x] Create per-package `tsconfig.json` extending base in `core/`, `cli/`, `action/`
- [x] Configure `tsdown` in each package for bundling (`dist/index.js`, CJS + ESM dual output)
- [x] Configure Vitest (`vitest.config.ts`) with workspace-aware test discovery and native ESM support
- [x] Configure ESLint 10 (`eslint.config.js` flat config) — TypeScript rules, import ordering, no-unused-vars
- [x] Configure Prettier (`.prettierrc`) — single quotes, 100 char line width, trailing commas
- [x] Add `.env.example` with all environment variables documented
- [x] Add `web/` directory with `.gitkeep` (Phase 2 placeholder)
- [x] Create `.github/workflows/ci.yml` — runs `pnpm lint`, `pnpm typecheck`, `pnpm test` on push and PR
- [x] Create `.github/workflows/release.yml` — publishes to npm and creates GitHub release on version tag
- [x] Verify pnpm workspaces resolve correctly: `pnpm --filter core build` etc.

### 1.2 Folder Structure

- [x] Create `core/src/review/` directory
- [x] Create `core/src/github/` directory
- [x] Create `core/src/chat/` directory
- [x] Create `core/src/learnings/` directory
- [x] Create `core/src/sandbox/` directory
- [x] Create `core/src/config/` directory
- [x] Create `core/src/server/` directory
- [x] Create `cli/src/commands/` directory
- [x] Create `action/src/` directory
- [x] Create `SKILL.md`, `REVIEW.md`, `LICENSE` at root

---

## 2. Core Configuration System

### 2.1 Environment Variable Loader (`core/src/config/env.ts`)

- [x] Install `dotenv` (v17.x) in `core`
- [x] Export typed config object from `.env` with defaults
- [x] Validate required vars at startup: at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- [x] Throw descriptive error if no LLM API key is set
- [x] Parse `INCLUDE_GLOBS` and `EXCLUDE_GLOBS` as string arrays (comma-separated)
- [x] Parse boolean vars (`REVIEW_DRAFTS`, `LINTER_ESLINT`, etc.) with `true`/`false` string handling
- [x] Expand `~` in `OPENREVIEW_HOME` to absolute path
- [x] Export: `config.mainModel`, `config.subModel`, `config.maxIterations`, `config.maxFiles`, etc.
- [x] Unit test: config defaults, missing key errors, boolean parsing

### 2.2 Instruction File Reader (`core/src/config/instructions.ts`)

- [x] Implement `findInstructionFiles(repoPath: string): Promise<InstructionFile[]>`
- [x] Glob patterns to search: `**/REVIEW.md`, `**/AGENTS.md`, `**/CLAUDE.md`, `**/.cursorrules`, `**/.windsurfrules`
- [x] For each file found: record the file path and its directory depth
- [x] Apply hierarchical scoping: files at root = global; files in subdirs = scoped to that subtree
- [x] Concatenate all instruction content in priority order
- [x] Cap total instruction content at 10,000 tokens (use tiktoken or character approximation)
- [x] Return `{ globalInstructions: string, scopedInstructions: Map<string, string> }`
- [x] Unit test: finds files at correct depths, caps content, empty repo returns defaults

---

## 3. GitHub API Client

### 3.1 GitHub Client (`core/src/github/client.ts`)

- [x] Install `axios` (v1.13.x) in `core`
- [x] Create `GitHubClient` class taking `{ token: string, owner: string, repo: string }`
- [x] Implement `getPR(prNumber: number): Promise<PRMetadata>`
- [x] Implement `getPRFiles(prNumber: number): Promise<PRFile[]>` — paginate (100 items/page)
- [x] Implement `getPRDiff(prNumber: number): Promise<string>` — raw unified diff
- [x] Implement `getFileContent(path: string, ref: string): Promise<string>` — lazy file fetcher
- [x] Implement `getFileTree(ref: string): Promise<string[]>` — list all file paths at a ref
- [x] Add axios interceptor for rate limit handling: detect 403 + `X-RateLimit-Remaining: 0`, wait until `X-RateLimit-Reset`
- [x] Add axios interceptor for retry on 5xx (max 3 retries, exponential backoff)
- [x] Add 30-second timeout on all requests
- [x] Parse PR URL: extract owner, repo, PR number via regex
- [x] Unit test: URL parsing, pagination logic (mock axios), rate limit detection

### 3.2 Diff Parser (`core/src/github/diff.ts`)

- [x] Implement `parseDiff(rawDiff: string): ParsedDiff[]`
- [x] `ParsedDiff`: `{ file, status, hunks: Hunk[], addedLines: Line[], deletedLines: Line[] }`
- [x] Implement copy/move detection: `detectMovesAndCopies(diffs: ParsedDiff[]): MoveEvent[]`
  - [x] Tokenize added and deleted blocks
  - [x] Compute Jaccard similarity between deleted blocks in file A and added blocks in file B
  - [x] Classify as move if similarity > `MOVE_DETECTION_THRESHOLD` (default 0.8) AND source block is absent
  - [x] Classify as copy if source block still present
- [x] Apply `INCLUDE_GLOBS` / `EXCLUDE_GLOBS` file filtering
- [x] Unit test: parse standard unified diff, detect known move, detect known copy, respect globs

### 3.3 Comment Poster (`core/src/github/comments.ts`)

- [x] Implement `postReview(prNumber, findings: ReviewFinding[]): Promise<void>`
  - [x] Batch all inline comments into single `POST /pulls/{pr}/reviews` call
  - [x] Review state: `COMMENT` (never auto-approve or request changes)
- [x] Implement `postSummaryComment(prNumber, summary: ReviewSummary): Promise<void>`
  - [x] Search existing PR comments for HTML marker tag `<!-- openreview-summary -->`
  - [x] If found: update existing comment (`PATCH /issues/comments/{id}`)
  - [x] If not found: create new comment (`POST /issues/{pr}/comments`)
- [x] Implement `postChatReply(commentId, reply: string): Promise<void>`
- [x] Implement `postAcknowledgement(prNumber, message: string): Promise<void>`
- [x] Format summary comment markdown (severity table, file count, duration, trigger hints)
- [x] Format inline comment markdown (severity badge, explanation, suggested fix code block)
- [x] Unit test: replace-not-duplicate logic, summary format, inline comment format

---

## 4. LLM Router & LangGraph Setup

### 4.1 LLM Router (`core/src/llm/router.ts`)

- [x] Install `@langchain/core` (1.1.x), `@langchain/openai` (1.2.x), `@langchain/anthropic` (1.3.x), `@langchain/google-genai` (2.1.x), `@langchain/langgraph` (1.2.x) in `core`
- [x] Implement `createLLM(modelId: string): BaseChatModel`
  - [x] Parse model string prefix: `gpt-*` → OpenAI, `claude-*` → Anthropic, `gemini-*` → Google
  - [x] Instantiate correct LangChain model class with API key from config
  - [x] Support any OpenAI-compatible endpoint via `OPENAI_BASE_URL`
- [x] Implement `createMainLLM()` and `createSubLLM()` using config values
- [x] Add streaming support: return `AsyncIterable<string>` from chat calls
- [x] Unit test: model string parsing, correct class instantiation per provider

---

## 5. Fast Mode Review

### 5.1 Linter Orchestration (`core/src/review/linters.ts`)

- [x] Implement `runLinters(files: string[], repoPath: string): Promise<ReviewFinding[]>`
- [x] For each enabled linter, spawn child process with 30-second timeout
- [x] Run all linters in parallel (`Promise.allSettled`)
- [x] **ESLint**: `npx eslint --format json <files>` — parse JSON output into findings
- [x] **Ruff**: `ruff check --output-format json <files>` — parse JSON output
- [x] **Semgrep**: `semgrep --json <files>` — parse JSON output
- [x] **ShellCheck**: `shellcheck --format=json <files>` — parse JSON output
- [x] **Gitleaks**: `gitleaks detect --source . --report-format json` — parse JSON output
- [x] If linter binary not found: skip with `console.warn`, not fatal error
- [x] Map linter output fields to `ReviewFinding` interface
- [x] Deduplicate against AI findings: same file + same line range = merge into `source: 'both'`
- [x] Unit test: each linter parser with sample output fixtures, timeout handling, binary-not-found handling

### 5.2 Fast Review Engine (`core/src/review/fast-review.ts`)

- [x] Implement `runFastReview(pr: PRContext): Promise<ReviewFinding[]>`
- [x] Build structured prompt:
  - System: role + instruction file content
  - Human: PR metadata + full diff + linter findings
  - Request: JSON array of findings with schema
- [x] Call `createMainLLM()` with structured output (JSON mode / function calling)
- [x] Parse LLM response into `ReviewFinding[]`
- [x] Validate citations: only cite lines visible in the diff (reject hallucinated line numbers)
- [x] Merge with linter findings (deduplication)
- [x] Return sorted findings: Severe first, then Non-severe, Investigate, Informational
- [x] Unit test: prompt construction, citation validation, finding sort order, JSON parse error handling

---

## 6. RLM Deep Mode ✅ COMPLETE (2026-03-24)

### 6.1 Deno Sandbox (`core/src/sandbox/deno-runner.ts`) ✅ COMPLETE

- [x] Verify Deno 2.7+ installation at startup; throw descriptive error if missing
- [x] Implement `executeSandboxed(code: string, globals: Record<string, unknown>): Promise<SandboxResult>`
- [x] Inject `globals` as Deno script context (file contents, PR metadata)
- [x] Run with `--allow-read` only (no network, no write, no env) — also explicit `--deny-net`, `--deny-env`, `--deny-run`
- [x] 30-second hard timeout via `AbortController` (15s default, customizable)
- [x] Capture stdout, stderr separately (10MB buffer)
- [x] Return `{ stdout, stderr, exitCode, duration }`
- [x] Unit test: successful execution, timeout handling, read-only enforcement, syntax error handling

### 6.2 Hybrid Snapshot (`core/src/review/snapshot.ts`) ✅ COMPLETE

- [x] Implement `SnapshotBuilder` class
- [x] Constructor: load diff files immediately (pre-fetched from GitHub API)
- [x] Implement `getFile(path: string): Promise<string>` — lazy fetcher
  - [x] Check in-memory cache first
  - [x] Fetch from GitHub API if not cached (with inflight promise dedup)
  - [x] Cache result for duration of review session
  - [x] Respect `MAX_FILE_BYTES` limit
  - [x] Return empty string for binary files (null byte detection on first 8KB)
- [x] Implement `listFiles(): Promise<string[]>` — fetch full file tree from GitHub API (lazy, cached)
- [x] Respect `MAX_TOTAL_BYTES` cap across all fetched files
- [x] Unit test: cache hit, cache miss + fetch, size limit enforcement

### 6.3 RLM Loop (`core/src/review/rlm-runner.ts`) ✅ COMPLETE

- [x] Define LangGraph state schema: `{ messages, iterations, llmCalls, files, findings, done }`
- [x] Implement `reason_node`: calls `createMainLLM()` with current state, returns reasoning + next action
- [x] Implement `code_writer_node`: extracts code block from reasoning output
- [x] Implement `sandbox_node`: calls `executeSandboxed()` with written code + snapshot globals
- [x] Implement `observe_node`: appends sandbox output to state messages
- [x] Implement `finalize_node`: calls LLM to produce final findings from all observations
- [x] Define edge conditions:
  - [x] `iterations >= MAX_ITERATIONS` → finalize
  - [x] `llmCalls >= MAX_LLM_CALLS` → finalize
  - [x] LLM calls `finish_review` tool → finalize
  - [x] Otherwise → reason_node
- [x] Compile LangGraph: `StateGraph → CompiledGraph` (recursion limit = maxIterations * 5 + 10)
- [x] Implement `runRLM(pr: PRContext, snapshot: SnapshotBuilder): Promise<ReviewFinding[]>`
- [x] Stream iteration events (for acknowledgement comment updates) — `RLMEventHandler` callback
- [x] Unit test: iteration limit enforcement, finalize triggers, state transitions

---

## 7. JSON Trace Logger ✅ COMPLETE (2026-03-24)

### 7.1 Trace Logger (`core/src/trace/logger.ts`) ✅ COMPLETE

- [x] Implement `TraceLogger` class
- [x] Constructor: create trace file at `~/.openreview/traces/<timestamp>-<owner>-<repo>-<pr>.json`
- [x] Implement `logFastReview(input, output, duration)`: write fast review trace entry
- [x] Implement `logRLMIteration(iteration, reasoning, code, sandboxOutput)`: append iteration
- [x] Implement `logFindings(findings)`: append final findings
- [x] Implement `close()`: write final metadata (total duration, LLM call count)
- [x] Ensure no API keys or tokens appear in trace files (scrub before write) — regex patterns for OpenAI, GitHub PAT, Slack tokens, generic secrets
- [x] Create `~/.openreview/traces/` directory if it doesn't exist
- [x] Unit test: file creation, scrubbing secrets, correct JSON structure

---

## 8. Codebase-Aware Chat ✅ COMPLETE (2026-03-24)

### 8.1 Chat Handler (`core/src/chat/chat-handler.ts`) ✅ COMPLETE

- [x] Implement `handleChatMention(event: CommentEvent): Promise<void>`
- [x] Extract question from comment text (strip `@openreview` prefix)
- [x] Load conversation thread history for the PR (fetch prior comment chain, last 10)
- [x] Build chat context: question + thread history + diff + snapshot (lazy)
- [x] Create LangGraph chat agent with snapshot tools (`get_file`, `search_files`, `list_files`)
- [x] Stream response (internal SSE → final GitHub comment post)
- [x] Validate all citations in response against actual file contents
- [x] Detect bot's own comments to prevent reply loops (case-insensitive)
- [x] Post final answer as GitHub comment reply in the thread

### 8.2 Follow-up Suggestions (`core/src/chat/suggestions.ts`) ✅ COMPLETE

- [x] Implement `generateSuggestions(answer: string, context: PRContext): Promise<string[]>`
- [x] Call `createSubLLM()` (cheaper model, temperature 0.3) with: answer text + PR context
- [x] Request 4–5 follow-up questions, each ≤ 8 words
- [x] Append suggestions to chat reply as blockquote list
- [x] Unit test: output format, length constraint, empty answer handling

---

## 9. Learnings Database ✅ COMPLETE (2026-03-24)

### 9.1 Learnings Store (`core/src/learnings/learnings-store.ts`) ✅ COMPLETE

- [x] Implement `LearningsStore` class for repo slug
- [x] File path: `~/.openreview/learnings/<org>-<repo>.json`
- [x] Create file + directory on first access
- [x] Implement `add(trigger: string, finding: string): Promise<Learning>`
- [x] Implement `list(): Promise<Learning[]>`
- [x] Implement `delete(id: string): Promise<void>`
- [x] Implement `getAll(): Promise<Learning[]>` — for prompt injection
- [x] Enforce max 50 learnings (prune oldest `usedCount=0` when limit hit; if all used, prune oldest by createdAt)
- [x] Implement `recordUsage(id: string)`: increment `usedCount`, update `lastUsedAt`
- [x] Trigger phrase detection: `containsTrigger(text)` — "ignore this", "false positive", "this is expected", "not an issue", "not a bug", "known issue", "by design", "intentional"
- [x] Unit test: add, list, delete, max limit pruning, trigger detection

### 9.2 Learning Injection ✅ COMPLETE

- [x] In `fast-review.ts` and `rlm-runner.ts`: load all learnings for repo, inject into system prompt
- [x] Format: `## Team Learnings\n- <learning 1>\n- <learning 2>...` via `formatLearningsForPrompt()`
- [x] Cap learnings section at 2,000 tokens (~8000 chars)
- [x] Unit test: injection format, token cap

---

## 10. CLI (`cli/`) ✅ COMPLETE (2026-03-24)

### 10.1 CLI Entry Point (`cli/src/main.ts`)

- [x] Install `commander` (v14.x) in `cli`
- [x] Set up top-level program: `openreview` with version from `package.json`
- [x] Register subcommands: `review`, `ask`, `serve`, `traces`
- [x] Handle `--help` and `--version` flags
- [x] Handle uncaught errors: print friendly message, exit code 1

### 10.2 Review Command (`cli/src/commands/review.ts`)

- [x] `openreview review --url <PR-URL> [options]`
- [x] Options: `--mode <fast|rlm>` (default: fast), `--output <text|markdown|json>`, `--model <model-id>`, `--expert`, `--quiet`
- [x] Parse PR URL → extract owner, repo, PR number
- [x] Validate `.env` config loaded
- [x] Run `runFastReview()` or `runRLM()` based on `--mode`
- [x] `--expert` flag: adds SOLID/security/quality review instructions to system prompt
- [x] Format output via `formatter.ts` and print to stdout
- [x] Progress output to stderr for clean piping

### 10.3 Ask Command (`cli/src/commands/ask.ts`)

- [x] `openreview ask --repo <path> [--url <PR-URL>]`
- [x] Interactive REPL: readline loop
- [x] Commands: `reset` (clear history), `history` (show thread), `files` (list snapshot files), `exit`
- [x] Each input sent to chat handler, response printed with citations

### 10.4 Serve Command (`cli/src/commands/serve.ts`)

- [x] `openreview serve [--port <n>] [--host <host>]`
- [x] Start Express.js server (internal API + future web UI static files)
- [x] Print bound URL on start

### 10.5 Traces Command (`cli/src/commands/traces.ts`)

- [x] `openreview traces --pr <PR-URL>` — list all traces for a PR
- [x] `openreview traces --list` — list all traces (last 20)
- [x] `openreview traces --open <trace-file>` — pretty-print a trace

### 10.6 Output Formatter (`cli/src/formatter.ts`)

- [x] `formatText(findings)` — plain text output, one finding per line
- [x] `formatMarkdown(findings)` — severity-grouped markdown with badges
- [x] `formatJSON(findings)` — raw JSON array

---

## 11. GitHub Action (`action/`) ✅ COMPLETE (2026-03-24)

### 11.1 Action Definition (`action/action.yml`)

- [x] Define all inputs: `github-token`, `openai-api-key`, `anthropic-api-key`, `gemini-api-key`, `main-model`, `sub-model`, `max-files`, `review-drafts`
- [x] Set `runs: using: node24`
- [x] Set `main: dist/index.mjs`
- [x] Add `branding` (icon: eye, color: blue)

### 11.2 Action Entry Point (`action/src/index.ts`)

- [x] Read all inputs via `@actions/core` (v3.x)
- [x] Detect event type: `pull_request` vs `pull_request_review_comment`
- [x] Route to `pr-handler.ts` or `comment-handler.ts`
- [x] Wrap in try/catch: `core.setFailed(error.message)` on error

### 11.3 PR Handler (`action/src/pr-handler.ts`)

- [x] Extract PR number, owner, repo from `github.context.payload`
- [x] Skip if draft PR and `REVIEW_DRAFTS=false`
- [x] Skip if PR description contains `openreview: skip`
- [x] Check for incremental review: compare current commit SHA vs last reviewed SHA (HTML tag in summary comment)
- [x] Post "Review started..." acknowledgement comment
- [x] Run linters + Fast mode review
- [x] Post batch review + summary comment
- [x] Store reviewed commit SHA in summary comment HTML tag

### 11.4 Comment Handler (`action/src/comment-handler.ts`)

- [x] Extract comment text, PR number, comment ID from payload
- [x] Skip if comment author is the bot itself (loop prevention)
- [x] Detect `@openreview rlm` → trigger RLM mode, post findings as review
- [x] Detect `@openreview <question>` (anything else) → trigger chat handler
- [x] Detect trigger phrases for learnings → call `LearningsStore.add()`
- [x] Detect `@openreview list learnings` → post learnings list as comment
- [x] Detect `@openreview forget: <description>` → delete matching learning

---

## 12. SKILL.md ✅ COMPLETE (2026-03-24)

- [x] Write `SKILL.md` at repo root
- [x] Sections: description, prerequisites, usage, examples, `--expert` mode description
- [x] Verify Gemini/OpenAI/Anthropic API key step
- [x] Verify GitHub PAT or GITHUB_TOKEN availability step
- [x] Example commands for Claude Code, Cursor, Gemini CLI, Codex
- [x] `--expert` flag documentation: SOLID, security, quality deep-dive

---

## 13. README & Documentation ✅ COMPLETE (2026-03-24)

- [x] Write `README.md` — setup in < 5 minutes
  - [x] What is OpenReview (1 paragraph)
  - [x] Quick start: GitHub Action setup (copy-paste workflow YAML)
  - [x] Quick start: CLI setup (`npx openreview review --url ...`)
  - [x] Configuration reference (`.env` variables table)
  - [x] Commands reference table
  - [x] How it works (Fast mode, RLM mode, Chat)
  - [x] Instruction files (REVIEW.md, AGENTS.md, etc.)
  - [x] Contributing guide link
  - [x] License badge + link
- [x] Write `REVIEW.md` — OpenReview's own review rules (dogfooding)
- [x] Write `CONTRIBUTING.md` — fork, branch, PR, test requirements

---

## 14. Testing & QA ✅ 95% COMPLETE (2026-03-24)

- [x] Unit tests for every module above (target: > 80% coverage) — 321 tests passing
- [x] Integration test: `npx openreview review --url <public-test-PR>` end-to-end — CLI works (fast + RLM)
- [x] Test PRs: create 10 test PRs with known bugs in different languages — PR #6
  - [x] 2x TypeScript (logic bug, security issue)
  - [x] 2x Python (logic bug, hardcoded secret)
  - [x] 2x Shell (bash bug, security)
  - [x] 2x Terraform/IaC (misconfiguration)
  - [x] 2x multi-file (copy/move scenario)
- [x] Validate: ≥ 8 out of 10 bugs caught — **10/10 caught (18 findings)**
- [x] Validate: Fast mode completes in < 60s on all 10 test PRs — all under 27s
- [!] Manual test: `@openreview rlm` via GitHub comment — deferred to launch (requires live Action)
- [!] Manual test: `@openreview <question>` via GitHub comment — deferred to launch
- [!] Manual test: learnings CRUD via GitHub comment commands — deferred to launch

---

## 14.5 Pre-Launch Feature Gap Closure ✅ COMPLETE (2026-03-24)

### 14.5.1 `--submit` Flag (Post findings as GitHub comment from CLI)

- [x] Add `--submit` flag to `cli/src/commands/review.ts`
- [x] When `--submit` is set: after review, call `CommentPoster.postReview()` + `CommentPoster.postSummaryComment()`
- [x] Require `GITHUB_TOKEN` or `GITHUB_PAT` when `--submit` is used
- [x] Print confirmation: "✅ Review posted on PR #X (N findings)"
- [x] Skip posting inline if 0 findings (still posts summary)
- [x] E2E tested on PR #7: 3 inline comments on correct lines, summary with replace-not-duplicate

---

## 15. Launch Checklist (DEFERRED)

- [ ] GitHub repository made public
- [ ] `npm publish` — `openreview` package published
- [ ] GitHub release created with `v1.0.0` tag and release notes
- [ ] GitHub Action listed on GitHub Marketplace
- [ ] Post on: GitHub (README), Hacker News (Show HN), Reddit r/programming, X/Twitter
- [ ] First 3 OSS projects onboarded as beta testers

---

---

## 16. Impact Analysis — Phase 1 MVP

### 16.1 Impact Types (`core/src/impact/types.ts`)
- [ ] Define `ImpactNode` interface: `file`, `importedSymbols`, `proximity`, `relevanceScore`, `importChain`
- [ ] Define `ImpactResult` interface: `changedFiles`, `impactedFiles`, `affectedPages`, `affectedComponents`, `summary`
- [ ] Define `ImpactGraph` interface for internal dependency graph representation
- [ ] Define relevance scoring constants: direct (1.0), 2nd degree (0.7), 3rd degree (0.5), deeper (diminishing)
- [ ] Export impact types from `core/src/review/types.ts` (canonical re-export)

### 16.2 Tree-sitter Dependency Graph Builder (`core/src/impact/tree-sitter.ts`)
- [ ] Install `tree-sitter` and language grammars (tree-sitter-typescript, tree-sitter-python, tree-sitter-javascript, etc.) in `core`
- [ ] Implement `detectLanguage(filePath: string): string` — map file extension to Tree-sitter grammar
- [ ] Implement `extractImports(filePath: string, content: string): ImportInfo[]` — parse file AST, extract import/require/use statements
- [ ] Implement `extractExports(filePath: string, content: string): ExportInfo[]` — parse file AST, extract exported symbols
- [ ] Support language-agnostic parsing: JS/TS (`import`/`require`/`export`), Python (`import`/`from`), Go (`import`), Java (`import`), Ruby (`require`/`require_relative`), Rust (`use`/`mod`)
- [ ] Handle dynamic imports and re-exports
- [ ] Guard against malformed input — validate AST nodes before accessing properties
- [ ] Unit test: import extraction per language, export extraction, dynamic imports, malformed input

### 16.3 Dependency Graph & Traversal (`core/src/impact/graph.ts`)
- [ ] Implement `buildDependencyGraph(files: string[], repoPath: string): ImpactGraph` — build full repo import graph using Tree-sitter
- [ ] Implement `traceImpact(changedFiles: string[], graph: ImpactGraph): ImpactNode[]` — BFS/DFS transitive traversal from changed files
- [ ] Implement relevance scoring: score = f(proximity), direct = 1.0, each degree reduces score
- [ ] Implement configurable depth threshold (`IMPACT_DEPTH_THRESHOLD`) to cap traversal depth
- [ ] Deduplicate: if a file is reachable via multiple paths, keep highest relevance score
- [ ] Sort results: highest relevance first
- [ ] Unit test: graph building, transitive traversal, scoring, deduplication, depth threshold

### 16.4 Component-to-Page Mapper (`core/src/impact/component-mapper.ts`)
- [ ] Implement `mapToPages(impactedFiles: ImpactNode[], repoPath: string): PageMapping[]` — identify which UI pages/routes are affected
- [ ] Detect page/route files by convention: files in `pages/`, `routes/`, `views/`, `screens/` directories or files matching common routing patterns
- [ ] Detect route definitions: React Router, Next.js pages/app dir, Vue Router, Angular routing modules
- [ ] For each impacted file, trace upward to the page/route that renders it
- [ ] Return mapping: `{ component: string, pages: string[], routes: string[] }`
- [ ] Unit test: page detection, route detection, component-to-page mapping

### 16.5 Impact Analyzer Entry Point (`core/src/impact/analyzer.ts`)
- [ ] Implement `analyzeImpact(changedFiles: string[], repoPath: string, config: ImpactConfig): Promise<ImpactResult>`
- [ ] Orchestrate: build graph → trace impact → score → map components → build result
- [ ] Accept both git diff files and manual `--files` input
- [ ] Respect `IMPACT_ENABLED` and `IMPACT_DEPTH_THRESHOLD` config
- [ ] Performance target: < 30 seconds for repos with ≤ 500 files
- [ ] Unit test: end-to-end flow with mock repo, config handling, performance

### 16.6 Review Pipeline Integration
- [ ] Add `IMPACT_ENABLED` (boolean, default: true) and `IMPACT_DEPTH_THRESHOLD` (number, default: 10) to `core/src/config/env.ts`
- [ ] In `core/src/review/fast-review.ts`: call `analyzeImpact()` after deduplication, before sorting
- [ ] Enrich each `ReviewFinding` with optional `impactScope?: { affectedFiles: number, affectedPages: number }` field
- [ ] Re-sort findings: impact-weighted prioritization (high-impact files surface first)
- [ ] Add impact summary to `ReviewSummary` type
- [ ] Unit test: integration with review pipeline, finding enrichment, prioritization

### 16.7 CLI Integration
- [ ] In `cli/src/commands/review.ts`: add `--impact` and `--no-impact` flags
- [ ] Add interactive prompt: "Would you like to include impact analysis? (y/n)" (shown when neither flag is set)
- [ ] Add `--files <paths>` flag for manual file targeting (comma-separated)
- [ ] When `--impact` or user says "y": call impact analysis as part of review
- [ ] When `--no-impact` or user says "n": skip impact analysis

### 16.8 Terminal Output
- [ ] Implement `formatImpactTree(result: ImpactResult): string` — structured tree view of impacted files
- [ ] Show proximity scores, import chain paths, and affected page/route annotations
- [ ] Group by proximity level: Direct Dependents → 2nd Degree → 3rd Degree → Deeper
- [ ] Highlight component-to-page mapping section
- [ ] Unit test: formatting output for various impact scenarios

### 16.9 JSON Report Output
- [ ] Implement `writeImpactReport(result: ImpactResult, outputPath: string): void`
- [ ] Write machine-readable JSON file (`impact-report.json`) alongside review output
- [ ] Include all impact data: changed files, impacted files with scores, affected pages, summary stats
- [ ] Unit test: JSON structure, file writing

### 16.10 Review Output Integration
- [ ] Add standalone "Impact Analysis" section to review summary (terminal and summary comment)
- [ ] Format: total impacted files, direct vs transitive count, affected pages list
- [ ] Annotate individual findings with impact scope (e.g., "⚡ High impact — affects 12 files across 3 pages")
- [ ] Unit test: summary section format, finding annotation format

---

# PHASE 2 — GROWTH (Post-MVP)

---

## 1. Web UI (`web/`)

- [ ] Scaffold React 19 + TypeScript + Vite 8 app in `web/`
- [ ] Add pnpm workspace entry for `web`
- [ ] Implement 3-panel layout (file browser, diff viewer, chat/findings tabs)
- [ ] Implement diff viewer with line highlighting and citation navigation
- [ ] Implement chat panel with SSE streaming consumer
- [ ] Implement findings tabs: Bugs tab, Flags tab
- [ ] Implement copy/move visualization (move indicator in diff viewer)
- [ ] Connect to Express.js backend via REST + SSE
- [ ] `npx openreview serve` serves both API + static React build

## 2. Auto-Fix Application

- [ ] Implement `@openreview autofix` command handler in `action/src/comment-handler.ts`
- [ ] Parse unresolved fix suggestion threads from PR
- [ ] Apply fixes to PR branch via GitHub API (create commit)
- [ ] Re-run linters after applying fixes
- [ ] `@openreview autofix --stacked` → create new branch + PR
- [ ] Add `autofix` CLI command: `npx openreview autofix --url <PR-URL>`

## 3. `.reviewbuddy.yaml` Config

- [ ] Define YAML schema (all fields from PRD section 4.11 + new Phase 2 fields)
- [ ] Implement YAML loader in `core/src/config/`
- [ ] Config hierarchy: `.reviewbuddy.yaml` > `.env` > defaults
- [ ] Add: review profile (chill/assertive), path_instructions, labeling_instructions

## 4. PR Walkthrough + Release Notes

- [ ] Implement PR walkthrough generator (summary of what the PR does in plain language)
- [ ] Prepend walkthrough to summary comment
- [ ] Implement release notes generator (opt-in via config)
- [ ] Append release notes to PR description

## 5. Jira Integration

- [ ] OAuth flow for Jira Cloud connection
- [ ] Fetch linked issue title + description from Jira API
- [ ] Inject issue context into review prompt
- [ ] Implement linked issue assessment (✅/❌/❓)

## 6. Linear Integration

- [ ] OAuth flow for Linear connection
- [ ] Fetch linked issue context from Linear API
- [ ] Inject into review prompt
- [ ] Linked issue assessment

## 7. Notifications (Slack / Discord / Teams)

- [ ] Slack webhook integration (post summary on review complete)
- [ ] Discord webhook integration
- [ ] Microsoft Teams webhook integration
- [ ] Configurable via `.reviewbuddy.yaml`

## 8. Expanded Linter Suite (30+ tools)

- [ ] Clippy (Rust)
- [ ] golangci-lint (Go)
- [ ] RuboCop (Ruby)
- [ ] PHPStan (PHP)
- [ ] Checkov (Terraform / IaC)
- [ ] TFLint (Terraform)
- [ ] Trivy (containers / IaC)
- [ ] Detekt (Kotlin)
- [ ] SwiftLint (Swift)
- [ ] PMD (Java)
- [ ] markdownlint (Markdown)
- [ ] Per-tool enable/disable in `.reviewbuddy.yaml`

## 9. Docker Sandbox (replaces Deno)

- [ ] Implement Docker-based sandbox runner in `core/src/sandbox/docker-runner.ts`
- [ ] Feature flag: `SANDBOX=deno|docker` in config
- [ ] Docker image: minimal Node.js + Python + common language runtimes
- [ ] Resource limits: CPU 0.5, memory 512MB, time 60s
- [ ] Keep Deno runner as fallback when Docker not available

## 10. Sequence Diagram Generation

- [ ] Implement Mermaid diagram generator (call LLM with PR context)
- [ ] Post diagram in summary comment (code block with `mermaid` language tag)
- [ ] Toggle via config: `SEQUENCE_DIAGRAMS=true`

## 11. Local Directory Review (`--path`)

- [ ] Add `--path <dir>` flag to `cli/src/commands/review.ts` (mutually exclusive with `--url`)
- [ ] Generate diff from `git diff HEAD` in the local directory
- [ ] Build `PRContext` from local filesystem (no GitHub API calls)
- [ ] Support `--files <paths>` for reviewing specific files
- [ ] Works offline — only LLM API call needed
- [ ] Output same format as remote PR review (text/markdown/json)

## 12. GitHub Issue Review

- [ ] Support `/issues/<number>` URLs in `parsePRUrl()` alongside `/pull/<number>`
- [ ] Fetch issue body + comments via GitHub API
- [ ] Send issue context to LLM for analysis (no diff, just text)
- [ ] Output findings as suggestions/observations (category: flag only, no bug)
- [ ] `--submit` posts response as issue comment

---

## 13. Impact Analysis — Phase 2 (Advanced)

### 13.1 LLM-Powered Semantic/Data-Flow Analysis
- [ ] Implement `core/src/impact/semantic-analyzer.ts` — LangGraph agent for data-flow reasoning
- [ ] Feed Tree-sitter dependency graph as initial context to LLM
- [ ] LLM traces data flow across boundaries: frontend → API route → backend handler → database query
- [ ] Identify cross-layer impacts (e.g., form field rename affects API contract, backend validation, database schema)
- [ ] Return enriched `ImpactNode[]` with `dataFlowPath` annotations
- [ ] Unit test: data-flow detection across mock multi-layer codebase

### 13.2 Screenshot Diffing
- [ ] Implement `core/src/impact/screenshot-differ.ts`
- [ ] Run target app in sandbox (Deno Phase 1, Docker Phase 2)
- [ ] Use headless browser (Playwright) to capture screenshots of affected pages before/after changes
- [ ] Compute pixel-level or component-level visual diff
- [ ] Generate annotated diff images highlighting affected UI regions
- [ ] Store screenshots in `~/.openreview/traces/<pr>/screenshots/`
- [ ] Unit test: screenshot capture, diff computation, annotation generation

### 13.3 Live Preview in Sandbox
- [ ] Implement `core/src/impact/live-preview.ts`
- [ ] Spin up app in sandbox environment
- [ ] Render affected pages identified by component mapper
- [ ] Annotate impacted components with visual overlay markers (border highlighting, labels)
- [ ] Return rendered page URLs or screenshots with annotations
- [ ] Support both Docker (CI) and local dev server (CLI) environments

### 13.4 GitHub PR Comment — Impact Summary
- [ ] Extend `core/src/github/comments.ts` with `postImpactComment(prNumber, impactResult): Promise<void>`
- [ ] Format as collapsible table: impacted files grouped by category (direct/transitive), proximity scores, affected pages
- [ ] Use `<!-- openreview-impact -->` HTML marker for replace-not-duplicate strategy
- [ ] Include visual diff thumbnails (as GitHub image links) when screenshot diffing is enabled

### 13.5 Interactive HTML Report / Web Dashboard
- [ ] Implement impact visualization component in `web/` (React 19 + Vite 8)
- [ ] Visual dependency graph: nodes = files, edges = imports, colored by impact proximity
- [ ] Click-to-expand: click a node to see its import chain and affected pages
- [ ] Integrate with `npx openreview serve` — serve impact report alongside review data
- [ ] Export as standalone HTML file for sharing

### 13.6 Docker Container Sandbox for UI Rendering
- [ ] Extend `core/src/sandbox/docker-runner.ts` to support headless browser (Playwright) execution
- [ ] Docker image includes: Node.js, Playwright, Chromium
- [ ] Resource limits: CPU 1.0, memory 1GB, time 120s (higher than code sandbox due to rendering)
- [ ] Fallback to local dev server when Docker not available (CLI mode)

---

# PHASE 3 — ENTERPRISE (6+ Months Post-MVP)

---

## 1. Multi-Platform Support

- [ ] GitLab MR support (cloud + self-managed) — abstracted VCS client
- [ ] Azure DevOps PR support
- [ ] Bitbucket PR support (cloud + Data Center)
- [ ] GitHub Enterprise Server support
- [ ] Abstract `GitHubClient` into `VCSClient` interface with platform-specific implementations

## 2. GitHub App

- [ ] Register GitHub App in GitHub Developer Settings
- [ ] Implement OAuth callback server for app installation flow
- [ ] Replace PAT + GITHUB_TOKEN auth with GitHub App JWT + installation tokens
- [ ] Bot identity: `openreview[bot]`
- [ ] Add: code owner detection, suggested reviewer assignment, auto-label application

## 3. IDE Extension

- [ ] Scaffold VS Code extension in `ide/` workspace
- [ ] Implement real-time review of uncommitted changes
- [ ] One-click fix application in editor
- [ ] Hand off to Copilot / Claude / Cursor agent
- [ ] Connect to local OpenReview server for learnings + traces
- [ ] Publish to VS Code Marketplace

## 4. Cloud Hosting + Hybrid Deployment

- [ ] Set up `app.openreview.ai` cloud infrastructure
- [ ] Team management dashboard (invite, seats, roles)
- [ ] Cloud-synced learnings database
- [ ] Self-hosted remains fully featured (no feature degradation)

## 5. Full Analytics Dashboard

- [ ] Per-developer metrics: issues found, acceptance rate
- [ ] Per-repo metrics: time-to-merge, severity breakdown
- [ ] Knowledge base usage rate
- [ ] CSV export
- [ ] Scheduled email / Slack / Teams / Discord reports

## 6. MCP Server Integration

- [ ] MCP client implementation in `core/src/mcp/`
- [ ] Configuration: list of MCP server URLs + credentials
- [ ] Call MCP servers during review for external context injection
- [ ] Built-in integrations: Notion, SonarQube, Jenkins

## 7. Central Org-Wide Config

- [ ] Discover `openreview-config` repo in the same GitHub org
- [ ] Load `.reviewbuddy.yaml` from that repo as org-level defaults
- [ ] Config hierarchy: repo YAML > org YAML > .env > defaults

## 8. Custom RBAC

- [ ] Role definitions: Admin, Member, Contributor, Billing Admin
- [ ] Per-resource permissions
- [ ] Default role assignment for new org members

## 9. Metrics API

- [ ] `GET /api/v1/metrics/reviews` with pagination and date range filters
- [ ] API key authentication
- [ ] Returns ReviewMetric objects (complexity, review time, comment counts by severity)

## 10. Custom Pre-Merge Checks

- [ ] Up to 5 custom checks per org (in `.reviewbuddy.yaml`)
- [ ] Modes: `off`, `warning`, `error` (blocks merge)
- [ ] Built-in: docstring coverage, PR title validation, linked issue assessment
- [ ] Manual bypass: `@openreview ignore checks` with audit trail

---

_To-Do List v1.3 — OpenReview — 2026-03-24_
