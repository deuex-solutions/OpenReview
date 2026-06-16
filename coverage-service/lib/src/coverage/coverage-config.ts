/** Parse TEST_THRESHOLD — accepts 80 (percent) or 0.8 (fraction). Default 80. */
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
