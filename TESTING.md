# TESTING.md

This file provides testing and evaluation instructions for Claude Code when working on this project.

## When to Trigger

After completing any implementation task (code edits, new features, bug fixes, refactoring) where all to-do items are done, Claude MUST:

1. **Ask:** "Should I write tests for these changes?"
2. **If yes, ask which types:** "Which tests do you want?"
   - Unit tests
   - Integration tests
   - End-to-end tests
   - AI evaluations
   - All of the above
3. **Wait for the user's selection** before writing any tests.

**DO NOT write tests automatically without asking first.**
**DO NOT skip this prompt after implementation tasks.**

## Test Location

The first time writing tests for a project, Claude MUST ask:

> "Where should tests live in this project? (e.g., `tests/`, co-located with source, or another location?)"

Save the answer in this file under the [Project Test Config](#project-test-config) section below so it doesn't need to be asked again.

## Test Framework

Claude MUST detect the test framework from the project's `package.json`, config files (jest.config, vitest.config, etc.), and existing test files. Use whatever the project already uses. If no test framework is detected, ask the user which one to use and record it below.

## Test Writing Guidelines

- Match existing test style and patterns in the project
- Test the actual changes made, not unrelated code
- Cover happy paths, edge cases, and error scenarios
- Keep tests focused and readable
- Do not over-mock — prefer real implementations where feasible
- Name test files to match the source file being tested

## AI Evaluations

After completing implementation tasks, Claude MUST also run AI evaluations. This includes:

### 1. LLM-as-Judge (Self-Review)

Claude reviews its own code changes and evaluates:

- **Correctness** — Does the code do what was asked? Any logic errors?
- **Edge cases** — Are boundary conditions handled?
- **Security** — Any vulnerabilities introduced (injection, XSS, auth bypass, etc.)?
- **Performance** — Any obvious inefficiencies or N+1 queries?
- **Maintainability** — Is the code readable and well-structured?

Rating scale: Pass / Needs Attention / Fail for each category.

### 2. Automated Eval Scripts

For AI-powered features (LLM calls, prompt engineering, AI pipelines), Claude writes eval scripts that test:

- Prompt quality and output format compliance
- Response accuracy against expected outputs
- Edge case handling in AI responses

### 3. Code Quality Scoring

Claude runs available static analysis tools and reports:

- TypeScript errors (`npx tsc --noEmit`)
- Lint issues (`npm run lint` or equivalent)
- Complexity metrics if tools are available

### Eval Results Presentation

After running evals, Claude MUST ask:

> "Do you want the eval report shown here in chat, saved to a file, or both?"

Wait for the user's response before presenting results.

## Project Test Config

<!-- Claude: Record project-specific test configuration below after asking the user -->
<!-- Example:
- Test location: tests/
- Test framework: Vitest
- Test command: npm run test
-->
