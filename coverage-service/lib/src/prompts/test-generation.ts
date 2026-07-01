import {  inferSourceImportPath, inferTestFilePath, sourceFileExtension } from '../test-paths';
import { GenerationMode, type TestGenerationContext } from '../types';

function formatRepoPackages(packages: string[]): string {
  if (packages.length === 0) return '(none detected)';
  return packages.map((pkg) => `- ${pkg}`).join('\n');
}

function formatFullSourceHeader(ctx: TestGenerationContext): string {
  if (!ctx.useFullSource && !ctx.useEntireFileForGeneration) return '';

  const coverageNote =
    ctx.fileDiffCoverage != null
      ? `Diff coverage for this file: ${ctx.fileDiffCoverage.toFixed(1)}% (below threshold).`
      : 'Diff coverage for this file is below threshold.';

  const entireFileNote = ctx.useEntireFileForGeneration
    ? `Overall PR diff coverage is low — analyze and test the **entire production file**, not only the diff hunks. Target all uncovered lines listed below (full-file line coverage from Cobertura).`
    : 'The complete production file from the PR branch is provided below — not a snippet. Read the entire file before writing tests.';

  return `## Full source file (PR branch)
${coverageNote}
${entireFileNote}

`;
}

function formatExportedSymbols(ctx: TestGenerationContext): string {
  if (!ctx.exportedSymbols?.length) {
    return '(none — module has no export statements; use subprocess/integration testing, do NOT import private functions)';
  }
  return ctx.exportedSymbols.map((s) => `- ${s}`).join('\n');
}

function outputTestPath(ctx: TestGenerationContext): string {
  return ctx.testOutputPath ?? inferTestFilePath(ctx.file, ctx.framework);
}

function formatTestCountGuidance(ctx: TestGenerationContext): string {
  const exports = ctx.exportedSymbols ?? [];
  if (exports.length > 4) {
    return `- Write focused tests covering **each exported symbol** (${exports.length} total: ${exports.join(', ')}). At least one test per symbol, especially for uncovered lines.`;
  }
  if (exports.length > 0) {
    return `- Write 2–${Math.max(4, exports.length)} focused tests covering exported symbols (${exports.join(', ')}). At least one behavior per symbol when uncovered.`;
  }
  return '- Write 2–4 short, focused tests. One behavior per test.';
}

function formatTestOutputMode(ctx: TestGenerationContext): string {
  const path = outputTestPath(ctx);
  const countGuidance = formatTestCountGuidance(ctx);

  if (ctx.generationMode === GenerationMode.COVERAGE_GAP) {
    const lineScope = ctx.useEntireFileForGeneration
      ? 'uncovered lines in the full file'
      : 'uncovered diff lines';
    return `## Mode: COVERAGE GAP — append incremental tests
- Output path: \`${path}\`
- DO NOT rewrite existing tests in Existing Tests or Previous Generated Tests.
- DO NOT duplicate test names or behaviors already present.
- Generate ONLY additional test cases that execute these ${lineScope}: ${ctx.uncoveredLines}
- Reuse existing mocks and fixtures from Existing Tests.
- Return the **complete updated test file** (all existing + new tests only).`;
  }

  if (ctx.isConfigExportFile) {
    return `## Mode: CONFIG / PROMPT EXPORT smoke tests
- Output path: \`${path}\`
- This file exports constants, prompts, schemas, or configuration — never skip it.
- Write lightweight smoke tests that import exported symbols and assert basic invariants:
  - String prompts contain expected keywords (e.g. expect(SYSTEM_PROMPT).toContain("extract"))
  - Schemas/objects have expected keys or non-zero length
  - Constants are defined and non-empty
- Suggested exports to test: ${ctx.smokeTestExports?.join(', ') || '(detect from source)'}
- Do NOT call external APIs.`;
  }

  if (ctx.isUpdatingExistingTest) {
    return `## Mode: UPDATE existing test file
- Output path: \`${path}\` (this file already exists — do NOT create a new file elsewhere).
- Keep all existing tests that still apply; do not remove or rewrite passing tests unnecessarily.
${countGuidance}
- Do not duplicate test names or behaviors already present in Existing Tests.
- Return the **complete updated test file** (existing + new tests).`;
  }
  return `## Mode: CREATE new test file
- Output path: \`${path}\`
${countGuidance}`;
}

function formatComplexServiceSection(ctx: TestGenerationContext): string {
  if (!ctx.isComplexServiceFile) return '';

  return `## Complex service file (mandatory)
This file contains retry logic, provider abstractions, LLM calls, HTTP clients, pagination, or chunking.

Requirements:
- Mock ALL external services — never call real APIs or LLMs.
- Verify retry/backoff behavior with controlled mock failures.
- Verify pagination/chunking processes all items.
- Verify fallback logic when primary provider fails.
- Include dependency interfaces and mock at the import boundary used by production code.
${ctx.similarTestExamples ? `\nSimilar repository tests (follow these patterns):\n${ctx.similarTestExamples}` : ''}

`;
}

function formatPreviousGeneratedSection(ctx: TestGenerationContext): string {
  if (!ctx.previousGeneratedTests?.trim()) return '';
  return `Previous Generated Tests (do NOT duplicate):
${ctx.previousGeneratedTests}

`;
}

function formatCoverageReportSection(ctx: TestGenerationContext): string {
  if (!ctx.coverageReport?.trim()) return '';
  return `Coverage Report (this file):
${ctx.coverageReport}

`;
}

function buildPythonPrompt(ctx: TestGenerationContext, symbols: string): string {
  return `You are writing Python unit tests for ONE production file. Tests must pass on first run with no manual fixes.

## Scope
- Generate ONLY the complete test file content. No markdown, no explanations, no extra files unless required for imports to work.
${formatTestOutputMode(ctx)}
- Test the file: ${ctx.file}

${formatFullSourceHeader(ctx)}${formatComplexServiceSection(ctx)}## Context

Repository Language: ${ctx.language}
Testing Framework: ${ctx.framework}

Repository Packages (use these imports/APIs first — do not substitute alternatives):
${formatRepoPackages(ctx.repoPackages)}

Diff:
${ctx.diff}

Full Source Code (PR branch):
${ctx.source}

Existing Tests:
${ctx.existingTests || '(none found)'}

${formatPreviousGeneratedSection(ctx)}${formatCoverageReportSection(ctx)}Uncovered Changed Lines:
${ctx.uncoveredLines}

All Symbols in File:
${symbols || '(none detected)'}

## Before writing tests (do this silently)
1. Read the target file and every module it imports from the same package.
2. Read model/schema definitions: field types, defaults, validators, enums, error messages.
3. Read HTTP routes if testing FastAPI: status codes, response shapes, HTTPException detail strings.
4. Check how the repo runs tests: pytest.ini / pyproject.toml [tool.pytest.ini_options] / conftest.py / existing tests/.
5. Match existing test layout (e.g. tests/test_foo.py) and import style.

## Imports
- Import from the same modules as production code (e.g. from app.models import ConnectionRequest).
- Never import private symbols unless there is no public API to test the behavior.
- Classes named Test* in app code are models, not pytest classes — do not collect them as tests.

## What to test (priority order)
1. Pure logic: validators, branching, error cases, defaults, serialization.
2. Public functions/methods with mocked I/O.
3. FastAPI routes via TestClient with patched dependencies.
4. Avoid full integration flows unless the file is only glue.

## Mocking (mandatory for I/O)
- Never call real network, filesystem, databases, or external services.
- Never use real URLs in code paths that execute — mock clients/sessions/transports.
- Use unittest.mock: patch, MagicMock, AsyncMock.

Patterns:
  @patch("package.module.external_client")
  def test_x(mock_client):
      mock_client.return_value = MagicMock()

  @pytest.mark.asyncio
  async def test_y():
      with patch("package.module.connect", new_callable=AsyncMock) as mock_connect:
          mock_connect.return_value = MagicMock()
          result = await fn()
          assert result is not None

- Patch where the symbol is USED (e.g. patch("app.connections.Client"), not where it is defined).
- Mock async context managers: set __aenter__ / __aexit__ on MagicMock with AsyncMock.
- Never repeat a keyword in Mock() — set attributes after creation.

## Pydantic / types
- Pass valid field types only.
- Optional dict/list fields: use {} or [] per model defaults, not None unless the model allows None.
- HttpUrl fields: compare with str(model.url) or assert model.url is not None — never compare HttpUrl to a plain string.

## Async
- async tests: async def test_... with @pytest.mark.asyncio (or repo's asyncio_mode).
- Never use await outside async def.

## FastAPI
- Use fastapi.testclient.TestClient.
- Patch service/dependency functions — handlers must not reach real backends.
- Assert status codes and JSON using exact values from source (detail strings, field names).

## Assertions
- Use exact error messages from production code (ValueError, KeyError, HTTPException detail).
- Assert defaults from source (e.g. env={}, args=[], verify_ssl=True).
- One clear assertion focus per test; a few related asserts are fine.

## Test file header (only if needed)
If the repo lacks pytest/pytest-asyncio and tests need them, first line:
  # test-deps: pytest, pytest-asyncio
Only add packages NOT already in Repository Packages. Omit when repo already has them.

## Self-check before returning
- [ ] 2–4 tests, one behavior each
- [ ] All I/O mocked
- [ ] Patch targets are import paths used by the module under test
- [ ] Async tests marked correctly
- [ ] Error message strings match source exactly
- [ ] Would pass: pytest tests/test_<module>.py from repo root

Return only the complete test file.`;
}

function buildJestFrameworkSection(ctx: TestGenerationContext): string {
  const hasTestingLibrary = (ctx.repoPackages ?? []).some((p) =>
    p.includes('@testing-library/react'),
  );
  const lines = [
    'Use Jest as configured in this repository:',
    '- Use describe, it/test, and expect (jest globals are available — match Existing Tests import style).',
    '- Use jest.fn(), jest.mock(), and jest.spyOn() for mocks — follow patterns from Existing Tests.',
    '- Validation command is: npx jest <testFile>',
  ];
  if (hasTestingLibrary) {
    lines.push(
      '- @testing-library/react is available — render components to cover UI behavior and user interactions on uncovered lines.',
    );
  }
  lines.push(
    '- Match @/ path aliases and module mocks from Existing Tests.',
    '- Do NOT use node:test or node:assert.',
  );
  return lines.join('\n');
}

function buildJestReactSection(ctx: TestGenerationContext): string {
  const hasTestingLibrary = (ctx.repoPackages ?? []).some((p) =>
    p.includes('@testing-library/react'),
  );
  if (!/\.(jsx|tsx)$/i.test(ctx.file)) return '';

  return `## React / JSX (mandatory for ${ctx.file})
- Cover uncovered changed lines with behavior-focused tests, not import-only smoke tests.
${hasTestingLibrary ? '- Use @testing-library/react (render, screen, fireEvent/userEvent) inside Jest — jsdom is provided by the repo Jest config.' : '- Mock DOM APIs or test pure helpers when @testing-library/react is unavailable.'}
- Reuse mock patterns from Existing Tests (jest.mock for routers, services, stores, sockets).
- Mock fetch, API services, and socket clients — never call real backends.
- For rendered text, use flexible matchers (getByText(/pattern/) or regex) — JSX whitespace varies.
- Wrap state updates in act() from 'react' when needed.
- Import the component under test using the same path style as Existing Tests (@/ aliases when used there).

`;
}

function buildJestJavaScriptPrompt(ctx: TestGenerationContext, symbols: string): string {
  const testFile = outputTestPath(ctx);
  const frameworkSection = buildJestFrameworkSection(ctx);
  const reactSection = buildJestReactSection(ctx);
  const hasExports = (ctx.exportedSymbols?.length ?? 0) > 0;

  return `You are writing Jest unit tests for ONE production file. Tests must pass on first run with no manual fixes.

## Scope
- Generate ONLY the complete test file content. No markdown, no explanations.
${formatTestOutputMode(ctx)}
- Production file: ${ctx.file}
- Write the test file at exactly \`${testFile}\` — Jest only discovers tests under \`src/**/__tests__/**\` or colocated \`*.test.*\` paths. Never use a top-level \`tests/\` mirror unless Existing Tests already use that layout for this file.
- Do NOT import or set up jsdom — this repo uses jest-environment-jsdom.

${formatFullSourceHeader(ctx)}${formatComplexServiceSection(ctx)}## Context

Repository Language: ${ctx.language}
Testing Framework: ${ctx.framework}

Repository Packages (use these imports/APIs first — do not substitute alternatives):
${formatRepoPackages(ctx.repoPackages)}

Diff:
${ctx.diff}

Full Source Code (PR branch):
${ctx.source}

Exported Symbols (ONLY these may be imported):
${formatExportedSymbols(ctx)}

Existing Tests:
${ctx.existingTests || '(none found)'}

${formatPreviousGeneratedSection(ctx)}${formatCoverageReportSection(ctx)}Uncovered Changed Lines:
${ctx.uncoveredLines}

All Symbols in File:
${symbols || '(none detected)'}

## Test runner
${frameworkSection}

${reactSection}## Imports (critical)
${hasExports
    ? `- Import production symbols using the same style as Existing Tests (@/ alias or relative paths).
- Never import private/unexported functions.`
    : `- This file has NO exports. Test via rendering the default export/component or mocking dependencies as Existing Tests do.`}

## What to test (priority)
1. Every uncovered changed line listed above — write tests that execute those code paths.
2. Error branches, callbacks, and conditional UI states introduced in the diff.
3. Service/API calls: mock at the module boundary with jest.mock.

## Mocking (mandatory for I/O)
- Never call real network, filesystem, databases, or external services.
- Use jest.mock() for modules the production file imports; hoist mocks before imports when needed.
- Reuse fixtures and mock factories from Existing Tests when available.

## Test deps header (only if needed)
If tests need npm packages NOT in Repository Packages, first line:
  // test-deps: package-name
Do NOT list jest, @testing-library/react, @testing-library/jest-dom, or jsdom — they are already in the repo.

## Self-check before returning
- [ ] 2–4 tests exercising uncovered changed lines
- [ ] jest.mock / jest.fn used for external I/O
- [ ] Matches Existing Tests import and mock conventions
- [ ] Would pass: npx jest ${testFile} from repo root

Return only the complete test file.`;
}

function buildJavaScriptPrompt(ctx: TestGenerationContext, symbols: string): string {
  if (ctx.framework === 'jest') {
    return buildJestJavaScriptPrompt(ctx, symbols);
  }

  const testFile = outputTestPath(ctx);
  const importPath = inferSourceImportPath(testFile, ctx.file);
  const importExt = sourceFileExtension(ctx.file);
  const frameworkSection = `Use Node.js built-in test runner ONLY:
  import test from 'node:test';
  import assert from 'node:assert/strict';
Do NOT use @jest/globals, jest, vitest, mocha, describe, it, expect, or jest.fn. The validation command is node --test.`;

  const hasExports = (ctx.exportedSymbols?.length ?? 0) > 0;
  const isReactSource = /\.(jsx|tsx)$/i.test(ctx.file);
  const reactSection =
    isReactSource
      ? `## React / JSX (mandatory for ${ctx.file})
- Prefer simple tests that do NOT render the component. First test exported helpers, constants, style objects, prop-building functions, module exports, or callback behavior that can be called directly.
- For complex Next/MUI/browser components, a smoke test that imports the module and asserts exported symbols are functions/objects is better than a brittle render test.
- Avoid @testing-library/react and jsdom unless the target behavior cannot be tested through pure/static exports.
- If you truly must render, node:test has no JSDOM — set up jsdom before any import that uses the DOM:
    import { JSDOM } from 'jsdom';
    const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
    globalThis.window = window;
    globalThis.document = window.document;
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
- Place jsdom setup immediately after the test-deps line and before all other imports.
- Use @testing-library/react only if it appears in Repository Packages and the component has simple dependencies; otherwise use pure/static assertions.
- Mock firebase, routers, fetch, and service modules — never call real backends.
- Avoid module mocking when possible. Do not import modules that require Next runtime, auth providers, real stores, CSS-heavy widgets, or localStorage unless the test sets up those globals.
- For rendered text, use flexible matchers (getByText(/Team:\\s*-/) or regex) — JSX whitespace varies; never assert exact strings with ambiguous spacing.
- Wrap state updates in act() from 'react' when needed.

`
      : '';

  return `You are writing JavaScript unit tests for ONE production file. Tests must pass on first run with no manual fixes.

## Scope
- Generate ONLY the complete test file content. No markdown, no explanations.
${formatTestOutputMode(ctx)}
- Production file: ${ctx.file}

${formatFullSourceHeader(ctx)}${formatComplexServiceSection(ctx)}## Context

Repository Language: ${ctx.language}
Testing Framework: ${ctx.framework}

Repository Packages (use these imports/APIs first — do not substitute alternatives):
${formatRepoPackages(ctx.repoPackages)}

Diff:
${ctx.diff}

Full Source Code (PR branch):
${ctx.source}

Exported Symbols (ONLY these may be imported):
${formatExportedSymbols(ctx)}

Existing Tests:
${ctx.existingTests || '(none found)'}

${formatPreviousGeneratedSection(ctx)}${formatCoverageReportSection(ctx)}Uncovered Changed Lines:
${ctx.uncoveredLines}

All Symbols in File:
${symbols || '(none detected)'}

## Test runner
${frameworkSection}

${reactSection}## Imports (critical)
${hasExports
    ? `- Import ONLY from exported symbols listed above via: '${importPath}'
- Always include the ${importExt} extension in relative ESM imports.
- Never import private/unexported functions — importing them causes SyntaxError.`
    : `- This file has NO exports. Do NOT import functions from it.
- Test via child_process: spawn node with the script path and CLI args.
- Example:
    import { spawnSync } from 'node:child_process';
    import { fileURLToPath } from 'node:url';
    import { dirname, join } from 'node:path';
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const result = spawnSync('node', [join(repoRoot, '${ctx.file}'), '--help'], { encoding: 'utf-8', cwd: repoRoot });
    assert.strictEqual(result.status, 0);
- Mock external I/O at the process boundary; never import the CLI module directly.`}
- Never use paths like '../src/...' from a test inside src/ — tests live under tests/, not beside source files.

Example layout (exported module):
  // tests/config/loadConfig.test.js
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { loadConfig } from '../../src/config/loadConfig.js';

## What to test
1. Pure/static logic first: validators, formatters, constants, style object keys/values, enum/type runtime exports, barrel re-exports.
2. Exported classes/methods with plain object fakes.
3. React/Next files: prefer import/export smoke tests and direct helper tests over rendering.
4. CLI/entry-point files (no exports): subprocess tests with mocked env and stubbed child processes.

## Mocking (mandatory for I/O)
- Never call real network, filesystem, databases, or external services.
- Stub fetch, fs, and SDK clients with plain objects or node:test mock.method when available.
- Do NOT use mock.module or test.mock.module; this Node runtime does not support it. Prefer testing exported pure helpers, passing props/callback fakes, or mocking globals like fetch/localStorage directly.
- For MCP/HTTP clients, mock at the boundary the production code uses.

## ESM
- Assume "type": "module" unless existing tests show otherwise.
- Use import/export syntax, not require().

## Test deps header (only if needed)
If tests need npm packages NOT in Repository Packages, first line:
  // test-deps: package-name
Examples: sinon, nock. Avoid new packages. Do NOT list jest, vitest, @testing-library/react, or jsdom unless absolutely required and absent from Repository Packages.
Never list Node built-ins (node:test, node:assert, node:fs, fs, path, etc.) — they are not npm packages.

## Self-check before returning
- [ ] 2–4 tests using node:test + node:assert
- [ ] Import path is '${importPath}' (or equivalent correct relative path)
- [ ] Every imported symbol exists in source exports
- [ ] All external I/O mocked
- [ ] Would pass: node --test ${testFile} from repo root

Return only the complete test file.`;
}

function buildRepairSection(ctx: TestGenerationContext): string {
  if (!ctx.failureLogs) return '';

  return `

## Repair (attempt ${ctx.attemptNumber ?? 2})
The generated test failed when executed. Modify ONLY the failing test — do not rewrite unrelated tests.

Failure output:
${ctx.failureLogs}

Previous test file:
${ctx.previousTestContent ?? '(unavailable)'}

Requirements:
- Fix syntax, import paths, mocks, and assertions only — do not change production code.
- Reuse existing fixtures/mocks from Existing Tests when possible.
- Do not add new npm/pip dependencies unless declared via test-deps header.
- Prefer simplifying the test over adding mocks: replace brittle render tests with pure/static assertions, exported helper tests, or import/export smoke tests.
- If failure is "document is not defined", add jsdom setup before all other imports (see React / JSX section).
- If failure mentions localStorage or "opaque origins", create JSDOM with { url: 'http://localhost' } and stub globalThis.localStorage, or avoid rendering/importing the browser-dependent path.
- If failure mentions ".css" unknown extension, avoid importing the CSS-heavy component path unless necessary; prefer testing a pure export or style/helper module.
- If failure says "mock.module is not a function" or "test.mock.module is not a function", remove module mocking and test via exported helpers, props, callback fakes, or globals instead.
- If TestingLibraryElementError mentions whitespace/normalization, use regex matchers (e.g. getByText(/Team:\\s*-/)) instead of exact strings.
- Return the complete corrected test file only.`;
}

export function buildTestGenerationPrompt(ctx: TestGenerationContext): string {
  const symbols = ctx.symbols
    .map((s) => `- ${s.kind} ${s.name}${s.signature ? `: ${s.signature}` : ''}`)
    .join('\n');

  const repair = buildRepairSection(ctx);

  if (ctx.language === 'python') {
    return buildPythonPrompt(ctx, symbols) + repair;
  }

  if (ctx.language === 'javascript' || ctx.language === 'typescript') {
    return buildJavaScriptPrompt(ctx, symbols) + repair;
  }

  return buildPythonPrompt(ctx, symbols) + repair;
}

export function buildTestGenerationSystemPrompt(language: string, framework?: string): string {
  if (language === 'javascript' || language === 'typescript') {
    if (framework === 'jest') {
      return (
        'You write Jest unit tests that pass on first run and cover uncovered changed lines. ' +
        'Use describe/it/expect and jest.mock/jest.fn following Existing Tests in the repo. ' +
        'When updating an existing test file, preserve working tests and append new cases for uncovered lines. ' +
        'For React/Next files, use @testing-library/react when available to exercise UI behavior. ' +
        'Mock all external I/O. Return only runnable test file code. ' +
        'Declare extra npm packages on the first line as // test-deps: pkg1, pkg2'
      );
    }
    return (
      'You write simple, correct JavaScript unit tests that pass on first run. ' +
      'Prefer node:test and node:assert unless the repo already uses Jest/Vitest. ' +
      'When updating an existing test file, preserve working tests and append new cases for uncovered lines. ' +
      'Use correct relative ESM import paths with the source file extension (.js, .jsx, .ts, .tsx). ' +
      'Only import symbols listed as exported; never import private functions. ' +
      'For CLI files with no exports, test via child_process.spawnSync instead of importing. ' +
      'Mock all external I/O. Prefer pure/static assertions and import/export smoke tests over rendering React components. Return only runnable test file code. ' +
      'For React/JSX files with node:test, avoid jsdom/rendering unless needed; if rendering, set up jsdom before DOM imports and use flexible text matchers. ' +
      'Declare extra npm packages on the first line as // test-deps: pkg1, pkg2'
    );
  }

  return (
    'You write simple, correct unit tests that pass on first run. Mock all external I/O. ' +
    'When updating an existing test file, preserve working tests and append new cases for uncovered lines. ' +
    'Use exact types and defaults from source models. Return only runnable test file code. ' +
    'Declare minimal extra test-only packages on the first line as # test-deps: pkg1, pkg2'
  );
}
