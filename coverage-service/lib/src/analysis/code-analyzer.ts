import type { ImpactedSymbol } from '../types';

export interface CodeAnalyzer {
  extractSymbols(
    source: string,
    filePath: string,
    changedLines: number[],
  ): Promise<ImpactedSymbol[]>;
}

export class TypeScriptAnalyzer implements CodeAnalyzer {
  async extractSymbols(
    source: string,
    filePath: string,
    changedLines: number[],
  ): Promise<ImpactedSymbol[]> {
    const symbols: ImpactedSymbol[] = [];
    const lines = source.split('\n');

    const patterns: { kind: ImpactedSymbol['kind']; regex: RegExp }[] = [
      { kind: 'class', regex: /^(?:export\s+)?class\s+(\w+)/ },
      { kind: 'function', regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/ },
      {
        kind: 'function',
        regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
      },
      { kind: 'method', regex: /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\S+)?\s*\{/ },
    ];

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      if (changedLines.length && !changedLines.includes(lineNum)) continue;

      for (const { kind, regex } of patterns) {
        const match = lines[i].match(regex);
        if (match) {
          symbols.push({
            name: match[1],
            kind,
            file: filePath,
            startLine: lineNum,
            endLine: lineNum,
            signature: lines[i].trim(),
          });
        }
      }
    }

    return symbols;
  }
}

export class PythonAnalyzer implements CodeAnalyzer {
  async extractSymbols(
    source: string,
    filePath: string,
    changedLines: number[],
  ): Promise<ImpactedSymbol[]> {
    const symbols: ImpactedSymbol[] = [];
    const lines = source.split('\n');

    const patterns: { kind: ImpactedSymbol['kind']; regex: RegExp }[] = [
      { kind: 'class', regex: /^class\s+(\w+)/ },
      { kind: 'function', regex: /^def\s+(\w+)\s*\(/ },
      { kind: 'function', regex: /^\s+def\s+(\w+)\s*\(/ },
    ];

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      if (changedLines.length && !changedLines.includes(lineNum)) continue;

      for (const { kind, regex } of patterns) {
        const match = lines[i].match(regex);
        if (match) {
          symbols.push({
            name: match[1],
            kind: kind === 'function' && lines[i].startsWith(' ') ? 'method' : kind,
            file: filePath,
            startLine: lineNum,
            endLine: lineNum,
            signature: lines[i].trim(),
          });
        }
      }
    }

    return symbols;
  }
}

/** Top-level names exported from a JS/TS module (empty when none). */
export function extractExportedSymbols(
  source: string,
  filePath: string,
): string[] {
  if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(filePath)) return [];

  const exports: string[] = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();

    const blockMatch = trimmed.match(/^export\s*\{([^}]+)\}/);
    if (blockMatch) {
      for (const part of blockMatch[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) exports.push(name);
      }
      continue;
    }

    const declMatch = trimmed.match(
      /^export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+(\w+)/,
    );
    if (declMatch) {
      exports.push(declMatch[1]);
      continue;
    }

    if (/^export\s+default\b/.test(trimmed)) {
      exports.push('default');
    }
  }

  return [...new Set(exports)];
}

export function getAnalyzerForFile(filePath: string): CodeAnalyzer {
  if (filePath.endsWith('.py')) return new PythonAnalyzer();
  return new TypeScriptAnalyzer();
}

export function detectLanguage(filePath: string): string {
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
  return 'unknown';
}

export function detectFramework(
  repoDir: string,
  language: string,
  testCommand: string,
): string {
  if (testCommand.includes('pytest') || language === 'python') return 'pytest';
  if (testCommand.includes('jest')) return 'jest';
  if (testCommand.includes('vitest')) return 'vitest';
  if (testCommand.includes('mocha')) return 'mocha';
  if (testCommand.includes('node --test') || testCommand.includes('--test'))
    return 'node:test';
  return language === 'typescript' || language === 'javascript' ? 'node:test' : 'unknown';
}
