/** Marker in a PR body that tells OpenReview to skip review/coverage. */
export const OPENREVIEW_SKIP_MARKER = 'openreview: skip';

const DEFAULT_BRANCH_PREFIX = 'openreview/tests';

/**
 * True when `headRef` is an OpenReview stacked test branch
 * (e.g. `openreview/tests/pr-42`).
 */
export function isStackedTestBranch(
  headRef: string,
  branchPrefix = DEFAULT_BRANCH_PREFIX,
): boolean {
  const prefix = branchPrefix.replace(/\/+$/, '');
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}/pr-\\d+$`).test(headRef);
}
