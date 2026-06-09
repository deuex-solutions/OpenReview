import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerReviewCommand } from '../src/commands/review.js';
import * as coreModule from '@openreview/core';
import * as readlinePromises from 'node:readline/promises';

// Mock core functions
vi.mock('@openreview/core', async () => {
  const actual = await vi.importActual<typeof import('@openreview/core')>('@openreview/core');
  return {
    ...actual,
    loadConfig: vi.fn(() => ({ impactEnabled: true, mainModel: 'gpt-4o' })),
    validateConfig: vi.fn(),
    GitHubClient: {
      fromPRUrl: vi.fn(() => ({ client: {}, prNumber: 123 }))
    },
    runFastReview: vi.fn(() => Promise.resolve({
      findings: [],
      summary: { filesReviewed: 1, duration: '1s', mode: 'fast', findingsBySeverity: {}, totalFindings: 0 }
    }))
  };
});

vi.mock('node:readline/promises');
vi.mock('../src/formatter.js', () => ({
  formatText: vi.fn(() => 'formatted text'),
  formatMarkdown: vi.fn(),
  formatJSON: vi.fn()
}));

describe('CLI Review Command', () => {
  let program: Command;
  let originalEnv: NodeJS.ProcessEnv;
  let originalStdout: any;
  let stdoutData = '';

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    program = new Command();
    program.exitOverride();
    registerReviewCommand(program);
    
    vi.clearAllMocks();
    
    // Mock GitHub methods
    vi.mocked(coreModule.GitHubClient.fromPRUrl).mockReturnValue({
      client: {
        owner: 'test',
        repo: 'repo',
        getPR: vi.fn().mockResolvedValue({ title: 'Test PR', body: '', head: { sha: 'a' }, base: { sha: 'b' }, user: { login: 'user' } }),
        getPRFiles: vi.fn().mockResolvedValue([]),
        getPRDiff: vi.fn().mockResolvedValue('')
      } as any,
      prNumber: 123
    });
    
    // Catch stdout
    stdoutData = '';
    originalStdout = process.stdout.write;
    process.stdout.write = (chunk: string) => {
      stdoutData += chunk;
      return true;
    };
    
    // Mock stderr to be silent
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    process.stdout.write = originalStdout;
    vi.restoreAllMocks();
  });

  it('parses --impact flag and overrides config', async () => {
    const mockCfg = { impactEnabled: false, mainModel: 'gpt-4o' };
    vi.mocked(coreModule.loadConfig).mockReturnValue(mockCfg as any);

    await program.parseAsync(['node', 'test', 'review', '--url', 'https://github.com/a/b/pull/1', '--impact']);
    
    expect(mockCfg.impactEnabled).toBe(true);
  });

  it('parses --no-impact flag and overrides config', async () => {
    const mockCfg = { impactEnabled: true, mainModel: 'gpt-4o' };
    vi.mocked(coreModule.loadConfig).mockReturnValue(mockCfg as any);

    await program.parseAsync(['node', 'test', 'review', '--url', 'https://github.com/a/b/pull/1', '--no-impact']);
    
    expect(mockCfg.impactEnabled).toBe(false);
  });

  it('prompts interactively when no flag is provided in TTY', async () => {
    // Setup TTY and not CI
    process.env.CI = '';
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    
    const mockCfg = { impactEnabled: false, mainModel: 'gpt-4o' };
    vi.mocked(coreModule.loadConfig).mockReturnValue(mockCfg as any);

    const mockRl = {
      question: vi.fn().mockResolvedValue('y'),
      close: vi.fn()
    };
    vi.mocked(readlinePromises.createInterface).mockReturnValue(mockRl as any);

    await program.parseAsync(['node', 'test', 'review', '--url', 'https://github.com/a/b/pull/1']);
    
    expect(readlinePromises.createInterface).toHaveBeenCalled();
    expect(mockRl.question).toHaveBeenCalledWith('Would you like to include impact analysis? (y/n) ');
    expect(mockCfg.impactEnabled).toBe(true);
  });
});
