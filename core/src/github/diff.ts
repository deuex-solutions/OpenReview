import { config } from '../config/env.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Line {
  lineNumber: number;
  content: string;
}

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export interface ParsedDiff {
  file: string;
  previousFile?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  hunks: Hunk[];
  addedLines: Line[];
  deletedLines: Line[];
}

export interface MoveEvent {
  type: 'move' | 'copy';
  sourceFile: string;
  targetFile: string;
  similarity: number;
}

/* ------------------------------------------------------------------ */
/*  Diff Parser                                                        */
/* ------------------------------------------------------------------ */

const DIFF_HEADER_RE = /^diff --git a\/(.+?) b\/(.+?)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;
const NEW_FILE_RE = /^new file mode/;
const DELETED_FILE_RE = /^deleted file mode/;

export function parseDiff(rawDiff: string): ParsedDiff[] {
  const results: ParsedDiff[] = [];
  const lines = rawDiff.split('\n');

  let current: ParsedDiff | null = null;
  let currentHunk: Hunk | null = null;
  let newLineNum = 0;
  let oldLineNum = 0;

  for (const line of lines) {
    // --- New diff block ---
    const diffMatch = DIFF_HEADER_RE.exec(line);
    if (diffMatch) {
      if (current) results.push(current);
      current = {
        file: diffMatch[2],
        status: 'modified',
        hunks: [],
        addedLines: [],
        deletedLines: [],
      };
      currentHunk = null;
      continue;
    }

    if (!current) continue;

    // --- File status markers ---
    if (NEW_FILE_RE.test(line)) {
      current.status = 'added';
      continue;
    }
    if (DELETED_FILE_RE.test(line)) {
      current.status = 'deleted';
      continue;
    }

    const renameFrom = RENAME_FROM_RE.exec(line);
    if (renameFrom) {
      current.previousFile = renameFrom[1];
      current.status = 'renamed';
      continue;
    }
    const renameTo = RENAME_TO_RE.exec(line);
    if (renameTo) {
      current.file = renameTo[1];
      continue;
    }

    // --- Hunk header ---
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] ?? '1', 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] ?? '1', 10),
        lines: [],
      };
      current.hunks.push(currentHunk);
      oldLineNum = currentHunk.oldStart;
      newLineNum = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;

    // --- Diff lines ---
    if (line.startsWith('+')) {
      currentHunk.lines.push(line);
      current.addedLines.push({ lineNumber: newLineNum, content: line.slice(1) });
      newLineNum++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push(line);
      current.deletedLines.push({ lineNumber: oldLineNum, content: line.slice(1) });
      oldLineNum++;
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push(line);
      oldLineNum++;
      newLineNum++;
    }
    // skip "\ No newline at end of file" and other metadata
  }

  if (current) results.push(current);
  return results;
}

/* ------------------------------------------------------------------ */
/*  Move / Copy Detection                                              */
/* ------------------------------------------------------------------ */

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const words = text.split(/\s+/);
  // Use bigrams for better matching
  for (let i = 0; i < words.length - 1; i++) {
    tokens.add(`${words[i]} ${words[i + 1]}`);
  }
  for (const w of words) {
    if (w.length > 0) tokens.add(w);
  }
  return tokens;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function detectMovesAndCopies(diffs: ParsedDiff[], threshold?: number): MoveEvent[] {
  const thresh = threshold ?? config.moveDetectionThreshold;
  const events: MoveEvent[] = [];

  // Collect deleted blocks per file and added blocks per file
  const deletedBlocks: Array<{ file: string; text: string; tokens: Set<string> }> = [];
  const addedBlocks: Array<{ file: string; text: string; tokens: Set<string> }> = [];

  for (const diff of diffs) {
    if (diff.deletedLines.length > 0) {
      const text = diff.deletedLines.map((l) => l.content).join('\n');
      deletedBlocks.push({ file: diff.file, text, tokens: tokenize(text) });
    }
    if (diff.addedLines.length > 0) {
      const text = diff.addedLines.map((l) => l.content).join('\n');
      addedBlocks.push({ file: diff.file, text, tokens: tokenize(text) });
    }
  }

  // Compare each deleted block with each added block in different files
  for (const deleted of deletedBlocks) {
    for (const added of addedBlocks) {
      if (deleted.file === added.file) continue;

      const similarity = jaccardSimilarity(deleted.tokens, added.tokens);
      if (similarity < thresh) continue;

      // Move = source block is gone (delete present); Copy = source block still present
      const sourceStillPresent = addedBlocks.some(
        (a) => a.file === deleted.file && jaccardSimilarity(a.tokens, deleted.tokens) >= thresh,
      );

      events.push({
        type: sourceStillPresent ? 'copy' : 'move',
        sourceFile: deleted.file,
        targetFile: added.file,
        similarity,
      });
    }
  }

  return events;
}

/* ------------------------------------------------------------------ */
/*  Glob filtering                                                     */
/* ------------------------------------------------------------------ */

function matchGlob(pattern: string, filepath: string): boolean {
  // Convert glob to regex
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars (except * and ?)
    .replace(/\?/g, '[^/]');

  // Handle ** patterns: replace **/ with (any-path-prefix-or-empty)
  regexStr = regexStr
    .replace(/\*\*\//g, '(.+/)?') // **/ matches zero or more directories
    .replace(/\/\*\*/g, '(/.*)?') // /** matches zero or more trailing segments
    .replace(/\*\*/g, '.*') // standalone ** matches anything
    .replace(/\*/g, '[^/]*'); // single * matches within one segment

  return new RegExp(`^${regexStr}$`).test(filepath);
}

function matchesAnyGlob(filepath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchGlob(p, filepath));
}

export function filterDiffs(
  diffs: ParsedDiff[],
  includeGlobs?: string[],
  excludeGlobs?: string[],
): ParsedDiff[] {
  const include = includeGlobs ?? config.includeGlobs;
  const exclude = excludeGlobs ?? config.excludeGlobs;

  return diffs.filter((diff) => {
    if (include.length > 0 && !matchesAnyGlob(diff.file, include)) return false;
    if (exclude.length > 0 && matchesAnyGlob(diff.file, exclude)) return false;
    return true;
  });
}
