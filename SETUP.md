# OpenReview — Setup & Deployment Guide

> Get AI-powered code reviews running in under 5 minutes.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start — CLI](#quick-start--cli)
3. [Quick Start — GitHub Action](#quick-start--github-action)
4. [Configuration Reference](#configuration-reference)
5. [Linter Setup](#linter-setup)
6. [Development Setup](#development-setup)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement     | Version   | Notes                                                |
| --------------- | --------- | ---------------------------------------------------- |
| **Node.js**     | >= 20 LTS | Node 22 or 24 recommended. Check with `node -v`      |
| **pnpm**        | >= 10.x   | Install: `npm install -g pnpm@latest`                |
| **Git**         | >= 2.x    | Required for repository operations                   |
| **LLM API key** | —         | At least one of: OpenAI, Anthropic, or Google Gemini |

### Optional (for linter integrations)

These are **not required** — if a linter is not installed, OpenReview skips it gracefully.

| Tool                                                 | Install                                               | What it catches                         |
| ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| ESLint                                               | Bundled via `npx` (no install needed)                 | JS/TS syntax errors, bad patterns       |
| [Ruff](https://docs.astral.sh/ruff/installation/)    | `pip install ruff` or `brew install ruff`             | Python linting (replaces Flake8/Pylint) |
| [Semgrep](https://semgrep.dev/docs/getting-started/) | `pip install semgrep` or `brew install semgrep`       | Multi-language SAST security patterns   |
| [ShellCheck](https://www.shellcheck.net/)            | `brew install shellcheck` or `apt install shellcheck` | Bash/shell script bugs                  |
| [Gitleaks](https://github.com/gitleaks/gitleaks)     | `brew install gitleaks` or download binary            | Hardcoded secrets and API keys          |

---

## Quick Start — CLI

### 1. Create your `.env` file

```bash
# In the repo you want to review (or your home directory)
cp .env.example .env
```

Edit `.env` and add at least one LLM API key:

```bash
# Choose your provider (set at least one)
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GEMINI_API_KEY=AI...

# GitHub Personal Access Token (for fetching PR data)
GITHUB_PAT=ghp_...
```

#### Getting a GitHub PAT

1. Go to **GitHub > Settings > Developer Settings > Personal Access Tokens > Fine-grained tokens**
2. Create a new token with these permissions:
   - **Repository access**: Select the repos you want to review
   - **Permissions**: `Pull requests: Read`, `Contents: Read`
3. Copy the token into your `.env` as `GITHUB_PAT`

### 2. Run a review

```bash
# Review any public or accessible PR
npx openreview review --url https://github.com/owner/repo/pull/123

# Deep RLM mode (agentic, takes 2-5 minutes)
npx openreview review --url https://github.com/owner/repo/pull/123 --mode rlm

# Output as JSON
npx openreview review --url https://github.com/owner/repo/pull/123 --output json

# Expert mode (SOLID + security + quality deep review)
npx openreview review --url https://github.com/owner/repo/pull/123 --expert
```

---

## Quick Start — GitHub Action

Add this workflow to your repository at `.github/workflows/openreview.yml`:

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
  issues: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: openreview/action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Set at least one LLM API key
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          # anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          # gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
```

### Setting up secrets

1. Go to **Your Repo > Settings > Secrets and variables > Actions**
2. Add your LLM provider API key as a secret (e.g., `OPENAI_API_KEY`)
3. `GITHUB_TOKEN` is provided automatically by GitHub Actions — no setup needed

### Interacting via comments

Once the Action is installed, you can use these commands in any PR comment:

| Command                             | Action                                        |
| ----------------------------------- | --------------------------------------------- |
| _(automatic)_                       | Fast mode review runs on every PR open/update |
| `@openreview rlm`                   | Trigger deep RLM agentic review               |
| `@openreview <question>`            | Ask a codebase-aware question                 |
| `@openreview list learnings`        | Show what the bot has learned                 |
| `@openreview forget: <description>` | Delete a specific learning                    |

---

## Configuration Reference

All settings are configured via `.env`. Copy `.env.example` to get started.

### LLM Settings

| Variable            | Default       | Description                                   |
| ------------------- | ------------- | --------------------------------------------- |
| `OPENAI_API_KEY`    | —             | OpenAI API key                                |
| `ANTHROPIC_API_KEY` | —             | Anthropic API key                             |
| `GEMINI_API_KEY`    | —             | Google Gemini API key                         |
| `MAIN_MODEL`        | `gpt-4o`      | Primary model for review and chat             |
| `SUB_MODEL`         | `gpt-4o-mini` | Secondary model for summaries and suggestions |
| `OPENAI_BASE_URL`   | —             | Custom OpenAI-compatible endpoint URL         |

**Supported model prefixes:**

- `gpt-*`, `o1*`, `o3*` → routes to OpenAI
- `claude-*` → routes to Anthropic
- `gemini-*` → routes to Google Gemini
- Any other string → routes to OpenAI (for compatible endpoints)

### Review Limits

| Variable          | Default   | Description                         |
| ----------------- | --------- | ----------------------------------- |
| `MAX_ITERATIONS`  | `12`      | Max RLM loop iterations             |
| `MAX_LLM_CALLS`   | `35`      | Max total LLM calls per RLM session |
| `MAX_FILES`       | `100`     | Max files per review                |
| `MAX_FILE_BYTES`  | `200000`  | Max bytes per individual file       |
| `MAX_TOTAL_BYTES` | `5000000` | Max total snapshot size             |

### File Filtering

| Variable        | Default                  | Description                                                        |
| --------------- | ------------------------ | ------------------------------------------------------------------ |
| `INCLUDE_GLOBS` | _(empty — include all)_  | Comma-separated globs to include (e.g., `src/**/*.ts,src/**/*.py`) |
| `EXCLUDE_GLOBS` | _(empty — exclude none)_ | Comma-separated globs to exclude (e.g., `dist/**,*.lock,*.min.js`) |

### Linter Toggles

| Variable            | Default | Description                          |
| ------------------- | ------- | ------------------------------------ |
| `LINTER_ESLINT`     | `true`  | Enable ESLint for JS/TS files        |
| `LINTER_RUFF`       | `true`  | Enable Ruff for Python files         |
| `LINTER_SEMGREP`    | `true`  | Enable Semgrep for security scanning |
| `LINTER_SHELLCHECK` | `true`  | Enable ShellCheck for shell scripts  |
| `LINTER_GITLEAKS`   | `true`  | Enable Gitleaks for secret detection |

### Review Behavior

| Variable                   | Default | Description                                            |
| -------------------------- | ------- | ------------------------------------------------------ |
| `REVIEW_DRAFTS`            | `false` | Whether to review draft PRs                            |
| `MOVE_DETECTION_THRESHOLD` | `0.8`   | Similarity threshold for copy/move detection (0.0–1.0) |
| `DEFAULT_REVIEW_MODE`      | `fast`  | Default review mode: `fast` or `rlm`                   |

### Storage

| Variable          | Default         | Description                                 |
| ----------------- | --------------- | ------------------------------------------- |
| `GITHUB_PAT`      | —               | GitHub Personal Access Token (CLI mode)     |
| `OPENREVIEW_HOME` | `~/.openreview` | Base directory for learnings and trace logs |

---

## Linter Setup

OpenReview runs linters in parallel during Fast mode reviews. Each linter is **optional** — if the binary is not found on `$PATH`, it is silently skipped with a warning.

### Recommended setup (macOS)

```bash
# Python linting
pip install ruff

# Security scanning
pip install semgrep

# Shell script analysis
brew install shellcheck

# Secret detection
brew install gitleaks
```

### Recommended setup (Ubuntu / CI)

```bash
# Python linting
pip install ruff

# Security scanning
pip install semgrep

# Shell script analysis
sudo apt-get install -y shellcheck

# Secret detection
curl -sSfL https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_linux_amd64.tar.gz | \
  tar -xz -C /usr/local/bin gitleaks
```

### Disabling linters

Set any linter to `false` in your `.env`:

```bash
LINTER_SEMGREP=false
LINTER_GITLEAKS=false
```

---

## Development Setup

### Clone and install

```bash
git clone https://github.com/openreview/openreview.git
cd openreview
pnpm install
```

### Build

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @openreview/core build
pnpm --filter openreview build        # CLI
pnpm --filter @openreview/action build
```

### Test

```bash
pnpm test              # Run all tests once
pnpm test:watch        # Watch mode
```

### Lint & Format

```bash
pnpm lint              # Check for lint errors
pnpm lint:fix          # Auto-fix lint errors
pnpm format            # Format code with Prettier
pnpm format:check      # Check formatting only
pnpm typecheck         # TypeScript type checking
```

### Project structure

```
openreview/
├── core/          # @openreview/core — Review engine (LLM, GitHub, linters)
├── cli/           # openreview — CLI wrapper (commander)
├── action/        # @openreview/action — GitHub Action entry point
├── web/           # Phase 2 placeholder (React 19 + Vite 8)
└── progress-docs/ # Planning documents (PRD, milestones, todo)
```

### Custom instruction files

Create any of these files in your repository to provide project-specific review rules:

| File             | Scope                                              |
| ---------------- | -------------------------------------------------- |
| `REVIEW.md`      | Highest priority — your team's review standards    |
| `AGENTS.md`      | Agent-specific instructions                        |
| `CLAUDE.md`      | Claude Code instructions (also read by OpenReview) |
| `.cursorrules`   | Cursor IDE rules (also read by OpenReview)         |
| `.windsurfrules` | Windsurf IDE rules (also read by OpenReview)       |

Files at the repository root apply **globally**. Files in subdirectories apply only to code in that subtree. Total instruction content is capped at ~10,000 tokens.

---

## Troubleshooting

### "No LLM API key configured"

You must set at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` in your `.env` file.

### "GitHub PAT not set" (CLI mode)

Set `GITHUB_PAT` in your `.env` file. The token needs `repo` read access for the repository you are reviewing.

### Linter warnings: "[linter] not found — skipping"

This is expected if you haven't installed the optional linter. OpenReview works fine without linters — they just add extra static analysis findings alongside the AI review.

### Rate limiting (GitHub API)

OpenReview automatically handles GitHub API rate limits. If you see rate limit errors, it will wait until the reset window passes. For heavy usage, consider using a GitHub App token instead of a PAT (higher rate limits).

### Large PRs timing out

For PRs with many files, adjust these settings:

```bash
MAX_FILES=50              # Reduce max files reviewed
EXCLUDE_GLOBS=**/*.lock,dist/**,*.min.js   # Exclude generated files
```

### Build errors after cloning

```bash
# Clean reinstall
rm -rf node_modules core/node_modules cli/node_modules action/node_modules
pnpm install
pnpm build
```

---

_OpenReview — MIT Licensed — [github.com/openreview](https://github.com/openreview)_
