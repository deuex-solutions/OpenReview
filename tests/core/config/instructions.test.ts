import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { findInstructionFiles, loadInstructions } from '../../../core/src/config/instructions.js';

describe('findInstructionFiles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openreview-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty array for repo with no instruction files', async () => {
    const files = await findInstructionFiles(tempDir);
    expect(files).toEqual([]);
  });

  it('finds REVIEW.md at root', async () => {
    await writeFile(join(tempDir, 'REVIEW.md'), '# Review rules');

    const files = await findInstructionFiles(tempDir);

    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('REVIEW.md');
    expect(files[0].depth).toBe(0);
    expect(files[0].content).toBe('# Review rules');
  });

  it('finds all supported instruction file types', async () => {
    await writeFile(join(tempDir, 'REVIEW.md'), 'review');
    await writeFile(join(tempDir, 'AGENTS.md'), 'agents');
    await writeFile(join(tempDir, 'CLAUDE.md'), 'claude');
    await writeFile(join(tempDir, '.cursorrules'), 'cursor');
    await writeFile(join(tempDir, '.windsurfrules'), 'windsurf');

    const files = await findInstructionFiles(tempDir);

    expect(files).toHaveLength(5);
    const names = files.map((f) => f.fileName);
    expect(names).toContain('REVIEW.md');
    expect(names).toContain('AGENTS.md');
    expect(names).toContain('CLAUDE.md');
    expect(names).toContain('.cursorrules');
    expect(names).toContain('.windsurfrules');
  });

  it('sorts by depth (root first) then by priority', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'AGENTS.md'), 'root agents');
    await writeFile(join(tempDir, 'REVIEW.md'), 'root review');
    await writeFile(join(tempDir, 'src', 'REVIEW.md'), 'src review');

    const files = await findInstructionFiles(tempDir);

    expect(files).toHaveLength(3);
    // Root files first, REVIEW.md before AGENTS.md (priority 0 < 1)
    expect(files[0].fileName).toBe('REVIEW.md');
    expect(files[0].depth).toBe(0);
    expect(files[1].fileName).toBe('AGENTS.md');
    expect(files[1].depth).toBe(0);
    // Then subdirectory files
    expect(files[2].fileName).toBe('REVIEW.md');
    expect(files[2].depth).toBe(1);
  });

  it('records correct depth for nested files', async () => {
    await mkdir(join(tempDir, 'src', 'components'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'components', 'REVIEW.md'), 'nested');

    const files = await findInstructionFiles(tempDir);

    expect(files).toHaveLength(1);
    expect(files[0].depth).toBe(2);
  });

  it('ignores node_modules', async () => {
    await mkdir(join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(tempDir, 'node_modules', 'pkg', 'REVIEW.md'), 'should be ignored');

    const files = await findInstructionFiles(tempDir);

    expect(files).toHaveLength(0);
  });
});

describe('loadInstructions', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openreview-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty strings for repo with no instruction files', async () => {
    const result = await loadInstructions(tempDir);

    expect(result.globalInstructions).toBe('');
    expect(result.scopedInstructions.size).toBe(0);
  });

  it('puts root-level files into globalInstructions', async () => {
    await writeFile(join(tempDir, 'REVIEW.md'), '# Global review rules');

    const result = await loadInstructions(tempDir);

    expect(result.globalInstructions).toBe('# Global review rules');
    expect(result.scopedInstructions.size).toBe(0);
  });

  it('puts subdirectory files into scopedInstructions', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'REVIEW.md'), '# Src review rules');

    const result = await loadInstructions(tempDir);

    expect(result.globalInstructions).toBe('');
    expect(result.scopedInstructions.size).toBe(1);
    expect(result.scopedInstructions.get('src')).toBe('# Src review rules');
  });

  it('concatenates multiple root files with double newline', async () => {
    await writeFile(join(tempDir, 'REVIEW.md'), 'review content');
    await writeFile(join(tempDir, 'AGENTS.md'), 'agents content');

    const result = await loadInstructions(tempDir);

    expect(result.globalInstructions).toBe('review content\n\nagents content');
  });

  it('concatenates multiple files in same subdirectory', async () => {
    await mkdir(join(tempDir, 'lib'), { recursive: true });
    await writeFile(join(tempDir, 'lib', 'REVIEW.md'), 'lib review');
    await writeFile(join(tempDir, 'lib', 'AGENTS.md'), 'lib agents');

    const result = await loadInstructions(tempDir);

    expect(result.scopedInstructions.get('lib')).toBe('lib review\n\nlib agents');
  });

  it('caps total content at ~10,000 tokens (40,000 chars)', async () => {
    // Write a file with 50,000 characters — should be truncated
    const longContent = 'x'.repeat(50_000);
    await writeFile(join(tempDir, 'REVIEW.md'), longContent);

    const result = await loadInstructions(tempDir);

    expect(result.globalInstructions.length).toBe(40_000);
  });

  it('stops reading files once token cap is reached', async () => {
    // First file fills up the cap
    const bigContent = 'a'.repeat(40_000);
    await writeFile(join(tempDir, 'REVIEW.md'), bigContent);
    // Second file should be ignored
    await writeFile(join(tempDir, 'AGENTS.md'), 'should not appear');

    const result = await loadInstructions(tempDir);

    expect(result.globalInstructions).toBe(bigContent);
    expect(result.globalInstructions).not.toContain('should not appear');
  });
});
