# OpenReview — Phase-wise Deep To-Do List

> Version 1.1 | 2026-03-17
> Structure: Phase → Feature → Task
> Audience: Solo Founder / Technical Lead

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

## 6. RLM Deep Mode

### 6.1 Deno Sandbox (`core/src/sandbox/deno-runner.ts`)

- [ ] Verify Deno 2.7+ installation at startup; throw descriptive error if missing
- [ ] Implement `executeSandboxed(code: string, globals: Record<string, unknown>): Promise<SandboxResult>`
- [ ] Inject `globals` as Deno script context (file contents, PR metadata)
- [ ] Run with `--allow-read` only (no network, no write, no env)
- [ ] 30-second hard timeout via `AbortController`
- [ ] Capture stdout, stderr separately
- [ ] Return `{ stdout, stderr, exitCode, duration }`
- [ ] Unit test: successful execution, timeout handling, read-only enforcement, syntax error handling

### 6.2 Hybrid Snapshot (`core/src/review/snapshot.ts`)

- [ ] Implement `SnapshotBuilder` class
- [ ] Constructor: load diff files immediately (pre-fetched from GitHub API)
- [ ] Implement `getFile(path: string): Promise<string>` — lazy fetcher
  - [ ] Check in-memory cache first
  - [ ] Fetch from GitHub API if not cached
  - [ ] Cache result for duration of review session
  - [ ] Respect `MAX_FILE_BYTES` limit
  - [ ] Return empty string for binary files
- [ ] Implement `listFiles(): Promise<string[]>` — fetch full file tree from GitHub API (lazy)
- [ ] Respect `MAX_TOTAL_BYTES` cap across all fetched files
- [ ] Unit test: cache hit, cache miss + fetch, size limit enforcement

### 6.3 RLM Loop (`core/src/review/rlm-runner.ts`)

- [ ] Define LangGraph state schema: `{ messages, iterations, llmCalls, files, findings, done }`
- [ ] Implement `reason_node`: calls `createMainLLM()` with current state, returns reasoning + next action
- [ ] Implement `code_writer_node`: extracts code block from reasoning output
- [ ] Implement `sandbox_node`: calls `executeSandboxed()` with written code + snapshot globals
- [ ] Implement `observe_node`: appends sandbox output to state messages
- [ ] Implement `finalize_node`: calls LLM to produce final findings from all observations
- [ ] Define edge conditions:
  - [ ] `iterations >= MAX_ITERATIONS` → finalize
  - [ ] `llmCalls >= MAX_LLM_CALLS` → finalize
  - [ ] LLM calls `finish_review` tool → finalize
  - [ ] Otherwise → reason_node
- [ ] Compile LangGraph: `StateGraph → CompiledGraph`
- [ ] Implement `runRLM(pr: PRContext, snapshot: SnapshotBuilder): Promise<ReviewFinding[]>`
- [ ] Stream iteration events (for acknowledgement comment updates)
- [ ] Unit test: iteration limit enforcement, finalize triggers, state transitions

---

## 7. JSON Trace Logger

### 7.1 Trace Logger (`core/src/trace/logger.ts`)

- [ ] Implement `TraceLogger` class
- [ ] Constructor: create trace file at `~/.openreview/traces/<timestamp>-<owner>-<repo>-<pr>.json`
- [ ] Implement `logFastReview(input, output, duration)`: write fast review trace entry
- [ ] Implement `logRLMIteration(iteration, reasoning, code, sandboxOutput)`: append iteration
- [ ] Implement `logFindings(findings)`: append final findings
- [ ] Implement `close()`: write final metadata (total duration, LLM call count)
- [ ] Ensure no API keys or tokens appear in trace files (scrub before write)
- [ ] Create `~/.openreview/traces/` directory if it doesn't exist
- [ ] Unit test: file creation, scrubbing secrets, correct JSON structure

---

## 8. Codebase-Aware Chat

### 8.1 Chat Handler (`core/src/chat/chat-handler.ts`)

- [ ] Implement `handleChatMention(event: CommentEvent): Promise<void>`
- [ ] Extract question from comment text (strip `@openreview` prefix)
- [ ] Load conversation thread history for the PR (fetch prior comment chain)
- [ ] Build chat context: question + thread history + diff + snapshot (lazy)
- [ ] Create LangGraph chat agent with snapshot tools (`get_file`, `search_files`, `list_files`)
- [ ] Stream response (internal SSE → final GitHub comment post)
- [ ] Validate all citations in response against actual file contents
- [ ] Detect bot's own comments to prevent reply loops
- [ ] Post final answer as GitHub comment reply in the thread

### 8.2 Follow-up Suggestions (`core/src/chat/suggestions.ts`)

- [ ] Implement `generateSuggestions(answer: string, context: PRContext): Promise<string[]>`
- [ ] Call `createSubLLM()` (cheaper model) with: answer text + PR context
- [ ] Request 4–5 follow-up questions, each ≤ 8 words
- [ ] Append suggestions to chat reply as blockquote list
- [ ] Unit test: output format, length constraint, empty answer handling

---

## 9. Learnings Database

### 9.1 Learnings Store (`core/src/learnings/learnings-store.ts`)

- [ ] Implement `LearningsStore` class for repo slug
- [ ] File path: `~/.openreview/learnings/<org>-<repo>.json`
- [ ] Create file + directory on first access
- [ ] Implement `add(trigger: string, finding: string): Promise<Learning>`
- [ ] Implement `list(): Promise<Learning[]>`
- [ ] Implement `delete(id: string): Promise<void>`
- [ ] Implement `getAll(): Promise<Learning[]>` — for prompt injection
- [ ] Enforce max 50 learnings (prune oldest `usedCount=0` when limit hit)
- [ ] Implement `recordUsage(id: string)`: increment `usedCount`, update `lastUsedAt`
- [ ] Trigger phrase detection: `contains(text, ['ignore this', 'false positive', 'this is expected', 'not an issue'])`
- [ ] Unit test: add, list, delete, max limit pruning, trigger detection

### 9.2 Learning Injection

- [ ] In `fast-review.ts` and `rlm-runner.ts`: load all learnings for repo, inject into system prompt
- [ ] Format: `## Team Learnings\n- <learning 1>\n- <learning 2>...`
- [ ] Cap learnings section at 2,000 tokens
- [ ] Unit test: injection format, token cap

---

## 10. CLI (`cli/`)

### 10.1 CLI Entry Point (`cli/src/main.ts`)

- [ ] Install `commander` (v14.x) in `cli`
- [ ] Set up top-level program: `openreview` with version from `package.json`
- [ ] Register subcommands: `review`, `ask`, `serve`, `traces`
- [ ] Handle `--help` and `--version` flags
- [ ] Handle uncaught errors: print friendly message, exit code 1

### 10.2 Review Command (`cli/src/commands/review.ts`)

- [ ] `openreview review --url <PR-URL> [options]`
- [ ] Options: `--mode <fast|rlm>` (default: fast), `--output <text|markdown|json>`, `--model <model-id>`, `--expert`, `--quiet`
- [ ] Parse PR URL → extract owner, repo, PR number
- [ ] Validate `.env` config loaded
- [ ] Run `runFastReview()` or `runRLM()` based on `--mode`
- [ ] `--expert` flag: adds SOLID/security/quality review instructions to system prompt
- [ ] Format output via `formatter.ts` and print to stdout
- [ ] Progress spinner (ora or similar) during review

### 10.3 Ask Command (`cli/src/commands/ask.ts`)

- [ ] `openreview ask --repo <path> [--url <PR-URL>]`
- [ ] Interactive REPL: readline loop
- [ ] Commands: `reset` (clear history), `history` (show thread), `files` (list snapshot files), `exit`
- [ ] Each input sent to chat handler, response printed with citations

### 10.4 Serve Command (`cli/src/commands/serve.ts`)

- [ ] `openreview serve [--port <n>] [--host <host>]`
- [ ] Start Express.js server (internal API + future web UI static files)
- [ ] Print bound URL on start

### 10.5 Traces Command (`cli/src/commands/traces.ts`)

- [ ] `openreview traces --pr <PR-URL>` — list all traces for a PR
- [ ] `openreview traces --list` — list all traces (last 20)
- [ ] `openreview traces --open <trace-file>` — pretty-print a trace

### 10.6 Output Formatter (`cli/src/formatter.ts`)

- [ ] `formatText(findings)` — plain text output, one finding per line
- [ ] `formatMarkdown(findings)` — severity-grouped markdown with badges
- [ ] `formatJSON(findings)` — raw JSON array

---

## 11. GitHub Action (`action/`)

### 11.1 Action Definition (`action/action.yml`)

- [ ] Define all inputs: `github-token`, `openai-api-key`, `anthropic-api-key`, `gemini-api-key`, `main-model`, `sub-model`, `max-files`, `review-drafts`
- [ ] Set `runs: using: node24`
- [ ] Set `main: dist/index.js`
- [ ] Add `branding` (icon + color)

### 11.2 Action Entry Point (`action/src/index.ts`)

- [ ] Read all inputs via `@actions/core` (v3.x)
- [ ] Detect event type: `pull_request` vs `pull_request_review_comment`
- [ ] Route to `pr-handler.ts` or `comment-handler.ts`
- [ ] Wrap in try/catch: `core.setFailed(error.message)` on error

### 11.3 PR Handler (`action/src/pr-handler.ts`)

- [ ] Extract PR number, owner, repo from `github.context.payload`
- [ ] Skip if draft PR and `REVIEW_DRAFTS=false`
- [ ] Skip if PR description contains `openreview: skip`
- [ ] Check for incremental review: compare current commit SHA vs last reviewed SHA (HTML tag in summary comment)
- [ ] Post "Review started..." acknowledgement comment
- [ ] Run linters + Fast mode review
- [ ] Post batch review + summary comment
- [ ] Store reviewed commit SHA in summary comment HTML tag

### 11.4 Comment Handler (`action/src/comment-handler.ts`)

- [ ] Extract comment text, PR number, comment ID from payload
- [ ] Skip if comment author is the bot itself (loop prevention)
- [ ] Detect `@openreview rlm` → trigger RLM mode, post findings as review
- [ ] Detect `@openreview <question>` (anything else) → trigger chat handler
- [ ] Detect trigger phrases for learnings → call `LearningsStore.add()`
- [ ] Detect `@openreview list learnings` → post learnings list as comment
- [ ] Detect `@openreview forget: <description>` → delete matching learning

---

## 12. SKILL.md

- [ ] Write `SKILL.md` at repo root
- [ ] Sections: description, prerequisites, usage, examples, `--expert` mode description
- [ ] Verify Gemini/OpenAI/Anthropic API key step
- [ ] Verify GitHub PAT or GITHUB_TOKEN availability step
- [ ] Example commands for Claude Code, Cursor, Gemini CLI, Codex
- [ ] `--expert` flag documentation: SOLID, security, quality deep-dive

---

## 13. README & Documentation

- [ ] Write `README.md` — setup in < 5 minutes
  - [ ] What is OpenReview (1 paragraph)
  - [ ] Quick start: GitHub Action setup (copy-paste workflow YAML)
  - [ ] Quick start: CLI setup (`npx openreview review --url ...`)
  - [ ] Configuration reference (`.env` variables table)
  - [ ] Commands reference table
  - [ ] How it works (Fast mode, RLM mode, Chat)
  - [ ] Instruction files (REVIEW.md, AGENTS.md, etc.)
  - [ ] Contributing guide link
  - [ ] License badge + link
- [ ] Write `REVIEW.md` — OpenReview's own review rules (dogfooding)
- [ ] Write `CONTRIBUTING.md` — fork, branch, PR, test requirements

---

## 14. Testing & QA

- [ ] Unit tests for every module above (target: > 80% coverage)
- [ ] Integration test: `npx openreview review --url <public-test-PR>` end-to-end
- [ ] Test PRs: create 10 test PRs with known bugs in different languages
  - [ ] 2x TypeScript (logic bug, security issue)
  - [ ] 2x Python (logic bug, hardcoded secret)
  - [ ] 2x Shell (bash bug)
  - [ ] 2x Terraform/IaC (misconfiguration)
  - [ ] 2x multi-file (copy/move scenario)
- [ ] Validate: ≥ 8 out of 10 bugs caught
- [ ] Validate: Fast mode completes in < 60s on all 10 test PRs
- [ ] Manual test: `@openreview rlm` via GitHub comment
- [ ] Manual test: `@openreview <question>` via GitHub comment
- [ ] Manual test: learnings CRUD via GitHub comment commands

---

## 15. Launch Checklist

- [ ] GitHub repository made public
- [ ] `npm publish` — `openreview` package published
- [ ] GitHub release created with `v1.0.0` tag and release notes
- [ ] GitHub Action listed on GitHub Marketplace
- [ ] Post on: GitHub (README), Hacker News (Show HN), Reddit r/programming, X/Twitter
- [ ] First 3 OSS projects onboarded as beta testers

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

_To-Do List v1.1 — OpenReview — 2026-03-17_
