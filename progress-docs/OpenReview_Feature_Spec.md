# OpenReview — Feature Specification

> Open-source agentic code review tool combining the best of AsyncReview, Devin Review, and CodeRabbit.
> Defined via product Q&A session on 2026-03-16. Tech stack updated 2026-03-17.

---

## 1. Identity & Naming

| Field               | Decision         |
| ------------------- | ---------------- |
| **Tool name**       | OpenReview       |
| **CLI command**     | `npx openreview` |
| **License**         | MIT              |
| **Repository type** | Open source      |

---

## 2. MVP Scope vs. Future Phases

> MVP = Minimum Viable Product (launch target)
> Future = Planned for later phases

---

## 3. Core Deployment & Access

### MVP

- **Deployment model:** Fully self-hosted — runs entirely on the user's own infrastructure. Full data sovereignty; no data leaves the machine except to the chosen LLM API.
- **Primary interfaces:** CLI (`npx openreview`) + GitHub PR comments (via `@openreview` mention)
- **Platform support:** GitHub.com at launch

### Future Phases

- Hybrid deployment: self-hostable + optional cloud-hosted version for ease of use
- Web UI (3-panel interface: file browser, diff viewer, chat/review)
- IDE extension (VS Code, Cursor, Windsurf)
- Additional platforms: GitHub Enterprise, GitLab (cloud + self-managed), Azure DevOps, Bitbucket

---

## 4. Review Triggering

### MVP

- **Auto-review:** Fires automatically on PR events (opened, new commit pushed, draft → ready for review)
- **Manual trigger:** Via CLI command or `@openreview review` mention in GitHub PR comments
- Both modes active simultaneously — auto by default, manual on demand

---

## 5. AI & LLM Backend

### MVP

- **LLM backend:** Fully configurable — user brings their own API key and selects any model
  - Supported providers: Google Gemini, OpenAI (GPT-4o etc.), Anthropic Claude, or any OpenAI-compatible endpoint
  - Configured via `.env`: `MAIN_MODEL`, `SUB_MODEL`
- **Review engine:** Dual-mode
  - **Fast mode:** Single-shot structured LLM call over the full diff — instant categorized findings
  - **Deep mode:** Agentic RLM loop (Reason → Write Code → Execute in Sandbox → Observe → Repeat, up to configurable N iterations)
- **Sandboxed code execution:** Always enabled — the LLM writes and runs verification code in a Deno/Docker sandbox during deep mode reviews

---

## 6. Static Analysis

### MVP

- **Built-in linters:** Yes — a curated set of linters bundled and run in a sandboxed cloud/local environment alongside AI review
  - Catches deterministic issues before LLM review (syntax errors, known anti-patterns, security smells)
  - Planned initial set: ESLint, Ruff, Semgrep, ShellCheck, Gitleaks (secrets detection)

### Future Phases

- Expand to 30–50+ tools (matching CodeRabbit's breadth): Clippy, RuboCop, golangci-lint, PHPStan, Checkov, TFLint, Trivy, etc.
- Per-tool enable/disable via `.reviewbuddy.yaml`

---

## 7. Review Output Features

### MVP

- **Bug detection with severity classification**
  - Categories: Bugs (Severe / Non-severe) + Flags (Investigate / Informational) — inspired by both Devin Review and CodeRabbit
  - Findings posted as native GitHub PR review comments (synced back to GitHub)
- **Codebase-aware chat / Q&A**
  - Full repository snapshot context (not just the diff)
  - Triggered via `@openreview` mention in any PR comment
  - Real-time streaming responses (SSE)
  - Auto-generated follow-up question suggestions after each answer
- **Grounded citations**
  - All findings and chat answers cite specific file paths and line numbers
- **Copy/move detection**
  - Detects when code is relocated between files and displays it as a move, not delete + insert
- **Fix suggestions (comments only)**
  - Suggested fixes posted as inline review comments — no automatic commits
  - Users apply fixes manually

### Future Phases

- PR walkthrough summary (plain-language description of the PR)
- Sequence / flow diagram generation (Mermaid)
- Release notes auto-generation (appended to PR description)
- Auto-fix application — apply fixes directly to branch or via stacked PR (on-demand, toggled by command)

---

## 8. GitHub Integration & Sync

### MVP

- **Full GitHub sync:** All review findings, comments, and suggestions posted as native GitHub PR review comments and approvals
- **GitHub Actions webhook:** Auto-trigger reviews via GitHub webhooks on PR events
- **Inline batch commenting:** Accumulate comments into a single review submission
- **Thread resolution tracking**
- **Comment attribution:** Findings attributed to `openreview[bot]`; user chat responses attributed to the user's GitHub identity

### Future Phases

- GitHub Enterprise Server support
- Code owner awareness (shield icon on files)
- Suggested reviewers / auto-assign based on git history
- Suggested labels / auto-apply labels
- Linked issue assessment (✅ Addressed / ❌ Not addressed / ❓ Unclear)
- PR description link insertion toggle

---

## 9. Customization & Configuration

### MVP

- **Config mechanism:** `.env` file for all settings (secrets, model selection, limits, globs)
  - Key variables: `MAIN_MODEL`, `SUB_MODEL`, `MAX_ITERATIONS`, `MAX_LLM_CALLS`, `MAX_FILE_BYTES`, `MAX_TOTAL_BYTES`, `INCLUDE_GLOBS`, `EXCLUDE_GLOBS`, `GITHUB_TOKEN`, `[LLM_PROVIDER]_API_KEY`
- **Automatic instruction file reading:**
  - `REVIEW.md` (project-specific review rules — at any directory level)
  - `AGENTS.md` / `CLAUDE.md`
  - `.cursorrules` / `.windsurfrules`

### Future Phases

- `.reviewbuddy.yaml` per-repo config file (version-controlled, team-shareable)
- Custom glob patterns for rule source files (specified in YAML config)
- Central org-wide config repository (e.g. `org/openreview-config`)
- Review profile options (e.g. chill / assertive)
- AI tone and language configuration (ISO language codes)
- Custom finishing touch recipes
- Custom pre-merge checks

---

## 10. Memory & Learning

### MVP

- **Persistent team learnings database**
  - Learns from team feedback on review comments over time
  - Stored locally (file-based, e.g. `~/.openreview/learnings/`) for self-hosted setups
  - Improves review quality with usage — avoids repeating false positives the team has dismissed

### Future Phases

- Cloud-synced learnings for teams using the cloud-hosted version
- Learning dashboard (active, never-used, created this week)
- CSV export/import of learnings
- Scope control: local (repo-specific) vs. global (org-wide)

---

## 11. Privacy & Data Handling

### MVP

- **Zero retention by default:** Code and diffs are never stored after a review completes
- **Local-first architecture:** All processing on the user's own infrastructure
- Data transmitted only to the user's chosen LLM API provider (Gemini / OpenAI / Anthropic) — governed by the user's own API agreements
- No telemetry, no external data collection

### Future Phases

- Opt-in cloud retention for cross-device access to review history and learnings
- SOC 2 Type II certification (for cloud-hosted tier)

---

## 12. Audit Trail & Logging

### MVP

- **Full JSON trace logs**
  - Every RLM iteration captured: reasoning steps, generated code, execution output, citations
  - Persisted locally at `~/.openreview/traces/`
  - Human-readable and machine-parsable for debugging and compliance

---

## 13. Analytics & Reporting

### MVP

- No analytics dashboard (keep MVP lean)

### Future Phases

- Rich analytics dashboard (inspired by CodeRabbit):
  - Time-to-merge, comment acceptance rate, severity breakdown
  - Issues found per category (security, performance, correctness, etc.)
  - Per-developer and per-repo metrics
- Scheduled reports delivered to Slack / Teams / Email / Discord

---

## 14. Third-Party Integrations

### MVP

- GitHub Actions webhook (core auto-review trigger)

### Future Phases

- Jira integration (linked issue context in reviews)
- Linear integration (linked issue context in reviews)
- Slack / Microsoft Teams notifications
- MCP server support (connect to Notion, SonarQube, Jenkins, etc. for external context)

---

## 15. CLI Details

### MVP

- `npx openreview review --url <PR-URL> -q "<question>"` — remote PR review, no local clone needed
- `npx openreview ask --repo <path>` — interactive local REPL
- `npx openreview serve` — start local Express 5 backend (for future web UI)
- Output formats: text, markdown, JSON (`--output` flag)
- `--model` flag to override LLM at runtime
- `--expert` flag for comprehensive SOLID/security/quality deep review mode
- `--submit` flag to post CLI review findings as GitHub PR comment (batch review + summary)

### Future Phases

- `--path <dir>` flag for local directory review without GitHub PR (Phase 2)
- `/issues/<number>` URL support for reviewing GitHub Issues alongside PRs (Phase 2)

---

## 16. Agent / Skill Ecosystem

### MVP

- `SKILL.md` file — installable as a skill in Claude Code, Cursor, Gemini CLI, Codex, and other compatible agentic platforms
- `--expert` flag triggers a comprehensive review covering SOLID principles, security, and code quality with severity-tagged findings and suggested fixes

---

## 17. Tech Stack (Locked)

| Layer                           | Technology                                                       | Version                                                       |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| **Core language**               | TypeScript / Node.js LTS                                         | TS 5.9 / Node 24 LTS                                          |
| **LLM orchestration**           | LangGraph.js (LangChain.js)                                      | @langchain/langgraph 1.2.2, @langchain/core 1.1.32            |
| **LLM providers**               | @langchain/openai, @langchain/anthropic, @langchain/google-genai | 1.2.13, 1.3.23, 2.1.25                                        |
| **API server**                  | Express.js                                                       | 5.2.1                                                         |
| **HTTP client**                 | axios                                                            | 1.13.6                                                        |
| **Package manager**             | pnpm                                                             | 10.x (replaces Yarn Classic v1, which is frozen/unmaintained) |
| **Build tool**                  | tsdown                                                           | Latest (replaces tsup, which is unmaintained)                 |
| **Testing framework**           | Vitest                                                           | 3.x (replaces Jest — native ESM, Vite-powered, faster)        |
| **Linter / Formatter**          | ESLint 10 + Prettier 3.8                                         | 10.0.3 / 3.8.1 (ESLint 10: flat config only, no .eslintrc)    |
| **CLI framework**               | commander                                                        | 14.0.3 (requires Node 20+)                                    |
| **Env loader**                  | dotenv                                                           | 17.3.1                                                        |
| **Sandbox execution (MVP)**     | Deno                                                             | 2.7.2                                                         |
| **Sandbox execution (Phase 2)** | Docker                                                           | —                                                             |
| **Learnings storage**           | JSON files per repo (`~/.openreview/learnings/`)                 | —                                                             |
| **Audit trace storage**         | JSON files (`~/.openreview/traces/`)                             | —                                                             |
| **GitHub Auth (MVP CLI)**       | Personal Access Token (PAT)                                      | —                                                             |
| **GitHub Auth (MVP Action)**    | GITHUB_TOKEN (from Actions secrets)                              | —                                                             |
| **GitHub Auth (Phase 3)**       | GitHub App (`openreview[bot]`)                                   | —                                                             |
| **GitHub Actions toolkit**      | @actions/core                                                    | 3.0.0                                                         |
| **Web UI (Phase 2)**            | React 19 + TypeScript + Vite 8                                   | 19.2.4 / 8.0.0 (Rolldown bundler, 10-30x faster)              |

---

## 18. Phased Roadmap Summary (Locked)

### Phase 1 — MVP

- Self-hosted deployment
- GitHub.com support
- CLI (`npx openreview`) + GitHub comment interface
- Configurable LLM backend (any provider)
- Fast mode + Deep RLM mode
- Sandboxed code execution (Deno 2.7)
- Built-in linters (ESLint, Ruff, Semgrep, ShellCheck, Gitleaks)
- Bug detection with severity classification
- Copy/move detection
- Fix suggestions as comments (no auto-apply)
- Full GitHub sync (native PR comments + approvals)
- GitHub Actions webhook trigger
- Codebase-aware chat with full repo context + SSE streaming
- Grounded citations (file + line)
- Follow-up question suggestions
- Instruction file reading (REVIEW.md, AGENTS.md, CLAUDE.md, .cursorrules, .windsurfrules)
- `.env` configuration
- Persistent local learnings database (`~/.openreview/learnings/`)
- Full JSON audit trace logs (`~/.openreview/traces/`)
- Zero data retention by default
- SKILL.md for agent ecosystem integration
- MIT license

### Phase 2 — Growth

- Web UI (React 19 + Vite 8, 3-panel: file browser, diff viewer, chat)
- `.reviewbuddy.yaml` per-repo config
- PR walkthrough summary + release notes
- Auto-fix application (branch commit or stacked PR)
- Jira + Linear integration
- Slack / Teams / Discord notifications
- Expanded linter suite (30–50+ tools)
- Basic per-PR metrics

### Phase 3 — Enterprise

- Hybrid cloud + self-hosted deployment
- GitHub Enterprise, GitLab, Azure DevOps, Bitbucket support
- IDE extension (VS Code, Cursor, Windsurf)
- Full analytics dashboard
- Scheduled reports
- MCP server integration
- Central org-wide config repository
- Custom pre-merge checks
- SOC 2 Type II (cloud tier)
- Metrics API
- Custom RBAC

---

_Generated by Claude Code on 2026-03-16 based on product Q&A session. Tech stack updated 2026-03-17. Implementation status updated 2026-03-24._
