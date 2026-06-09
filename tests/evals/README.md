# OpenReview Evaluations

This directory contains end-to-end (E2E) evaluations for OpenReview's core heuristics and LLM pipelines.

## Running Evaluations

You can execute evaluations via vitest. Since they involve real file I/O or LLM calls, they might be slower than unit tests.

```bash
# Run all evaluations
npx vitest run tests/evals

# Run specific evaluation
npx vitest run tests/evals/impact.eval.ts
```

## Evaluated Components

### Impact Analysis (`impact.eval.ts`)
- **Accuracy**: Verifies the dependency graph traversal can correctly identify direct and transitive dependents (up to N degrees) using Tree-sitter.
- **Performance**: Asserts that constructing the AST graph and traversing paths executes within the strict target thresholds (e.g. < 50ms for small graphs).
- **Mapping**: Validates component-to-page/route mapping conventions.
