import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';

const PYTHON_STDLIB = new Set([
  'abc',
  'argparse',
  'ast',
  'asyncio',
  'collections',
  'contextlib',
  'copy',
  'dataclasses',
  'datetime',
  'enum',
  'functools',
  'importlib',
  'inspect',
  'io',
  'itertools',
  'json',
  'logging',
  'os',
  'pathlib',
  're',
  'sys',
  'tempfile',
  'textwrap',
  'threading',
  'time',
  'types',
  'typing',
  'unittest',
  'uuid',
  'warnings',
]);

/** Normalize a package name for duplicate detection. */
export function normalizePackageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\[.*\]/, '')
    .split(/[<>=!;]/)[0]
    .trim();
}

function parseRequirementsLine(line: string): string | null {
  const trimmed = line.split('#')[0]?.trim();
  if (!trimmed || trimmed.startsWith('-')) return null;
  const name = trimmed.split(/[<>=!;\s]/)[0]?.trim();
  return name || null;
}

async function collectFromRequirements(repoDir: string): Promise<string[]> {
  const path = join(repoDir, 'requirements.txt');
  if (!existsSync(path)) return [];

  const content = await readFile(path, 'utf-8');
  return content
    .split('\n')
    .map(parseRequirementsLine)
    .filter((name): name is string => Boolean(name));
}

async function collectFromPyproject(repoDir: string): Promise<string[]> {
  const path = join(repoDir, 'pyproject.toml');
  if (!existsSync(path)) return [];

  const content = await readFile(path, 'utf-8');
  const packages: string[] = [];
  const depBlock =
    /(?:^|\n)\s*dependencies\s*=\s*\[([\s\S]*?)\]/g;
  const optionalBlock =
    /(?:^|\n)\s*\[project\.optional-dependencies\][\s\S]*?(?=\n\[|$)/g;

  for (const match of content.matchAll(depBlock)) {
    for (const quoted of match[1].matchAll(/"([^"]+)"/g)) {
      const name = parseRequirementsLine(quoted[1]);
      if (name) packages.push(name);
    }
  }

  for (const section of content.matchAll(optionalBlock)) {
    for (const quoted of section[0].matchAll(/"([^"]+)"/g)) {
      const name = parseRequirementsLine(quoted[1]);
      if (name) packages.push(name);
    }
  }

  return packages;
}

async function collectFromPackageJson(repoDir: string): Promise<string[]> {
  const path = join(repoDir, 'package.json');
  if (!existsSync(path)) return [];

  const pkg = JSON.parse(await readFile(path, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];
}

export async function collectRepoPackages(repoDir: string): Promise<string[]> {
  const seen = new Set<string>();
  const packages: string[] = [];

  const add = (name: string) => {
    const normalized = normalizePackageName(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    packages.push(name.trim());
  };

  for (const source of [
    await collectFromRequirements(repoDir),
    await collectFromPyproject(repoDir),
    await collectFromPackageJson(repoDir),
  ]) {
    for (const pkg of source) add(pkg);
  }

  return packages;
}

const IMPORT_TO_PACKAGE: Record<string, string> = {
  pytest_asyncio: 'pytest-asyncio',
  fastapi: 'fastapi',
  httpx: 'httpx',
  pydantic: 'pydantic',
  starlette: 'starlette',
  fastmcp: 'fastmcp',
};

const NODE_CORE_MODULES = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'readline',
  'stream',
  'string_decoder',
  'test',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

function isNonNpmPackage(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return true;
  if (trimmed.startsWith('node:')) return true;
  const base = trimmed.replace(/^node:/, '').split('/')[0];
  return NODE_CORE_MODULES.has(base);
}

const JS_IMPORT_TO_PACKAGE: Record<string, string> = {
  '@jest/globals': 'jest',
  '@jest/types': 'jest',
  '@testing-library/react': '@testing-library/react',
  '@testing-library/dom': '@testing-library/dom',
  '@testing-library/jest-dom': '@testing-library/jest-dom',
  sinon: 'sinon',
  nock: 'nock',
  chai: 'chai',
  supertest: 'supertest',
  vitest: 'vitest',
  jest: 'jest',
};

export interface ParsedGeneratedTest {
  content: string;
  declaredDeps: string[];
}

/** Strip optional LLM-declared test deps and return cleaned test content. */
export function parseGeneratedTestContent(content: string): ParsedGeneratedTest {
  const match = content.match(/^\s*(?:\/\/|#)\s*test-deps:\s*(.+)\s*$/m);
  if (!match) {
    return { content: content.trim(), declaredDeps: [] };
  }

  const declaredDeps = match[1]
    .split(',')
    .map((dep) => dep.trim())
    .filter(Boolean);

  const cleaned = content
    .replace(/^\s*(?:\/\/|#)\s*test-deps:\s*.+\s*\n?/m, '')
    .trim();
  return { content: cleaned, declaredDeps };
}

function extractPythonImports(content: string): string[] {
  const imports: string[] = [];
  for (const match of content.matchAll(/^\s*(?:from|import)\s+([a-zA-Z0-9_.]+)/gm)) {
    imports.push(match[1].split('.')[0]);
  }
  return imports;
}

function extractJsImportSpecs(content: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      specs.push(match[1]);
    }
  }
  return specs;
}

function importSpecToNpmPackage(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/')) return null;
  if (isNonNpmPackage(spec)) return null;

  const mapped = JS_IMPORT_TO_PACKAGE[spec];
  if (mapped) return mapped;

  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }

  const base = spec.split('/')[0];
  if (isNonNpmPackage(base)) return null;

  return base || null;
}

function inferPythonTestPackages(testContents: string[]): string[] {
  const packages = new Set<string>();
  const combined = testContents.join('\n');

  if (
    /\basync\s+def\s+test_/m.test(combined) ||
    /@pytest\.mark\.asyncio\b/.test(combined)
  ) {
    packages.add('pytest-asyncio');
  }

  if (/\bmocker\b/.test(combined) || /\bdef test_\w+\(mocker\)/.test(combined)) {
    packages.add('pytest-mock');
  }

  for (const content of testContents) {
    for (const imp of extractPythonImports(content)) {
      if (PYTHON_STDLIB.has(imp) || imp === 'pytest') continue;
      const mapped = IMPORT_TO_PACKAGE[imp];
      if (mapped) packages.add(mapped);
    }
  }

  return [...packages];
}

function inferJsTestPackages(testContents: string[]): string[] {
  const packages = new Set<string>();
  const combined = testContents.join('\n');

  if (/\bjest\.(fn|mock|spyOn)\b/.test(combined) || /@jest\/globals/.test(combined)) {
    packages.add('jest');
  }

  if (/\bvi\.(fn|mock|spyOn)\b/.test(combined) || /\bfrom\s+['"]vitest['"]/.test(combined)) {
    packages.add('vitest');
  }

  if (/\bsinon\b/.test(combined)) {
    packages.add('sinon');
  }

  for (const content of testContents) {
    for (const spec of extractJsImportSpecs(content)) {
      const pkg = importSpecToNpmPackage(spec);
      if (pkg) packages.add(pkg);
    }
  }

  return [...packages];
}

function inferAutoTestPackages(testContents: string[], ecosystem: 'python' | 'javascript'): string[] {
  return ecosystem === 'javascript'
    ? inferJsTestPackages(testContents)
    : inferPythonTestPackages(testContents);
}

export function collectTestRunDependencies(
  testContents: string[],
  declaredDeps: string[],
  repoPackages: string[],
  ecosystem: 'python' | 'javascript' = 'python',
): string[] {
  const repoNormalized = new Set(
    repoPackages.map((pkg) => normalizePackageName(pkg)),
  );
  const deps = new Set<string>();

  for (const dep of [...declaredDeps, ...inferAutoTestPackages(testContents, ecosystem)]) {
    if (isNonNpmPackage(dep)) continue;
    const normalized = normalizePackageName(dep);
    if (!normalized || repoNormalized.has(normalized)) continue;
    deps.add(dep.trim());
  }

  return [...deps];
}

export function buildPipInstallCommand(packages: string[]): string | null {
  if (packages.length === 0) return null;
  const quoted = packages.map((pkg) => `'${pkg.replace(/'/g, `'"'"'`)}'`);
  return `pip install ${quoted.join(' ')}`;
}

export function buildNpmInstallCommand(packages: string[]): string | null {
  if (packages.length === 0) return null;
  const quoted = packages.map((pkg) => `'${pkg.replace(/'/g, `'"'"'`)}'`);
  return `npm install -D ${quoted.join(' ')}`;
}
