import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeImpactReport } from '../src/impact-report.js';
import type { ImpactResult } from '@openreview/core';

vi.mock('node:fs/promises');

describe('writeImpactReport', () => {
  const mockResult: ImpactResult = {
    changedFiles: ['src/index.ts'],
    impactedFiles: [],
    affectedPages: [],
    affectedComponents: [],
    summary: { totalImpacted: 0, directDependents: 0, transitiveDependents: 0, affectedPageCount: 0 }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes to impact-report.json if target is an existing directory', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await writeImpactReport(mockResult, '/tmp/reports');

    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join('/tmp/reports', 'impact-report.json'),
      JSON.stringify(mockResult, null, 2),
      'utf-8'
    );
  });

  it('creates directory and writes file if path does not exist and has no extension', async () => {
    const error: any = new Error('Not found');
    error.code = 'ENOENT';
    vi.mocked(fs.stat).mockRejectedValue(error);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await writeImpactReport(mockResult, '/tmp/new-dir');

    expect(fs.mkdir).toHaveBeenCalledWith('/tmp/new-dir', { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join('/tmp/new-dir', 'impact-report.json'),
      JSON.stringify(mockResult, null, 2),
      'utf-8'
    );
  });

  it('writes directly to the file if it has an extension', async () => {
    const error: any = new Error('Not found');
    error.code = 'ENOENT';
    vi.mocked(fs.stat).mockRejectedValue(error);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await writeImpactReport(mockResult, '/tmp/reports/custom.json');

    expect(fs.mkdir).toHaveBeenCalledWith('/tmp/reports', { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/reports/custom.json',
      JSON.stringify(mockResult, null, 2),
      'utf-8'
    );
  });
});
