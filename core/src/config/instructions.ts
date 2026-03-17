import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { glob } from 'tinyglobby';

const INSTRUCTION_PATTERNS = [
  '**/REVIEW.md',
  '**/AGENTS.md',
  '**/CLAUDE.md',
  '**/.cursorrules',
  '**/.windsurfrules',
];

/** Priority order — lower index = higher priority */
const PRIORITY: Record<string, number> = {
  'REVIEW.md': 0,
  'AGENTS.md': 1,
  'CLAUDE.md': 2,
  '.cursorrules': 3,
  '.windsurfrules': 4,
};

/**
 * Approximate token count using character-based heuristic.
 * ~4 characters per token for English text is a common approximation.
 */
const CHARS_PER_TOKEN = 4;
const MAX_TOKENS = 10_000;
const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;

export interface InstructionFile {
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to the repo root */
  relativePath: string;
  /** File name (e.g. REVIEW.md) */
  fileName: string;
  /** Directory depth from repo root (0 = root) */
  depth: number;
  /** File content */
  content: string;
}

export interface InstructionResult {
  /** Instructions from files at the repo root (depth 0) */
  globalInstructions: string;
  /** Instructions scoped to subdirectories — key is the relative dir path */
  scopedInstructions: Map<string, string>;
}

function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1];
}

function getDepth(relativePath: string): number {
  if (relativePath === '' || !relativePath.includes('/')) return 0;
  return relativePath.split('/').length - 1;
}

function getPriority(fileName: string): number {
  return PRIORITY[fileName] ?? 999;
}

export async function findInstructionFiles(repoPath: string): Promise<InstructionFile[]> {
  const absRoot = resolve(repoPath);

  const matchedPaths = await glob(INSTRUCTION_PATTERNS, {
    cwd: absRoot,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    dot: true,
  });

  const files: InstructionFile[] = [];

  for (const relPath of matchedPaths) {
    const absolutePath = resolve(absRoot, relPath);
    const fileName = getFileName(relPath);
    const depth = getDepth(relPath);

    let content: string;
    try {
      content = await readFile(absolutePath, 'utf-8');
    } catch {
      continue;
    }

    files.push({
      absolutePath,
      relativePath: relPath,
      fileName,
      depth,
      content,
    });
  }

  // Sort: root files first (by depth), then by priority within same depth
  files.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return getPriority(a.fileName) - getPriority(b.fileName);
  });

  return files;
}

export async function loadInstructions(repoPath: string): Promise<InstructionResult> {
  const files = await findInstructionFiles(repoPath);

  const globalParts: string[] = [];
  const scopedMap = new Map<string, string[]>();

  let totalChars = 0;

  for (const file of files) {
    if (totalChars >= MAX_CHARS) break;

    const remaining = MAX_CHARS - totalChars;
    const content = file.content.length > remaining ? file.content.slice(0, remaining) : file.content;

    if (file.depth === 0) {
      globalParts.push(content);
    } else {
      const dir = dirname(file.relativePath);
      const existing = scopedMap.get(dir) ?? [];
      existing.push(content);
      scopedMap.set(dir, existing);
    }

    totalChars += content.length;
  }

  const scopedInstructions = new Map<string, string>();
  for (const [dir, parts] of scopedMap) {
    scopedInstructions.set(dir, parts.join('\n\n'));
  }

  return {
    globalInstructions: globalParts.join('\n\n'),
    scopedInstructions,
  };
}
