/** Parse TARGET_DIFF_COVERAGE or TEST_THRESHOLD — accepts 80 (percent) or 0.8 (fraction). Default 80. */
export function getTargetDiffCoveragePercent(): number {
  const targetRaw = process.env.TARGET_DIFF_COVERAGE?.trim();
  if (targetRaw) {
    const value = parseFloat(targetRaw);
    if (!Number.isNaN(value)) {
      return value <= 1 ? value * 100 : value;
    }
  }
  return getTestThresholdPercent();
}

/** @deprecated Use getTargetDiffCoveragePercent — kept for backward compatibility. */
export function getTestThresholdPercent(): number {
  const raw = process.env.TEST_THRESHOLD?.trim();
  if (!raw) return 80;

  const value = parseFloat(raw);
  if (Number.isNaN(value)) return 80;

  return value <= 1 ? value * 100 : value;
}

/** Parse MAX_GENERATION_ATTEMPTS. Default 3. */
export function getMaxGenerationAttempts(): number {
  const raw = process.env.MAX_GENERATION_ATTEMPTS?.trim();
  if (!raw) return 3;

  const value = parseInt(raw, 10);
  return Number.isNaN(value) || value < 1 ? 3 : value;
}

/** Parse MAX_OPTIMIZATION_ITERATIONS. Default 8. */
export function getMaxOptimizationIterations(): number {
  const raw = process.env.MAX_OPTIMIZATION_ITERATIONS?.trim();
  if (!raw) return 8;

  const value = parseInt(raw, 10);
  return Number.isNaN(value) || value < 1 ? 8 : value;
}

/** Parse MAX_REPAIR_ATTEMPTS. Default 3. */
export function getMaxRepairAttempts(): number {
  const raw = process.env.MAX_REPAIR_ATTEMPTS?.trim();
  if (!raw) return 3;

  const value = parseInt(raw, 10);
  return Number.isNaN(value) || value < 1 ? 3 : value;
}

/** Parse MIN_COVERAGE_GAIN (percentage points). Default 1. */
export function getMinCoverageGain(): number {
  const raw = process.env.MIN_COVERAGE_GAIN?.trim();
  if (!raw) return 1;

  const value = parseFloat(raw);
  return Number.isNaN(value) || value < 0 ? 1 : value;
}

/** Parse ENABLE_REPAIR_LOOP. Default true. */
export function isRepairLoopEnabled(): boolean {
  const raw = process.env.ENABLE_REPAIR_LOOP?.trim()?.toLowerCase();
  if (!raw) return true;
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

/** Max files to process per optimization iteration. Default 10. */
export function getMaxFilesPerIteration(): number {
  const raw = process.env.MAX_FILES_PER_ITERATION?.trim();
  if (!raw) return 10;

  const value = parseInt(raw, 10);
  return Number.isNaN(value) || value < 1 ? 10 : value;
}
