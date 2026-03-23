# Contributing to OpenReview

Thank you for your interest in contributing to OpenReview! This document covers the process for contributing to this project.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone git@github.com:<your-username>/OpenReview.git
   cd OpenReview
   ```
3. **Install dependencies:**
   ```bash
   nvm use        # Node 22 via .nvmrc
   pnpm install
   ```
4. **Create a branch** for your work:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development Workflow

### Build

```bash
pnpm build                          # all workspaces
pnpm --filter @openreview/core build # single workspace
```

### Test

```bash
pnpm test                                        # all tests
npx vitest run core/src/config/env.test.ts       # single file
pnpm test:watch                                  # watch mode
```

### Lint & Format

```bash
pnpm lint          # check
pnpm lint:fix      # auto-fix
pnpm format        # format all files
pnpm format:check  # check formatting
```

All code must pass `pnpm lint`, `pnpm typecheck`, and `pnpm test` before submitting a PR.

## Project Structure

```
core/    # @openreview/core — review engine, LLM router, GitHub client
cli/     # openreview — CLI (npx openreview)
action/  # @openreview/action — GitHub Action
web/     # Phase 2 placeholder (React 19 + Vite 8)
```

- `core/` contains all business logic. `cli/` and `action/` are thin wrappers.
- All packages use ESM (`"type": "module"`).
- ESLint 10 flat config (`eslint.config.js`) — no `.eslintrc` files.
- Vitest for testing — no Jest.
- tsdown for bundling — no tsup.

## Submitting a Pull Request

1. Ensure your branch is up to date with `main`:
   ```bash
   git fetch origin
   git rebase origin/main
   ```
2. Run all checks:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test
   ```
3. Push your branch and open a PR against `main`.
4. Fill in the PR template with a description of your changes.
5. Wait for CI to pass and a maintainer to review.

## Branch Naming

| Prefix      | Use                           |
| ----------- | ----------------------------- |
| `feat/`     | New features                  |
| `fix/`      | Bug fixes                     |
| `refactor/` | Code refactoring              |
| `docs/`     | Documentation only            |
| `test/`     | Test additions or fixes       |
| `chore/`    | Build, CI, dependency updates |

## Commit Messages

Use conventional commits:

```
feat: add copy/move detection to diff parser
fix: handle rate limit 403 in GitHub client
docs: update CLI examples in README
```

## Reporting Issues

Open an issue on GitHub with:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version, OS, and relevant environment details

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
