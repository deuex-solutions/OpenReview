# OpenReview — Milestone Document

> Version 1.2 | 2026-03-24
> 3 Phase-level Milestones + Post-MVP Roadmap
> Audience: Solo Founder / Product Manager / Technical Lead
> Status: Phase 1 Week 4 — 100% core features complete (launch checklist pending)

---

## Milestone Overview

| Milestone           | Phase   | Target Duration     | Goal                                                            |
| ------------------- | ------- | ------------------- | --------------------------------------------------------------- |
| **M1 — MVP**        | Phase 1 | 4 weeks             | Self-hosted CLI + GitHub Action, fast + RLM review, GitHub sync |
| **M2 — Growth**     | Phase 2 | 8–12 weeks post-MVP | Web UI, auto-fix, integrations, expanded linters                |
| **M3 — Enterprise** | Phase 3 | 6+ months post-MVP  | Multi-platform, IDE extension, cloud hosting, analytics         |

---

## M1 — MVP (Phase 1) · Target: 4 Weeks

### Goal

Ship a working, self-hosted OpenReview that a developer can install in 5 minutes, point at a GitHub repo, and get meaningful AI-powered code review findings posted as native GitHub PR comments.

### Success Criteria

- [x] `npx openreview review --url <PR-URL>` works end-to-end on a public GitHub PR — CLI E2E verified (fast + RLM)
- [x] GitHub Action auto-triggers Fast mode review on PR open/update within 60 seconds — `action/` fully implemented
- [x] `@openreview rlm` triggers Deep/RLM mode via GitHub comment — `comment-handler.ts` routes to `rlm-runner.ts`
- [x] `@openreview <question>` triggers codebase-aware chat — `chat-handler.ts` with thread history + suggestions
- [x] All findings posted as native GitHub inline PR review comments with citations — batch review via `CommentPoster`
- [x] Fast mode completes in < 60 seconds for PRs with ≤ 100 files — all 10 test PRs under 27s
- [x] Catches ≥ 8 real bugs per 10 test PRs (validated set) — **10/10 caught (18 findings)**
- [ ] ≥ 10 GitHub stars within 2 weeks of public launch — pending launch

### Deliverables

- `core/` — TypeScript review engine (Fast + RLM + Chat + Linters)
- `cli/` — `npx openreview` CLI wrapper
- `action/` — `action.yml` GitHub Action
- `SKILL.md` — Agent skill definition
- `.env.example` — Full configuration template
- `README.md` — Setup guide (< 5 min to first review)
- MIT `LICENSE`

### Week-by-Week Breakdown

#### Week 1 — Foundation ✅ COMPLETE (2026-03-18)

- ✅ Monorepo scaffold (pnpm workspaces, tsdown, Vitest, ESLint 10 flat config + Prettier)
- ✅ `core/config/` — `.env` loader, instruction file reader (REVIEW.md, AGENTS.md, CLAUDE.md, .cursorrules, .windsurfrules)
- ✅ `core/github/client.ts` — GitHub API client (axios, PR fetch, diff fetch, file fetch)
- ✅ `core/github/diff.ts` — Diff parser + copy/move detection algorithm
- ✅ `core/github/comments.ts` — Review comment batch poster (replace-not-duplicate strategy)
- ✅ LangGraph.js setup and model router (OpenAI / Anthropic / Gemini provider switching)
- 65 tests passing, lint clean, typecheck clean, all 3 packages building

#### Week 2 — Fast Mode + Linters ✅ COMPLETE (2026-03-20)

- ✅ `core/review/types.ts` — Full data model (ReviewFinding, Citation, ReviewSummary, PRContext, severity/category/source types)
- ✅ `core/review/fast-review.ts` — Single-shot structured LLM review with citation validation against diff
- ✅ `core/review/linters.ts` — Parallel linter orchestration (Promise.allSettled, 30s timeout, binary-not-found skip)
  - ✅ ESLint, Ruff, Semgrep, ShellCheck, Gitleaks — individual JSON parsers
- ✅ `core/review/formatter.ts` — Summary comment (severity table, trigger hints, HTML marker) + inline comment (badges, attribution, GitHub suggestion syntax)
- ✅ Finding deduplication (linter + AI overlap by file + line range → source: 'both')
- ✅ LLM response parsing with robust JSON extraction (code fences, embedded arrays, fallback)
- ✅ `comments.ts` migrated to canonical review types (single source of truth)
- 94 tests passing, lint clean, typecheck clean, all 3 packages building

#### Week 3 — RLM Mode + Chat + Learnings ✅ COMPLETE (2026-03-22)

- ✅ `core/sandbox/deno-runner.ts` — Deno sandbox executor (`deno run` with strict permissions: `--allow-read`, `--deny-net`, `--deny-env`, `--deny-run`), 15s timeout, 10MB buffer, temp file cleanup
- ✅ `core/review/rlm-runner.ts` — LangGraph agentic loop (Reason → Code → Execute → Observe → Finalize) with 5 nodes, edge conditions (iteration/LLM call limits, `finish_review` tool), event streaming via `RLMEventHandler`
- ✅ `core/review/snapshot.ts` — Hybrid snapshot builder (diff immediate, files on demand, inflight dedup, binary detection, `MAX_FILE_BYTES`/`MAX_TOTAL_BYTES` enforcement)
- ✅ `core/trace/logger.ts` — JSON trace logger (`~/.openreview/traces/`) with secret scrubbing (OpenAI, GitHub PAT, Slack tokens, generic secrets), `logFastReview`, `logRLMIteration`, `logFindings`, `close`
- ✅ `core/chat/chat-handler.ts` — `@openreview <question>` handler with loop prevention, thread history (last 10), citation validation, LLM streaming
- ✅ `core/chat/suggestions.ts` — Follow-up question generator (SUB_MODEL, temperature 0.3, 4-5 questions, ≤8 words each)
- ✅ `core/learnings/learnings-store.ts` — JSON file CRUD, trigger phrase detection (8 phrases), max 50 cap with auto-pruning, `formatLearningsForPrompt()` with 2000-token cap
- ✅ Learning injection into `fast-review.ts` and `rlm-runner.ts` system prompts
- ✅ Chat thread state management (stateful within PR)
- 320 tests passing, lint clean, typecheck clean

#### Week 4 — CLI + Action + Polish ✅ COMPLETE (2026-03-24)

- ✅ `cli/` — Full CLI: `review`, `ask`, `serve`, `traces` commands (commander v14)
- ✅ `cli/src/formatter.ts` — text, markdown, JSON output formats
- ✅ `action/action.yml` — All inputs defined (github-token, LLM keys, model, max-files, review-drafts)
- ✅ `action/src/index.ts` — Event router (pull_request → pr-handler, comment → comment-handler)
- ✅ `action/src/pr-handler.ts` — Auto-review on PR open/sync, draft skip, acknowledgement, batch review
- ✅ `action/src/comment-handler.ts` — @openreview commands (rlm, review, chat, learnings CRUD, loop prevention)
- ✅ `SKILL.md` — Claude Code, Cursor, Gemini CLI, Codex examples + API key verification
- ✅ `README.md` — Quick start, config reference, commands, review modes, instruction files
- ✅ `CONTRIBUTING.md` — Setup, workflow, conventions, PR process
- ✅ QA: 321 tests, 10/10 test PR bugs caught (18 findings), CLI E2E verified (fast + RLM)
- ✅ Bug fixes from manual testing: auth scheme detection, structured output, severity normalization, file-type-aware prompting, sandbox `deno run`, RLM recursion limit, temperature control
- ✅ `--submit` flag: post CLI review findings as GitHub PR comment — E2E tested on real PR (inline + summary)
- ✅ Chunked diff review for large PRs (40K char chunks, lock file filtering, file-type-aware prompting)
- ✅ Adaptive prompt length (compact for small PRs, comprehensive for large)
- ✅ Competitive analysis with AsyncReview — roadmap updated with 3 gap-closure features
- ✅ GETTING_STARTED.md — comprehensive 3-path onboarding guide
- ✅ Documentation audit and update across all user-facing files
- [ ] Launch checklist: npm publish, GitHub Marketplace, public announcement (deferred)

#### Week 5–6 — Impact Analysis (Phase 1 MVP)

**Goal:** When a developer runs `openreview review`, optionally identify all files and UI components affected by the changes in the PR — providing a full blast-radius view alongside the existing review findings.

- `core/src/impact/` — New module for impact analysis engine
  - ✅ `core/src/impact/types.ts` — Impact-specific types: `ImpactNode`, `ImpactGraph`, `ImpactResult`, proximity/relevance scoring types
  - ✅ `core/src/impact/tree-sitter.ts` — Tree-sitter based import/dependency graph builder (language-agnostic, supports JS/TS, Python, Go, Java, Ruby, Rust, etc.)
  - ✅ `core/src/impact/graph.ts` — Dependency graph traversal with transitive tracing and relevance scoring (direct > 2nd degree > 3rd degree)
  - ✅ `core/src/impact/analyzer.ts` — Main entry point: takes changed files (git diff + staged), builds graph, returns scored impact results
  - ✅ `core/src/impact/component-mapper.ts` — Textual component-to-page/route mapping (which UI pages/routes are affected by changed files)
- ✅ Integration into review pipeline
  - Interactive prompt during `openreview review`: "Would you like to include impact analysis? (y/n)"
  - `--impact` / `--no-impact` CLI flags to skip the prompt (for CI/automation)
  - ✅ Enrichment of `ReviewFinding` objects with impact metadata (affected downstream routes)
  - `--files <paths>` override flag for manual file targeting (ad-hoc exploration)
  - Default input: git diff + staged changes; `--files` overrides with arbitrary file list
- ✅ Output — Terminal
  - ✅ Structured tree of impacted files with proximity scores and import chain paths
  - ✅ Integration with existing JSON/Markdown formatters
  - ✅ Component-to-page mapping section (which UI pages/routes are affected)
- ✅ Output — JSON report
  - ✅ Machine-readable JSON report file for CI/CD integration
- ✅ Review integration
  - ✅ Standalone "Impact Analysis" summary section in review output
  - ✅ Each `ReviewFinding` enriched with impact scope annotation (e.g., "This bug in `Button.tsx` affects 12 files across 3 pages")
  - Impact-based prioritization: findings in high-impact files surface first
- Types integrated into `core/src/review/types.ts` (canonical source of truth)
- Config: `IMPACT_ENABLED`, `IMPACT_DEPTH_THRESHOLD` env vars in `core/src/config/env.ts`
- ✅ Unit tests for graph building, traversal, scoring, and component mapping
- ✅ E2E Evaluation (`tests/evals/impact.eval.ts`)
  - ✅ Accuracy checks: verification of deep transitive dependents
  - ✅ Performance checks: enforcing sub-50ms thresholds

---

## M2 — Growth (Phase 2) · Target: 8–12 Weeks Post-MVP

### Goal

Transform OpenReview from a CLI tool into a full product experience — with a Web UI, auto-fix capability, richer integrations, and expanded language coverage.

### Success Criteria

- [ ] Web UI (3-panel: file browser, diff viewer, chat) running locally via `npx openreview serve`
- [ ] `@openreview autofix` applies suggestions to the PR branch via a new commit
- [ ] `.reviewbuddy.yaml` per-repo config file supported alongside `.env`
- [ ] Jira and Linear issue context pulled into reviews automatically
- [ ] Slack / Discord / Teams notifications delivered on review completion
- [ ] 30+ linters integrated (matching major language coverage)
- [ ] Per-PR metrics stored locally (file count, issues found, duration, severity breakdown)

### Feature Groups

#### 2.1 Web UI

- React 19 + TypeScript + Vite 8 app (in `web/`)
- 3-panel layout: left (file browser + PR metadata), center (diff viewer with line highlighting), right (chat + findings tabs)
- SSE streaming for chat responses
- Citation navigation: click finding → jump to diff line
- Copy/move visualization in diff viewer
- `npx openreview serve` starts local Express 5 + Vite 8 dev server

#### 2.1.1 Local Directory Review

- `openreview review --path <dir>` — review local code changes without a GitHub PR
- Generate diff from `git diff HEAD` locally, build PRContext from filesystem
- Works offline (only LLM API call needed)
- Supports `--files <paths>` for targeted file review

#### 2.1.2 GitHub Issue Review

- Support `/issues/<number>` URLs alongside `/pull/<number>`
- Fetch issue body + comments, send to LLM for analysis
- Output as suggestions/observations (no inline code comments)
- `--submit` posts response as issue comment

#### 2.2 Auto-Fix Application

- `@openreview autofix` command: reads unresolved fix suggestion threads, applies fixes to branch
- Creates a new commit on the PR branch (not a stacked PR) with message: `fix: OpenReview auto-applied suggestions`
- Requires explicit user command — never automatic
- Build verification: re-runs linters after applying fixes
- Stacked PR option: `@openreview autofix --stacked` creates a new PR from a new branch

#### 2.3 `.reviewbuddy.yaml` Config

- YAML config file at repo root (version-controlled, team-shareable)
- Overrides `.env` for per-repo settings
- Adds: review profile (chill/assertive), path_instructions, labeling_instructions, custom finishing touches
- Config hierarchy: `.reviewbuddy.yaml` > `.env` > defaults

#### 2.4 PR Walkthrough + Release Notes

- Auto-generated plain-language PR summary posted as top of summary comment
- Release notes appended to PR description (opt-in via config)

#### 2.5 Jira + Linear Integration

- OAuth-based Jira Cloud connection (or PAT-based)
- Linear OAuth connection
- Linked issue context (title + description) pulled into review prompt
- Linked issue assessment: ✅ Addressed / ❌ Not addressed / ❓ Unclear

#### 2.6 Notifications

- Slack webhook: post review summary to configured channel on review completion
- Discord webhook: same
- Microsoft Teams webhook: same
- Configurable via `.env` or `.reviewbuddy.yaml`

#### 2.7 Expanded Linter Suite (30+ tools)

- Clippy (Rust), golangci-lint (Go), RuboCop (Ruby), PHPStan (PHP)
- Checkov (Terraform/IaC), TFLint (Terraform), Trivy (containers/IaC)
- Detekt (Kotlin), SwiftLint (Swift), PMD (Java), markdownlint
- Per-tool enable/disable via `.reviewbuddy.yaml`

#### 2.8 Docker Sandbox (replaces Deno for RLM)

- RLM sandbox migrated from Deno 2.7 to Docker containers
- Broader language execution support (any language)
- Stronger process isolation
- Configurable resource limits (CPU, memory, time)

#### 2.9 Sequence Diagram Generation

- Auto-generated Mermaid diagrams posted in summary comment
- Shows component interactions for complex PRs

#### 2.10 Impact Analysis (Phase 2 — Advanced)
- **LLM-powered semantic/data-flow analysis** via LangGraph — tracks how data flows across the codebase (e.g., form data → API route → backend handler → database query)
- **Screenshot diffing** — Run target app in sandbox before/after changes, capture screenshots, visually highlight UI regions affected (pixel-level or component-level diff)
- **Live preview in sandbox** — Spin up app in sandbox, render affected pages, annotate impacted components with overlay markers
- **GitHub PR comment** — Post impact analysis summary as a collapsible table in the PR comment (impacted files grouped by category, proximity scores, affected pages)
- **Interactive HTML report / web dashboard** — Generate visual dependency graph with highlighted impact zones, serve via `web/` (React 19 + Vite 8)
- **Docker container sandbox** — Docker-based environment for running UI rendering and screenshot diffing in CI contexts (complements Deno sandbox from Phase 1)

---

## M3 — Enterprise (Phase 3) · Target: 6+ Months Post-MVP

### Goal

Make OpenReview viable for mid-to-large engineering organizations — with multi-platform support, IDE integration, cloud hosting option, full analytics, and enterprise-grade security controls.

### Success Criteria

- [ ] GitLab, Azure DevOps, Bitbucket, GitHub Enterprise all supported
- [ ] IDE extension published on VS Code Marketplace (Cursor + Windsurf compatible)
- [ ] Cloud-hosted SaaS version available alongside self-hosted
- [ ] Full analytics dashboard accessible at `app.openreview.ai` (cloud) or `localhost` (self-hosted)
- [ ] GitHub App registered with bot identity `openreview[bot]`
- [ ] SOC 2 Type II certification initiated (cloud tier)
- [ ] MCP server integration available

### Feature Groups

#### 3.1 Multi-Platform Support

- GitLab MR reviews (cloud + self-managed)
- Azure DevOps PR reviews
- Bitbucket PR reviews (cloud + Data Center)
- GitHub Enterprise Server

#### 3.2 GitHub App

- Proper GitHub App registration with `openreview[bot]` identity
- Fine-grained permissions: PR read/write, issues read/write, contents read
- OAuth flow for user authentication
- Replaces PAT + GITHUB_TOKEN approach
- Enables: code owner detection, suggested reviewer assignment, auto-label application

#### 3.3 IDE Extension

- VS Code extension (Cursor + Windsurf compatible via VS Code API)
- Reviews uncommitted changes in real-time before commit
- One-click fix application
- Hands off findings to coding agent (Copilot, Claude, Cursor agent)
- Native integration with OpenReview learnings database

#### 3.4 Cloud Hosting + Hybrid Deployment

- Optional cloud-hosted version at `app.openreview.ai`
- Self-hosted remains fully supported (no feature degradation)
- Cloud-synced learnings for cross-device access
- Team management dashboard (invite members, manage seats)

#### 3.5 Full Analytics Dashboard

- Per-developer and per-repo metrics
- Time-to-merge, comment acceptance rate, severity breakdown
- Issues found by category (security, performance, correctness, maintainability)
- Knowledge base usage rate (how often learnings are applied)
- Export as CSV
- Scheduled reports: Email / Slack / Teams / Discord

#### 3.6 MCP Server Integration

- OpenReview acts as MCP client
- Connect to: Notion, SonarQube, Jenkins, Jira (Data Center), custom internal tools
- MCP server data injected as review context during Fast + RLM modes

#### 3.7 Central Org-Wide Config

- Special `openreview-config` repository in the org
- `.reviewbuddy.yaml` there applies as default across all repos
- Per-repo config overrides org-wide config

#### 3.8 Custom RBAC

- Role definitions beyond Admin / Member
- Per-resource permission control: review triggers, learnings management, config, billing
- Default role assignment for new org members

#### 3.9 Metrics API

- `GET /api/v1/metrics/reviews` — paginated PR metrics
- Auth via API key
- Returns: ReviewMetric objects with complexity score, review time, comment counts by severity

#### 3.10 Custom Pre-Merge Checks

- Up to 5 custom checks per org (defined in `.reviewbuddy.yaml`)
- Modes: `off`, `warning`, `error` (blocks merge)
- Built-in: docstring coverage, PR title validation, linked issue assessment

---

## Post-MVP Feature Backlog (Unscheduled)

These features were identified during product Q&A but deliberately deferred beyond Phase 3:

| Feature                                        | Notes                                         |
| ---------------------------------------------- | --------------------------------------------- |
| Custom glob patterns for rule source files     | Requires `.reviewbuddy.yaml` (Phase 2 prereq) |
| AI tone and language configuration (ISO codes) | Low priority — add to Phase 2 YAML spec       |
| Review profile options (chill / assertive)     | Add to Phase 2 YAML spec                      |
| CSV export/import of learnings                 | Add to Phase 3 dashboard                      |
| Scope control (local vs global learnings)      | Add to Phase 3 multi-platform                 |
| Opt-in cloud retention for review history      | Phase 3 cloud tier                            |
| SOC 2 Type II certification                    | Phase 3 cloud tier                            |
| Scheduled analytics reports                    | Phase 3 analytics                             |
| Learning dashboard (active, never-used)        | Phase 3 analytics                             |
| Linked issue assessment (✅/❌/❓)             | Phase 2 (Jira/Linear prereq)                  |
| Suggested labels / auto-apply                  | Phase 3 (GitHub App prereq)                   |
| Code owner detection + suggested reviewers     | Phase 3 (GitHub App prereq)                   |
| PR description link insertion                  | Phase 2                                       |
| Issue planning (`@openreview plan`)            | Post Phase 3                                  |
| Issue enrichment / deduplication               | Post Phase 3                                  |

---

_Milestones v1.3 — OpenReview — 2026-03-24_
