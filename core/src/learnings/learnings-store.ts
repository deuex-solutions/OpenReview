import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config } from '../config/env.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Learning {
  id: string;
  trigger: string;
  finding: string;
  createdAt: string;
  lastUsedAt: string;
  usedCount: number;
}

/* ------------------------------------------------------------------ */
/*  Trigger detection                                                  */
/* ------------------------------------------------------------------ */

const TRIGGER_PHRASES = [
  'ignore this',
  'false positive',
  'this is expected',
  'not an issue',
  'not a bug',
  'known issue',
  'by design',
  'intentional',
];

export function containsTrigger(text: string): boolean {
  const lower = text.toLowerCase();
  return TRIGGER_PHRASES.some((phrase) => lower.includes(phrase));
}

/* ------------------------------------------------------------------ */
/*  Learnings Store                                                    */
/* ------------------------------------------------------------------ */

const MAX_LEARNINGS = 50;

export class LearningsStore {
  private readonly filePath: string;
  private learnings: Learning[] = [];

  constructor(repoSlug: string) {
    const learningsDir = join(config.openreviewHome, 'learnings');
    if (!existsSync(learningsDir)) {
      mkdirSync(learningsDir, { recursive: true });
    }

    const safeName = repoSlug.replace(/\//g, '-');
    this.filePath = join(learningsDir, `${safeName}.json`);
    this.load();
  }

  /** Add a new learning. Prunes oldest unused entries if at capacity. */
  async add(trigger: string, finding: string): Promise<Learning> {
    this.prune();

    const learning: Learning = {
      id: randomUUID().slice(0, 8),
      trigger,
      finding,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      usedCount: 0,
    };

    this.learnings.push(learning);
    this.save();
    return learning;
  }

  /** List all learnings. */
  async list(): Promise<Learning[]> {
    return [...this.learnings];
  }

  /** Delete a learning by ID. */
  async delete(id: string): Promise<void> {
    this.learnings = this.learnings.filter((l) => l.id !== id);
    this.save();
  }

  /** Get all learnings (alias for injection into prompts). */
  async getAll(): Promise<Learning[]> {
    return [...this.learnings];
  }

  /** Record that a learning was used in a review. */
  async recordUsage(id: string): Promise<void> {
    const learning = this.learnings.find((l) => l.id === id);
    if (learning) {
      learning.usedCount++;
      learning.lastUsedAt = new Date().toISOString();
      this.save();
    }
  }

  /** Get the file path (for testing). */
  getFilePath(): string {
    return this.filePath;
  }

  /* ---- Internal ---- */

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.learnings = [];
      return;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.learnings = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.learnings = [];
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.learnings, null, 2), 'utf-8');
  }

  /** Prune oldest unused learnings when at capacity. */
  private prune(): void {
    if (this.learnings.length < MAX_LEARNINGS) return;

    // Sort candidates by usedCount (ascending), then by createdAt (oldest first)
    const unused = this.learnings
      .filter((l) => l.usedCount === 0)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (unused.length > 0) {
      // Remove the oldest unused learning
      this.learnings = this.learnings.filter((l) => l.id !== unused[0].id);
    } else {
      // All learnings have been used — remove the oldest one
      const sorted = [...this.learnings].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      this.learnings = this.learnings.filter((l) => l.id !== sorted[0].id);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Learning injection helpers                                         */
/* ------------------------------------------------------------------ */

const MAX_LEARNINGS_TOKENS = 2_000;
const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Format learnings for injection into a review prompt.
 * Caps at ~2,000 tokens.
 */
export function formatLearningsForPrompt(learnings: Learning[]): string {
  if (learnings.length === 0) return '';

  const maxChars = MAX_LEARNINGS_TOKENS * APPROX_CHARS_PER_TOKEN;
  const lines: string[] = ['## Team Learnings'];
  let totalChars = lines[0].length;

  for (const l of learnings) {
    const line = `- ${l.finding}`;
    if (totalChars + line.length > maxChars) break;
    lines.push(line);
    totalChars += line.length;
  }

  // Only return if we have at least one learning line
  return lines.length > 1 ? lines.join('\n') : '';
}
