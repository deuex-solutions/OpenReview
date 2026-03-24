# Impact Analysis — Standalone Product Specification

> Extracted from OpenReview project documentation on 2026-03-24
> Purpose: Separate product packaging for PM review
> Sources: PRD v1.1, Feature Spec, Milestones, TodoList

---

## 1. Product Overview

**Impact Analysis** identifies the full blast radius of code changes — every file and UI component affected by a PR — so developers and testers know exactly what to verify before a review is complete.

Originally designed as a feature within OpenReview (sections 4.12 PRD, section 17 Feature Spec, Weeks 5–6 Milestones, TodoList items Phase 1 §16 and Phase 2 §11), this document extracts all Impact Analysis specifications for evaluation as a standalone product.

---

## 2. Problem Statement

When a developer changes a file, the effects ripple through the codebase via imports, dependencies, and data flow. Without automated blast-radius detection:

- Testers don't know which UI pages/routes to re-verify
- Reviewers miss cascading breakage in transitive dependents
- CI pipelines can't prioritize tests for high-impact changes
- PMs and tech leads lack visibility into change scope for risk assessment

---

## 3. Target Users

- Developers reviewing PRs who want to understand change scope
- QA/Testers who need to know which pages and components to test
- PMs and Tech Leads assessing risk and blast radius of changes
- CI/CD pipelines that need machine-readable impact data for test prioritization

---

## 4. Phase 1 — Static Analysis (Tree-sitter)

### 4.1 Analysis Engine

- **Tree-sitter based** import/dependency graph builder (language-agnostic)
- Supported languages: JS/TS, Python, Go, Java, Ruby, Rust, and 100+ languages via Tree-sitter grammars
- Parses changed files to extract exports, imports, and symbol references
- Builds full dependency graph: maps every file to its direct and transitive dependents

### 4.2 Dependency Tracing

- Full transitive graph traversal from changed files to leaf nodes (pages/entry points)
- Smart relevance scoring:
  - Direct dependents: score 1.0
  - 2nd degree: 0.7
  - 3rd degree: 0.5
  - Deeper: diminishing
- Configurable depth threshold to filter noise on large codebases
- Deduplication: if a file is reachable via multiple paths, keep highest relevance score

### 4.3 Component-to-Page Mapping

- Textual mapping of changed files to the UI components/pages they affect
- Detects page/route files by convention: `pages/`, `routes/`, `views/`, `screens/` directories
- Detects route definitions: React Router, Next.js pages/app dir, Vue Router, Angular routing modules
- Example output: "Button change impacts: Login Page, Settings Page, Checkout Form"

### 4.4 Input Sources

- **Default:** git diff + staged changes
- **Override:** `--files <paths>` flag for manual file targeting (ad-hoc exploration, comma-separated)

### 4.5 CLI Integration

- Interactive prompt during review: "Would you like to include impact analysis? (y/n)"
- `--impact` flag: include impact analysis without prompt
- `--no-impact` flag: skip impact analysis without prompt
- Flags designed for CI/automation use; interactive prompt for developer workflow

### 4.6 Output — Terminal

- Structured tree of impacted files with proximity scores and import chain paths
- Grouped by proximity level: Direct Dependents → 2nd Degree → 3rd Degree → Deeper
- Component-to-page mapping section (which UI pages/routes are affected)

### 4.7 Output — JSON Report

- Machine-readable `impact-report.json` for CI/CD integration
- Includes: changed files, impacted files with scores, affected pages, summary stats

### 4.8 Review Integration (when embedded in OpenReview)

- Standalone "Impact Analysis" summary section in review output
- Each review finding enriched with impact scope (e.g., "This bug in `Button.tsx` affects 12 files across 3 pages")
- Impact-based prioritization: findings in high-impact files surface first

### 4.9 Configuration

| Variable | Type | Default | Description |
|---|---|---|---|
| `IMPACT_ENABLED` | boolean | `true` | Enable/disable impact analysis |
| `IMPACT_DEPTH_THRESHOLD` | number | `10` | Max traversal depth |

### 4.10 Performance Target

- Impact analysis completes in < 30 seconds for repos with ≤ 500 files

---

## 5. Phase 2 — Advanced (LLM + Visual)

### 5.1 LLM-Powered Semantic/Data-Flow Analysis

- LangGraph agent receives Tree-sitter dependency graph as initial context
- LLM reasons about data flow across boundaries: frontend → API route → backend handler → database query
- Identifies cross-layer impacts (e.g., form field rename affects API contract, backend validation, database schema)
- Returns enriched `ImpactNode[]` with `dataFlowPath` annotations

### 5.2 Screenshot Diffing

- Run target app in sandbox before/after changes
- Headless browser (Playwright) captures screenshots of affected pages
- Compute pixel-level or component-level visual diff
- Generate annotated diff images highlighting affected UI regions
- Store screenshots in trace directory per PR

### 5.3 Live Preview in Sandbox

- Spin up app in sandbox environment
- Render affected pages identified by component mapper
- Annotate impacted components with visual overlay markers (border highlighting, labels)
- Support both Docker (CI) and local dev server (CLI) environments

### 5.4 GitHub PR Comment — Impact Summary

- Collapsible table: impacted files grouped by category (direct/transitive), proximity scores, affected pages
- Replace-not-duplicate strategy via `<!-- openreview-impact -->` HTML marker
- Visual diff thumbnails (as GitHub image links) when screenshot diffing is enabled

### 5.5 Interactive HTML Report / Web Dashboard

- Visual dependency graph: nodes = files, edges = imports, colored by impact proximity
- Click-to-expand: click a node to see its import chain and affected pages
- Export as standalone HTML file for sharing

### 5.6 Docker Container Sandbox for UI Rendering

- Docker image includes: Node.js, Playwright, Chromium
- Resource limits: CPU 1.0, memory 1GB, time 120s
- Fallback to local dev server when Docker not available (CLI mode)

---

## 6. Data Model

```typescript
interface ImpactNode {
  file: string;
  importedSymbols: string[];       // what symbols are used from the changed file
  proximity: number;               // 1 = direct, 2 = 2nd degree, etc.
  relevanceScore: number;          // 0.0–1.0, higher = more affected
  importChain: string[];           // full chain: ['Button.tsx', 'LoginForm.tsx', 'LoginPage.tsx']
}

interface ImpactResult {
  changedFiles: string[];          // input: files that changed
  impactedFiles: ImpactNode[];     // output: all affected files, scored
  affectedPages: string[];         // UI pages/routes affected
  affectedComponents: string[];    // UI components affected
  summary: {
    totalImpacted: number;
    directDependents: number;
    transitiveDependents: number;
    affectedPageCount: number;
  };
}

interface ImpactGraph {
  // Internal dependency graph representation
  // Nodes: files, Edges: import relationships
}
```

---

## 7. Module Architecture

```
core/src/impact/
├── types.ts              # ImpactNode, ImpactResult, ImpactGraph, scoring constants
├── tree-sitter.ts        # Tree-sitter import/export extraction (language-agnostic)
├── graph.ts              # Dependency graph building, BFS/DFS traversal, relevance scoring
├── analyzer.ts           # Main entry point: orchestrates graph → trace → score → map → result
├── component-mapper.ts   # Component-to-page/route mapping
├── semantic-analyzer.ts  # [Phase 2] LLM data-flow reasoning via LangGraph
├── screenshot-differ.ts  # [Phase 2] Playwright screenshot capture + visual diff
└── live-preview.ts       # [Phase 2] Sandbox app rendering with component annotations
```

---

## 8. Implementation To-Do List

### Phase 1 — Static Analysis MVP

#### 8.1 Impact Types (`core/src/impact/types.ts`)
- [ ] Define `ImpactNode` interface: `file`, `importedSymbols`, `proximity`, `relevanceScore`, `importChain`
- [ ] Define `ImpactResult` interface: `changedFiles`, `impactedFiles`, `affectedPages`, `affectedComponents`, `summary`
- [ ] Define `ImpactGraph` interface for internal dependency graph representation
- [ ] Define relevance scoring constants: direct (1.0), 2nd degree (0.7), 3rd degree (0.5), deeper (diminishing)
- [ ] Export impact types from canonical types location

#### 8.2 Tree-sitter Dependency Graph Builder (`core/src/impact/tree-sitter.ts`)
- [ ] Install `tree-sitter` and language grammars (tree-sitter-typescript, tree-sitter-python, tree-sitter-javascript, etc.)
- [ ] Implement `detectLanguage(filePath: string): string` — map file extension to Tree-sitter grammar
- [ ] Implement `extractImports(filePath: string, content: string): ImportInfo[]` — parse file AST, extract import/require/use statements
- [ ] Implement `extractExports(filePath: string, content: string): ExportInfo[]` — parse file AST, extract exported symbols
- [ ] Support language-agnostic parsing: JS/TS (`import`/`require`/`export`), Python (`import`/`from`), Go (`import`), Java (`import`), Ruby (`require`/`require_relative`), Rust (`use`/`mod`)
- [ ] Handle dynamic imports and re-exports
- [ ] Guard against malformed input — validate AST nodes before accessing properties
- [ ] Unit test: import extraction per language, export extraction, dynamic imports, malformed input

#### 8.3 Dependency Graph & Traversal (`core/src/impact/graph.ts`)
- [ ] Implement `buildDependencyGraph(files: string[], repoPath: string): ImpactGraph`
- [ ] Implement `traceImpact(changedFiles: string[], graph: ImpactGraph): ImpactNode[]` — BFS/DFS transitive traversal
- [ ] Implement relevance scoring: score = f(proximity), direct = 1.0, each degree reduces
- [ ] Implement configurable depth threshold (`IMPACT_DEPTH_THRESHOLD`)
- [ ] Deduplicate: multiple paths → keep highest relevance score
- [ ] Sort results: highest relevance first
- [ ] Unit test: graph building, transitive traversal, scoring, deduplication, depth threshold

#### 8.4 Component-to-Page Mapper (`core/src/impact/component-mapper.ts`)
- [ ] Implement `mapToPages(impactedFiles: ImpactNode[], repoPath: string): PageMapping[]`
- [ ] Detect page/route files by convention: `pages/`, `routes/`, `views/`, `screens/`
- [ ] Detect route definitions: React Router, Next.js, Vue Router, Angular routing
- [ ] Trace upward from impacted file to the page/route that renders it
- [ ] Unit test: page detection, route detection, component-to-page mapping

#### 8.5 Impact Analyzer Entry Point (`core/src/impact/analyzer.ts`)
- [ ] Implement `analyzeImpact(changedFiles: string[], repoPath: string, config: ImpactConfig): Promise<ImpactResult>`
- [ ] Orchestrate: build graph → trace impact → score → map components → build result
- [ ] Accept both git diff files and manual `--files` input
- [ ] Respect config: `IMPACT_ENABLED`, `IMPACT_DEPTH_THRESHOLD`
- [ ] Performance target: < 30 seconds for repos with ≤ 500 files
- [ ] Unit test: end-to-end flow, config handling, performance

#### 8.6 CLI Integration
- [ ] Add `--impact` and `--no-impact` flags to review command
- [ ] Add interactive prompt: "Would you like to include impact analysis? (y/n)"
- [ ] Add `--files <paths>` flag for manual file targeting (comma-separated)

#### 8.7 Terminal Output
- [ ] Implement `formatImpactTree(result: ImpactResult): string` — structured tree view
- [ ] Show proximity scores, import chain paths, affected page/route annotations
- [ ] Group by proximity level
- [ ] Unit test: formatting for various scenarios

#### 8.8 JSON Report Output
- [ ] Implement `writeImpactReport(result: ImpactResult, outputPath: string): void`
- [ ] Machine-readable JSON (`impact-report.json`)
- [ ] Unit test: JSON structure, file writing

#### 8.9 Review Output Integration
- [ ] Standalone "Impact Analysis" section in review summary
- [ ] Annotate findings with impact scope (e.g., "⚡ High impact — affects 12 files across 3 pages")
- [ ] Unit test: summary format, annotation format

### Phase 2 — Advanced (LLM + Visual)

#### 8.10 LLM-Powered Semantic/Data-Flow Analysis
- [ ] Implement `core/src/impact/semantic-analyzer.ts` — LangGraph agent for data-flow reasoning
- [ ] Feed Tree-sitter graph as initial context to LLM
- [ ] Trace data flow: frontend → API → backend → database
- [ ] Identify cross-layer impacts (form field rename → API contract → backend validation → DB schema)
- [ ] Return enriched `ImpactNode[]` with `dataFlowPath` annotations
- [ ] Unit test: data-flow detection across mock multi-layer codebase

#### 8.11 Screenshot Diffing
- [ ] Implement `core/src/impact/screenshot-differ.ts`
- [ ] Run app in sandbox before/after changes
- [ ] Headless browser (Playwright) captures affected pages
- [ ] Compute pixel/component-level visual diff
- [ ] Generate annotated diff images
- [ ] Store screenshots in `~/.openreview/traces/<pr>/screenshots/`
- [ ] Unit test: capture, diff computation, annotation

#### 8.12 Live Preview in Sandbox
- [ ] Implement `core/src/impact/live-preview.ts`
- [ ] Spin up app, render affected pages, annotate impacted components with overlays
- [ ] Support Docker (CI) and local dev server (CLI)

#### 8.13 GitHub PR Comment — Impact Summary
- [ ] Extend comment posting with `postImpactComment(prNumber, impactResult)`
- [ ] Collapsible table with proximity scores and affected pages
- [ ] HTML marker for replace-not-duplicate strategy
- [ ] Visual diff thumbnails when screenshot diffing enabled

#### 8.14 Interactive HTML Report / Web Dashboard
- [ ] Visual dependency graph (React 19 + Vite 8)
- [ ] Click-to-expand node → import chain and affected pages
- [ ] Export as standalone HTML

#### 8.15 Docker Container Sandbox for UI Rendering
- [ ] Extend Docker runner for Playwright execution
- [ ] Docker image: Node.js, Playwright, Chromium
- [ ] Resource limits: CPU 1.0, memory 1GB, time 120s
- [ ] Fallback to local dev server when Docker unavailable

---

## 9. Acceptance Criteria

### Phase 1

- [ ] Tree-sitter graph built for any language with a Tree-sitter grammar
- [ ] Full transitive tracing with configurable depth threshold
- [ ] Relevance scoring ranks direct dependents above transitive ones
- [ ] Component-to-page mapping identifies affected UI routes/pages
- [ ] Interactive prompt shown during review (skippable via flags)
- [ ] Terminal output shows structured impact tree with scores
- [ ] JSON report generated alongside review output
- [ ] Each review finding enriched with impact scope annotation
- [ ] Findings in high-impact files prioritized in review output
- [ ] Impact analysis completes in < 30 seconds for repos with ≤ 500 files

### Phase 2

- [ ] LLM-powered data-flow analysis identifies cross-boundary impacts (frontend → backend → database)
- [ ] Screenshot diffing highlights visual UI changes with before/after comparison
- [ ] Live sandbox preview renders affected pages with component annotations
- [ ] GitHub PR comment includes collapsible impact summary
- [ ] Interactive HTML dashboard visualizable via web interface

---

## 10. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| AST Parsing | Tree-sitter | Language-agnostic, 100+ grammar support |
| Language Grammars | tree-sitter-typescript, tree-sitter-python, tree-sitter-javascript, etc. | Per-language parsers |
| LLM Orchestration (Phase 2) | LangGraph.js | Agentic data-flow reasoning |
| Screenshot Capture (Phase 2) | Playwright | Headless browser for before/after screenshots |
| Sandbox (Phase 1) | Deno 2.7 | Lightweight component analysis |
| Sandbox (Phase 2) | Docker | Full app rendering + headless browser |
| Visualization (Phase 2) | React 19 + Vite 8 | Interactive dependency graph dashboard |

---

## 11. Relationship to OpenReview

Impact Analysis was originally designed as a module within OpenReview (`core/src/impact/`). When packaged as a standalone product:

- **Phase 1 core** (Tree-sitter graph, traversal, scoring, component mapping) is fully independent — it only needs git diff input and file system access
- **Review integration** (finding enrichment, prioritization) is an OpenReview-specific integration layer
- **Phase 2 features** (LLM analysis, screenshots, live preview, HTML dashboard) can be offered independently or as OpenReview add-ons
- The CLI flags (`--impact`, `--no-impact`, `--files`) can be exposed via a standalone CLI command

---

_Extracted from OpenReview documentation — 2026-03-24_
