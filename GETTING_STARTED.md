# Getting Started with OpenReview

> From zero to your first AI code review in under 5 minutes.

---

## Choose Your Path

| Path | Time | What You Need | Best For |
|------|------|---------------|----------|
| **A. Try it now** | 30 seconds | OpenAI API key + GitHub token | Quick evaluation |
| **B. GitHub Action** | 5 minutes | GitHub repo with Actions enabled | Automated PR reviews |
| **C. Local development** | 10 minutes | Node.js + pnpm + clone | Contributing / self-hosting |

---

## Path A: Try It Now (30 seconds)

No installation required. Just run:

```bash
OPENAI_API_KEY=sk-your-key GITHUB_TOKEN=ghp_your-token \
  npx openreview review --url https://github.com/owner/repo/pull/123
```

**Expected output:**

```
Fetching PR #123...
Running fast review...
OpenReview — fast mode | 5 files | 8s
Findings: 3

🔴 SEVERE src/auth.ts:42 — SQL injection vulnerability
  User input concatenated directly into query string.
  Fix: db.query('SELECT * FROM users WHERE id = $1', [userId])

🟠 NON-SEVERE src/utils.ts:18 — Missing null check
  ...
```

If you see findings, it works! If you see an error, check [Troubleshooting](#troubleshooting).

### Get Your API Keys

**OpenAI API Key:**
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click "Create new secret key"
3. Copy the key (starts with `sk-`)

**GitHub Token (for public repos — zero scopes needed):**
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Give it a name (e.g., "openreview")
4. Select **no scopes** (public repos don't need any)
5. Click "Generate token"
6. Copy the token (starts with `ghp_`)

**For private repos**, the token needs the `repo` scope.

---

## Path B: GitHub Action (5 minutes)

Automatically review every PR in your repository.

### Step 1: Add the workflow file

Create `.github/workflows/openreview.yml` in your repository:

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

### Step 2: Add your API key as a secret

1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `OPENAI_API_KEY`
4. Value: your OpenAI API key
5. Click **Add secret**

### Step 3: Open a PR

Open or update any PR — OpenReview will automatically post a review with findings as inline comments.

### Verify it works

After the Action runs, you should see:
- A comment: "🔍 **OpenReview** — Review started... results will appear shortly."
- Inline review comments on specific lines with severity badges
- A summary comment with a findings table

### Available comment commands

Once the Action is running, you can interact with OpenReview via PR comments:

```
@openreview review          # Trigger a fresh review
@openreview rlm             # Deep review (agentic mode)
@openreview <question>      # Ask about the code
@openreview list learnings  # Show what OpenReview has learned
@openreview forget: <text>  # Remove a learning
```

### Optional: Use a different LLM

```yaml
# Anthropic Claude
- uses: deuex-solutions/OpenReview@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    main-model: claude-sonnet-4-20250514

# Google Gemini
- uses: deuex-solutions/OpenReview@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
    main-model: gemini-2.0-flash
```

---

## Path C: Local Development (10 minutes)

Full setup for contributing or self-hosting.

### Prerequisites

| Tool | Version | Check | Install |
|------|---------|-------|---------|
| **Node.js** | ≥ 20 (24 LTS recommended) | `node --version` | [nodejs.org](https://nodejs.org/) or `nvm install 24` |
| **pnpm** | ≥ 10 | `pnpm --version` | `npm install -g pnpm` |
| **Deno** | ≥ 2.7 (optional, for RLM sandbox) | `deno --version` | `curl -fsSL https://deno.land/install.sh \| sh` |

#### macOS

```bash
# Install Node.js via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 24
nvm use 24

# Install pnpm
npm install -g pnpm

# Install Deno (optional — needed for RLM deep review sandbox)
curl -fsSL https://deno.land/install.sh | sh
```

#### Linux (Ubuntu/Debian)

```bash
# Install Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24

# Install pnpm
npm install -g pnpm

# Install Deno (optional)
curl -fsSL https://deno.land/install.sh | sh
```

#### Windows

Use WSL2 with Ubuntu, then follow the Linux instructions above.

### Step 1: Clone and install

```bash
git clone https://github.com/deuex-solutions/OpenReview.git
cd OpenReview
pnpm install
```

**Expected output:** `Done in X.Xs` with no errors.

### Step 2: Build

```bash
pnpm build
```

**Expected output:**

```
core build: ✔ Build complete in XXXms
cli build: ✔ Build complete in XXXms
action build: ✔ Build complete in XXXms
```

All three packages (core, cli, action) should build successfully.

### Step 3: Configure

```bash
cp .env.example .env
```

Open `.env` and set your API key:

```bash
# Required: at least one LLM provider
OPENAI_API_KEY=sk-your-key-here

# Required for CLI: GitHub access
GITHUB_PAT=ghp_your-token-here
```

#### Full configuration reference

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `GEMINI_API_KEY` | — | Google Gemini API key |
| `MAIN_MODEL` | `gpt-4o` | Primary model for review |
| `SUB_MODEL` | `gpt-4o-mini` | Secondary model for summaries |
| `MAX_ITERATIONS` | `12` | Max RLM loop iterations |
| `MAX_LLM_CALLS` | `35` | Max LLM calls per RLM session |
| `MAX_FILES` | `100` | Max files per review |
| `INCLUDE_GLOBS` | — | File patterns to include (e.g., `src/**/*.ts`) |
| `EXCLUDE_GLOBS` | — | File patterns to exclude (e.g., `dist/**`) |
| `OPENAI_BASE_URL` | — | Custom OpenAI-compatible endpoint |
| `DEFAULT_REVIEW_MODE` | `fast` | Default: `fast` or `rlm` |

See [`.env.example`](.env.example) for the complete list with linter toggles and all options.

### Step 4: Verify your setup

Run the verification checklist:

```bash
# 1. Check Node.js
node --version
# Expected: v24.x.x (or v20+)

# 2. Check pnpm
pnpm --version
# Expected: 10.x.x

# 3. Check the build
pnpm typecheck
# Expected: no errors

# 4. Run tests
pnpm test
# Expected: 321 tests passing

# 5. Check Deno (optional)
deno --version
# Expected: deno 2.7.x

# 6. Run your first review
GITHUB_TOKEN=ghp_your-token node cli/dist/main.mjs review \
  --url https://github.com/deuex-solutions/OpenReview/pull/6 \
  --output text --quiet
# Expected: findings with severity badges
```

If all 6 checks pass, your setup is complete.

### Step 5: Run a review

```bash
# Fast mode (< 60 seconds)
node cli/dist/main.mjs review --url https://github.com/owner/repo/pull/123

# Deep/RLM mode (agentic, 1-5 minutes)
node cli/dist/main.mjs review --url https://github.com/owner/repo/pull/123 --mode rlm

# Expert mode (SOLID + security + quality)
node cli/dist/main.mjs review --url https://github.com/owner/repo/pull/123 --expert

# JSON output for scripting
node cli/dist/main.mjs review --url https://github.com/owner/repo/pull/123 --output json --quiet

# Post findings directly as GitHub PR comments
node cli/dist/main.mjs review --url https://github.com/owner/repo/pull/123 --submit
```

### Step 6: Explore other commands

```bash
# Interactive Q&A about a PR
node cli/dist/main.mjs ask --url https://github.com/owner/repo/pull/123

# View past review traces
node cli/dist/main.mjs traces --list

# Start the API server
node cli/dist/main.mjs serve --port 3000
```

---

## How It Works

### Fast Mode

```
PR Diff → File Filtering → Diff Chunking → LLM Review (per chunk) → Citation Validation → Findings
                ↓                                    ↓
        Skip lock files,              Small PRs: compact prompt
        images, generated             Large PRs: comprehensive prompt
                                      Config/docs: file-type-aware prompt
```

- Automatically detects file types and adapts the review (code, config, docs, K8s manifests)
- Large diffs are chunked by file (~40K chars per LLM call) for reliable results
- Lock files, generated code, and binaries are skipped automatically
- Built-in linters (ESLint, Ruff, Semgrep, ShellCheck, Gitleaks) run in parallel

### Deep / RLM Mode

```
PR Diff → Reason → Write Code → Execute in Deno Sandbox → Observe → Repeat → Findings
              ↑                                               ↓
              └───────────── up to 12 iterations ─────────────┘
```

- LangGraph.js agentic loop with iterative reasoning
- Writes and executes verification scripts in a sandboxed Deno environment
- Falls back to reasoning-only mode if Deno is not installed
- Every finding is grounded with file + line citations

### Severity Levels

| Badge | Severity | Meaning |
|-------|----------|---------|
| 🔴 | **Bug — Severe** | Security risk or broken functionality. Fix required. |
| 🟠 | **Bug — Non-severe** | Incorrect behavior but not critical. Should review. |
| 🔍 | **Flag — Investigate** | May or may not be an issue. Worth a closer look. |
| ℹ️ | **Flag — Informational** | Explanatory note. No action required. |

---

## Customizing Reviews

### Instruction Files

Add these files to your repository to customize how OpenReview reviews your code:

| File | Scope | Purpose |
|------|-------|---------|
| `REVIEW.md` | Directory-level | Project-specific review rules |
| `AGENTS.md` | Directory-level | Agent behavior instructions |
| `CLAUDE.md` | Directory-level | Architecture and conventions |
| `.cursorrules` | Directory-level | Cursor-style rules |
| `.windsurfrules` | Directory-level | Windsurf-style rules |

Files at the repo root apply globally. Files in subdirectories are scoped to that subtree.

**Example `REVIEW.md`:**

```markdown
# Review Rules

- All API endpoints must validate input using Zod schemas
- Database queries must use parameterized statements, never string concatenation
- React components must not use `any` type — use proper TypeScript interfaces
- All async functions must have error handling
```

### Team Learnings

OpenReview learns from your feedback. When the bot flags a false positive, reply with:

- "ignore this" / "false positive" / "this is expected" / "not an issue"

The bot will remember and avoid repeating the same mistake. Learnings are stored at `~/.openreview/learnings/`.

---

## Troubleshooting

### "No GitHub token found"

```
Error: No GitHub token found. Set GITHUB_TOKEN or GITHUB_PAT in your .env file.
```

**Fix:** Set `GITHUB_PAT` in your `.env` file or pass `GITHUB_TOKEN` as an environment variable.
- For public repos: a classic PAT with **zero scopes** works.
- For private repos: the PAT needs the `repo` scope.
- Create one at [github.com/settings/tokens](https://github.com/settings/tokens).

### "requires at least one LLM API key"

```
Error: OpenReview requires at least one LLM API key.
```

**Fix:** Set at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` in your `.env`.

### "GitHub API returned 404"

```
Error: GitHub API returned 404 for /repos/.../pulls/...
```

**Fix:** This means either:
1. The PR or repository doesn't exist (check the URL)
2. The repo is private and your token lacks the `repo` scope

### "Deno is not installed"

RLM deep mode requires Deno 2.7+ for sandboxed code execution. Without Deno, RLM still works in reasoning-only mode (no sandbox execution).

**Fix:** Install Deno:
```bash
curl -fsSL https://deno.land/install.sh | sh
```

### Review returns 0 findings

This can happen when:
- The PR has genuinely no issues (clean code!)
- The diff is very large and exceeds context limits — try reviewing with `--expert` for deeper analysis
- The model is being conservative — try a different model with `--model gpt-4o`

### Review takes too long (> 60 seconds)

Large PRs (50+ files, 5000+ lines) take longer because the diff is chunked and each chunk is reviewed separately. This is expected behavior — the trade-off is thorough coverage.

For faster results on large PRs:
- Use `EXCLUDE_GLOBS` to skip test files or generated code
- Set `MAX_FILES=50` to limit the number of files reviewed

### Linter not found warnings

If a linter (ESLint, Ruff, etc.) is not installed, it's automatically skipped with a warning. This is non-fatal — the review continues without that linter's findings.

To install all linters:
```bash
# macOS
brew install ruff semgrep shellcheck gitleaks

# Ubuntu/Debian
pip install ruff
pip install semgrep
apt-get install shellcheck
brew install gitleaks  # or download from GitHub releases
```

---

## Next Steps

- **Customize your reviews** — add a `REVIEW.md` to your repo with project-specific rules
- **Set up the GitHub Action** — automate reviews on every PR
- **Try RLM mode** — `--mode rlm` for deeper agentic analysis
- **Explore traces** — `traces --list` to see detailed review logs
- **Contribute** — see [CONTRIBUTING.md](CONTRIBUTING.md)

---

_OpenReview — Getting Started Guide — 2026-03-24_
