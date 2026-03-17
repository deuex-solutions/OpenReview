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

# Review a PR (Deep/RLM mode)
npx openreview review --url https://github.com/owner/repo/pull/123 --mode rlm

# Expert mode (SOLID + security + quality deep review)
npx openreview review --url https://github.com/owner/repo/pull/123 --expert

# Ask a question about the PR
npx openreview ask --repo .

# Output formats
npx openreview review --url <PR-URL> --output json
```

### GitHub Comment Commands

| Command | Description |
|---|---|
| `@openreview review` | Trigger a fresh Fast mode review |
| `@openreview rlm` | Trigger Deep/RLM mode review |
| `@openreview <question>` | Ask a codebase-aware question |
| `@openreview list learnings` | List stored learnings for this repo |
| `@openreview forget: <description>` | Delete a stored learning |

## Configuration

Copy `.env.example` to `.env` and set your API key:

```bash
cp .env.example .env
```

Key settings:

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `GEMINI_API_KEY` | — | Google Gemini API key |
| `MAIN_MODEL` | `gpt-4o` | Primary model for review and chat |
| `SUB_MODEL` | `gpt-4o-mini` | Secondary model for suggestions |
| `MAX_FILES` | `100` | Max files per review |
| `MAX_ITERATIONS` | `20` | Max RLM loop iterations |
| `DEFAULT_REVIEW_MODE` | `fast` | Default mode: `fast` or `rlm` |
| `INCLUDE_GLOBS` | — | File patterns to include |
| `EXCLUDE_GLOBS` | — | File patterns to exclude |

See [`.env.example`](.env.example) for the full list.

## Review Modes

### Fast Mode

Single-shot structured LLM call over the full diff. Runs bundled linters in parallel. Completes in < 60 seconds.

Findings are categorized:
- **Bug — Severe** — requires immediate fix
- **Bug — Non-severe** — should be reviewed
- **Flag — Investigate** — warrants closer examination
- **Flag — Informational** — explanatory, no action required

### Deep / RLM Mode

Agentic review using LangGraph.js. The LLM reasons about the code, writes verification scripts, executes them in a Deno sandbox, observes results, and repeats — up to `MAX_ITERATIONS`. Every finding includes grounded citations with file paths and line numbers.

Triggered via `@openreview rlm` or `--mode rlm`.

## Instruction Files

OpenReview automatically reads these files from your repository to customize reviews:

1. `REVIEW.md` — project-specific review rules (any directory level)
2. `AGENTS.md`
3. `CLAUDE.md`
4. `.cursorrules`
5. `.windsurfrules`

Files at subdirectory level are scoped to code in that subtree.

## Tech Stack

| Layer | Technology |
|---|---|
| Core language | TypeScript / Node.js (≥ 20) |
| LLM orchestration | LangGraph.js |
| Package manager | pnpm |
| Build tool | tsdown |
| Testing | Vitest |
| Linting | ESLint 10 + Prettier |
| Sandbox | Deno (MVP) → Docker (Phase 2) |

## Development

```bash
# Prerequisites: Node.js ≥ 20, pnpm
nvm use           # uses .nvmrc (Node 22)
pnpm install

# Build
pnpm build

# Test
pnpm test

# Lint & format
pnpm lint
pnpm format:check
```

## Roadmap

- **Phase 1 (MVP)** — CLI + GitHub Action, Fast + RLM review, codebase chat, learnings
- **Phase 2 (Growth)** — Web UI, auto-fix, Jira/Linear integration, 30+ linters, Docker sandbox
- **Phase 3 (Enterprise)** — Multi-platform (GitLab, Azure DevOps, Bitbucket), IDE extension, cloud hosting, analytics

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
