import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../config/env.js';
import type { ReviewFinding } from '../review/types.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TraceEntry {
  type: 'fast_review' | 'rlm_iteration' | 'findings' | 'metadata';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface TraceMeta {
  owner: string;
  repo: string;
  prNumber: number;
  startedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Secret scrubbing                                                   */
/* ------------------------------------------------------------------ */

const SECRET_PATTERNS = [
  /(?:api[_-]?key|token|secret|password|credential|auth)[\s]*[:=]\s*["']?[^\s"',}{]+/gi,
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI keys
  /ghp_[a-zA-Z0-9]{36}/g, // GitHub PATs
  /ghs_[a-zA-Z0-9]{36}/g, // GitHub app tokens
  /xoxb-[0-9]+-[a-zA-Z0-9]+/g, // Slack tokens
];

function scrubSecrets(text: string): string {
  let cleaned = text;
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[REDACTED]');
  }
  return cleaned;
}

/* ------------------------------------------------------------------ */
/*  TraceLogger                                                        */
/* ------------------------------------------------------------------ */

export class TraceLogger {
  private readonly filePath: string;
  private readonly entries: TraceEntry[] = [];
  private readonly meta: TraceMeta;
  private readonly startTime: number;

  constructor(meta: TraceMeta) {
    this.meta = meta;
    this.startTime = Date.now();

    const tracesDir = join(config.openreviewHome, 'traces');
    if (!existsSync(tracesDir)) {
      mkdirSync(tracesDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}-${meta.owner}-${meta.repo}-${meta.prNumber}.json`;
    this.filePath = join(tracesDir, filename);
  }

  /** Log a fast review trace entry. */
  logFastReview(
    input: { diff: string; files: string[] },
    output: { findingsCount: number; summary: string },
    duration: number,
  ): void {
    this.entries.push({
      type: 'fast_review',
      timestamp: new Date().toISOString(),
      data: {
        input: {
          fileCount: input.files.length,
          diffLength: input.diff.length,
        },
        output: {
          findingsCount: output.findingsCount,
          summary: output.summary,
        },
        duration,
      },
    });
  }

  /** Log a single RLM iteration. */
  logRLMIteration(
    iteration: number,
    reasoning: string,
    code: string | null,
    sandboxOutput: string | null,
  ): void {
    this.entries.push({
      type: 'rlm_iteration',
      timestamp: new Date().toISOString(),
      data: {
        iteration,
        reasoning: scrubSecrets(reasoning),
        code: code ? scrubSecrets(code) : null,
        sandboxOutput: sandboxOutput ? scrubSecrets(sandboxOutput) : null,
      },
    });
  }

  /** Log the final findings. */
  logFindings(findings: ReviewFinding[]): void {
    this.entries.push({
      type: 'findings',
      timestamp: new Date().toISOString(),
      data: {
        count: findings.length,
        findings: findings.map((f) => ({
          id: f.id,
          category: f.category,
          severity: f.severity,
          file: f.file,
          startLine: f.startLine,
          endLine: f.endLine,
          title: f.title,
          source: f.source,
        })),
      },
    });
  }

  /** Write final metadata and flush to disk. */
  close(llmCallCount?: number): void {
    const totalDuration = Date.now() - this.startTime;

    this.entries.push({
      type: 'metadata',
      timestamp: new Date().toISOString(),
      data: {
        totalDuration,
        llmCallCount: llmCallCount ?? 0,
        entryCount: this.entries.length,
      },
    });

    const trace = {
      version: 1,
      meta: this.meta,
      entries: this.entries,
    };

    const json = scrubSecrets(JSON.stringify(trace, null, 2));
    writeFileSync(this.filePath, json, 'utf-8');
  }

  /** Get the trace file path. */
  getFilePath(): string {
    return this.filePath;
  }
}
