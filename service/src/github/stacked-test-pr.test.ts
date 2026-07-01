import { describe, expect, it } from 'vitest';

import {
  isStackedTestBranch,
  OPENREVIEW_SKIP_MARKER,
} from './stacked-test-pr.js';

describe('isStackedTestBranch', () => {
  it('matches the default openreview/tests/pr-N pattern', () => {
    expect(isStackedTestBranch('openreview/tests/pr-6')).toBe(true);
    expect(isStackedTestBranch('openreview/tests/pr-495')).toBe(true);
  });

  it('rejects feature branches and partial matches', () => {
    expect(isStackedTestBranch('feature/foo')).toBe(false);
    expect(isStackedTestBranch('openreview/tests/pr-6-extra')).toBe(false);
    expect(isStackedTestBranch('openreview/tests')).toBe(false);
  });

  it('respects a custom branch prefix', () => {
    expect(isStackedTestBranch('custom/tests/pr-1', 'custom/tests')).toBe(true);
    expect(isStackedTestBranch('openreview/tests/pr-1', 'custom/tests')).toBe(
      false,
    );
  });
});

describe('OPENREVIEW_SKIP_MARKER', () => {
  it('is the documented skip string', () => {
    expect(OPENREVIEW_SKIP_MARKER).toBe('openreview: skip');
  });
});
