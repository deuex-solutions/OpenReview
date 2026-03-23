import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LearningsStore,
  containsTrigger,
  formatLearningsForPrompt,
} from '../../../core/src/learnings/learnings-store.js';
import type { Learning } from '../../../core/src/learnings/learnings-store.js';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../../../core/src/config/env.js', () => ({
  config: {
    openreviewHome: '/tmp/openreview-test',
  },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => '[]'),
  writeFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

/* ------------------------------------------------------------------ */
/*  Tests: LearningsStore                                              */
/* ------------------------------------------------------------------ */

describe('LearningsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('[]');
  });

  it('creates learnings directory and file on first access', () => {
    mockExistsSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('learnings')) return false;
      return true;
    });

    new LearningsStore('test-org/test-repo');
    expect(mockMkdirSync).toHaveBeenCalled();
  });

  it('generates correct file path from repo slug', () => {
    const store = new LearningsStore('test-org/test-repo');
    expect(store.getFilePath()).toContain('test-org-test-repo.json');
  });

  it('adds a learning and persists to disk', async () => {
    const store = new LearningsStore('test-org/test-repo');
    const learning = await store.add('ignore this pattern', 'Allow nullable returns in validators');

    expect(learning.id).toBeTruthy();
    expect(learning.trigger).toBe('ignore this pattern');
    expect(learning.finding).toBe('Allow nullable returns in validators');
    expect(learning.usedCount).toBe(0);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('lists all learnings', async () => {
    const store = new LearningsStore('org/repo');
    await store.add('trigger1', 'finding1');
    await store.add('trigger2', 'finding2');

    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it('deletes a learning by ID', async () => {
    const store = new LearningsStore('org/repo');
    const l1 = await store.add('t1', 'f1');
    await store.add('t2', 'f2');

    await store.delete(l1.id);
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].finding).toBe('f2');
  });

  it('records usage and updates counters', async () => {
    const store = new LearningsStore('org/repo');
    const learning = await store.add('trigger', 'finding');

    await store.recordUsage(learning.id);
    const all = await store.list();
    expect(all[0].usedCount).toBe(1);
  });

  it('prunes oldest unused learning when at max capacity', async () => {
    // Pre-load 50 learnings
    const existing: Learning[] = Array.from({ length: 50 }, (_, i) => ({
      id: `id-${i}`,
      trigger: `t-${i}`,
      finding: `f-${i}`,
      createdAt: new Date(2026, 0, i + 1).toISOString(),
      lastUsedAt: new Date(2026, 0, i + 1).toISOString(),
      usedCount: i === 0 ? 0 : 1, // First one is unused
    }));

    mockReadFileSync.mockReturnValue(JSON.stringify(existing));
    const store = new LearningsStore('org/repo');

    // Adding one more should prune the oldest unused (id-0)
    await store.add('new-trigger', 'new-finding');

    const all = await store.list();
    expect(all).toHaveLength(50); // Still at max
    expect(all.find((l) => l.id === 'id-0')).toBeUndefined(); // Pruned
    expect(all.find((l) => l.finding === 'new-finding')).toBeDefined(); // New one added
  });

  it('loads existing learnings from file', async () => {
    const existing: Learning[] = [
      {
        id: 'test-id',
        trigger: 'trigger',
        finding: 'finding',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-01-01T00:00:00.000Z',
        usedCount: 3,
      },
    ];
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));

    const store = new LearningsStore('org/repo');
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('test-id');
  });
});

/* ------------------------------------------------------------------ */
/*  Tests: containsTrigger                                             */
/* ------------------------------------------------------------------ */

describe('containsTrigger', () => {
  it('detects "false positive" trigger', () => {
    expect(containsTrigger('This is a false positive, please ignore')).toBe(true);
  });

  it('detects "ignore this" trigger', () => {
    expect(containsTrigger('Please ignore this finding')).toBe(true);
  });

  it('detects "not an issue" trigger', () => {
    expect(containsTrigger("That's not an issue in our codebase")).toBe(true);
  });

  it('detects "this is expected" trigger', () => {
    expect(containsTrigger('This is expected behavior')).toBe(true);
  });

  it('returns false for non-trigger text', () => {
    expect(containsTrigger('Great catch, we should fix this!')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(containsTrigger('FALSE POSITIVE')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Tests: formatLearningsForPrompt                                    */
/* ------------------------------------------------------------------ */

describe('formatLearningsForPrompt', () => {
  it('formats learnings as markdown list', () => {
    const learnings: Learning[] = [
      {
        id: '1',
        trigger: 't1',
        finding: 'Allow null returns',
        createdAt: '',
        lastUsedAt: '',
        usedCount: 0,
      },
      {
        id: '2',
        trigger: 't2',
        finding: 'Skip style checks on generated files',
        createdAt: '',
        lastUsedAt: '',
        usedCount: 0,
      },
    ];

    const result = formatLearningsForPrompt(learnings);
    expect(result).toContain('## Team Learnings');
    expect(result).toContain('- Allow null returns');
    expect(result).toContain('- Skip style checks on generated files');
  });

  it('returns empty string for empty learnings', () => {
    expect(formatLearningsForPrompt([])).toBe('');
  });

  it('caps output at approximately 2000 tokens', () => {
    const learnings: Learning[] = Array.from({ length: 100 }, (_, i) => ({
      id: `${i}`,
      trigger: `t-${i}`,
      finding: 'x'.repeat(200), // ~50 tokens each
      createdAt: '',
      lastUsedAt: '',
      usedCount: 0,
    }));

    const result = formatLearningsForPrompt(learnings);
    // Should be capped — not all 100 learnings should be included
    const lineCount = result.split('\n').filter((l) => l.startsWith('- ')).length;
    expect(lineCount).toBeLessThan(100);
    expect(result.length).toBeLessThanOrEqual(8200); // ~2000 tokens * 4 chars + some buffer
  });
});
