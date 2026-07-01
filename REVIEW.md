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
- All findings use the `ReviewFinding` interface from `core/src/review/types.ts` — no ad-hoc finding formats
- Large diffs are chunked by file boundary (~40K chars per chunk) — never send >100K to the LLM
- Non-reviewable files (lock files, generated code, images) are filtered before LLM review
- Structured LLM output via Zod schemas is preferred; raw text parsing is the fallback
- Small PRs (≤5 files, ≤3K chars) use compact prompts; large PRs use comprehensive prompts
- File-type detection adapts the reviewer persona (code / config / docs / K8s)

## CLI Conventions

- Progress messages go to `stderr`, findings go to `stdout` (for clean piping)
- `--submit` posts findings to GitHub; without it, output is local only
- All commands handle missing tokens/keys with actionable error messages including links
- Summary comments use replace-not-duplicate strategy via `<!-- openreview-summary -->` marker

## Error Handling

- Never swallow errors silently — at minimum `console.error` with context
- GitHub API errors should include the HTTP status code and endpoint in the message
- Auth errors (401/403/404) provide specific guidance on token scopes needed
- Linter failures should be non-fatal — skip with a warning, never crash the review
- LLM failures should fall back gracefully (structured → raw → retry)

## Testing

- Every module should have a corresponding `.test.ts` file
- Mock external services (GitHub API, LLM providers) — never make real API calls in tests
- Test edge cases: empty diffs, binary files, rate limits, timeout scenarios
- QA validation: 10 test PRs across 5 languages must catch ≥8/10 bugs

## Security

- Never log or trace API keys, tokens, or secrets — `TraceLogger` scrubs secrets automatically
- Validate all user input from GitHub webhook payloads
- Deno sandbox must run with `deno run --allow-read=<script> --deny-net --deny-env --deny-run`
- Auth scheme detection: `ghp_` tokens use `token` scheme, others use `Bearer`
