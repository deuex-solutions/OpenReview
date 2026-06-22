import { describe, expect, it } from 'vitest';

import {
  pickExistingTestFilePath,
  resolveTestFileTarget,
} from '../../coverage-service/lib/src/test-paths';

describe('pickExistingTestFilePath', () => {
  it('prefers the tests/ mirror over colocated tests', () => {
    const picked = pickExistingTestFilePath(
      [
        'src/utils/mathUtils.test.js',
        'tests/utils/mathUtils.test.js',
      ],
      'src/utils/mathUtils.js',
      'node:test',
    );
    expect(picked).toBe('tests/utils/mathUtils.test.js');
  });

  it('returns null when no existing tests match', () => {
    expect(
      pickExistingTestFilePath([], 'src/foo.js', 'node:test'),
    ).toBeNull();
  });

  it('falls back to tests/ directory match when mirror name differs slightly', () => {
    const picked = pickExistingTestFilePath(
      ['tests/utils/mathUtils.spec.js'],
      'src/utils/mathUtils.js',
      'node:test',
    );
    expect(picked).toBe('tests/utils/mathUtils.spec.js');
  });
});

describe('resolveTestFileTarget', () => {
  it('creates at inferred path when no tests exist', () => {
    expect(
      resolveTestFileTarget([], 'src/utils/mathUtils.js', 'node:test'),
    ).toEqual({
      testOutputPath: 'tests/utils/mathUtils.test.js',
      isUpdatingExistingTest: false,
    });
  });

  it('updates existing tests/ mirror when present', () => {
    expect(
      resolveTestFileTarget(
        ['tests/utils/mathUtils.test.js'],
        'src/utils/mathUtils.js',
        'node:test',
      ),
    ).toEqual({
      testOutputPath: 'tests/utils/mathUtils.test.js',
      isUpdatingExistingTest: true,
    });
  });

  it('uses pytest path for python sources', () => {
    expect(
      resolveTestFileTarget(
        ['tests/test_math_utils.py'],
        'src/math_utils.py',
        'pytest',
      ),
    ).toEqual({
      testOutputPath: 'tests/test_math_utils.py',
      isUpdatingExistingTest: true,
    });
  });

  it('updates __test__ directory layout when present', () => {
    expect(
      resolveTestFileTarget(
        ['src/utils/__test__/mathUtils.test.js'],
        'src/utils/mathUtils.js',
        'node:test',
      ),
    ).toEqual({
      testOutputPath: 'src/utils/__test__/mathUtils.test.js',
      isUpdatingExistingTest: true,
    });
  });

  it('prefers tests/ mirror over __test__ when both exist', () => {
    const picked = pickExistingTestFilePath(
      [
        'src/utils/__test__/mathUtils.test.js',
        'tests/utils/mathUtils.test.js',
      ],
      'src/utils/mathUtils.js',
      'node:test',
    );
    expect(picked).toBe('tests/utils/mathUtils.test.js');
  });
});
