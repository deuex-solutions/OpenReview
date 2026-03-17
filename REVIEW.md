# OpenReview — Review Rules

These are OpenReview's own review rules, applied when reviewing this repository (dogfooding).

## Code Style

- All code is TypeScript with strict mode enabled
- Use ESM imports (`import`/`export`), never CommonJS (`require`/`module.exports`)
- Use `type` imports for type-only imports (`import type { Foo } from './bar.js'`)
- Imports must be ordered: builtin → external → internal → parent → sibling → index
- Single quotes, trailing commas, 100 char line width (enforced by Prettier)

## Architecture

- Business logic belongs in `core/` — `cli/` and `action/` are thin wrappers
- GitHub API calls go through `core/src/github/client.ts`, never called directly elsewhere
- LLM calls go through `core/src/llm/router.ts`, never instantiate models directly
- All findings use the `ReviewFinding` interface — no ad-hoc finding formats

## Error Handling

- Never swallow errors silently — at minimum `console.error` with context
- GitHub API errors should include the HTTP status code and endpoint in the message
- Linter failures should be non-fatal — skip with a warning, never crash the review

## Testing

- Every module should have a corresponding `.test.ts` file
- Mock external services (GitHub API, LLM providers) — never make real API calls in tests
- Test edge cases: empty diffs, binary files, rate limits, timeout scenarios

## Security

- Never log or trace API keys, tokens, or secrets
- Validate all user input from GitHub webhook payloads
- Deno sandbox must run with `--allow-read` only — no network, no write, no env access
