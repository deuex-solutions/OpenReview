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
- **Impact Analysis** — computes the blast radius of changes, scoring transitive dependents to prioritize high-impact findings.

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

```bash
# Review a PR (Fast mode)
npx openreview review --url https://github.com/owner/repo/pull/123

# Review a PR (Deep/RLM mode — agentic loop with sandbox)
npx openreview review --url https://github.com/owner/repo/pull/123 --mode rlm

# Expert mode (SOLID + security + quality deep review)
npx openreview review --url https://github.com/owner/repo/pull/123 --expert

# Output as JSON (for CI/CD integration)
npx openreview review --url <PR-URL> --output json --quiet

# Post findings directly as GitHub PR comments
npx openreview review --url <PR-URL> --submit

# Ask questions about a PR interactively
npx openreview ask --url https://github.com/owner/repo/pull/123

# View review trace logs
npx openreview traces --list

# Start the API server
npx openreview serve --port 3000
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
| `--impact`       | auto     | Enable or disable (`--no-impact`) dependency impact analysis |

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
| `GITHUB_PAT`          | —             | GitHub Personal Access Token (CLI mode)      |

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

# Run tests (321 tests)
pnpm test

# Type checking
pnpm typecheck

# Lint & format
pnpm lint
pnpm format:check
```

See [GETTING_STARTED.md](GETTING_STARTED.md) for the full setup guide, [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines, and [SETUP.md](SETUP.md) for detailed configuration reference.

## Roadmap

- **Phase 1 (MVP)** ✅ — CLI + GitHub Action, Fast + RLM review, codebase chat, learnings, trace logging, Impact Analysis
- **Phase 2 (Growth)** — Web UI, auto-fix, Jira/Linear integration, 30+ linters, Docker sandbox
- **Phase 3 (Enterprise)** — Multi-platform (GitLab, Azure DevOps, Bitbucket), IDE extension, cloud hosting, analytics

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
