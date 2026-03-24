# OpenReview — Agent Skill Definition

## Description

OpenReview is an open-source, agentic code review tool. It analyzes GitHub Pull Requests using AI-powered bug detection, sandboxed code execution, and built-in linters, then posts findings as native GitHub PR review comments.

## Prerequisites

- Node.js ≥ 20
- One of: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` set in environment
- `GITHUB_TOKEN` or `GITHUB_PAT` available for GitHub API access

## Usage

```bash
# Review a PR (Fast mode — single-shot, < 60 seconds)
npx openreview review --url <PR-URL>

# Review a PR (Deep/RLM mode — agentic loop with sandboxed execution)
npx openreview review --url <PR-URL> --mode rlm

# Expert mode — comprehensive SOLID, security, and code quality review
npx openreview review --url <PR-URL> --expert

# Ask a codebase-aware question about a PR
npx openreview ask --url <PR-URL>

# Output as JSON (for CI/CD pipelines)
npx openreview review --url <PR-URL> --output json --quiet

# View past review traces
npx openreview traces --list

# Start API server
npx openreview serve --port 3000
```

## Expert Mode (`--expert`)

Triggers a comprehensive review covering:

- **SOLID principles** — single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion
- **Security** — injection vulnerabilities, authentication/authorization gaps, secrets exposure, OWASP top 10
- **Code quality** — error handling, edge cases, performance, maintainability, naming, duplication

Findings are severity-tagged (Severe Bug, Non-severe Bug, Investigate, Informational) with suggested fixes in markdown format.

## Examples

### Claude Code

```
Review this PR for bugs and security issues: https://github.com/owner/repo/pull/123
```

### Cursor

```
@openreview review --url https://github.com/owner/repo/pull/123 --expert
```

### Gemini CLI

```
Use the openreview skill to review https://github.com/owner/repo/pull/123
```

### Codex

```
Run openreview in expert mode on https://github.com/owner/repo/pull/123
```

## API Key Verification

Before running, verify your setup:

```bash
# Check that at least one LLM API key is set
echo "OpenAI: ${OPENAI_API_KEY:+SET}"
echo "Anthropic: ${ANTHROPIC_API_KEY:+SET}"
echo "Gemini: ${GEMINI_API_KEY:+SET}"

# Check GitHub access
echo "GitHub: ${GITHUB_TOKEN:+SET}${GITHUB_PAT:+SET}"
```

At least one LLM key and one GitHub token are required.
