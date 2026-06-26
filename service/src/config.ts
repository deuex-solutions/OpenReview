import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Load environment from up to two .env files:
 *   1. service/.env      — service-specific overrides (webhook secret, ports)
 *   2. <repo-root>/.env  — shared review-engine config (GITHUB_PAT, LLM keys)
 *
 * Values already present in process.env or in the FIRST file loaded win
 * (dotenv does not overwrite by default). We deliberately load service/.env
 * first so it can override repo-root values.
 */
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, '..', '.env'), // service/.env when running from src/ or dist/
  resolve(here, '..', '..', '.env'), // repo-root .env
];
for (const file of candidates) {
  if (existsSync(file)) loadDotenv({ path: file, quiet: true });
}

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

const numberFromEnv = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw.trim() === '') return defaultValue;
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? defaultValue : parsed;
    });

const stringOrEmpty = z
  .string()
  .optional()
  .transform((raw) => (raw ?? '').trim());

const ConfigSchema = z.object({
  // Server
  port: numberFromEnv(3000),
  host: stringOrEmpty,
  nodeEnv: stringOrEmpty,
  logLevel: stringOrEmpty,
  maxPayloadBytes: numberFromEnv(26_214_400),

  // GitHub
  githubWebhookSecret: stringOrEmpty,
  githubPat: stringOrEmpty,

  // Redis / queue
  redisUrl: stringOrEmpty,
  workerConcurrency: numberFromEnv(4),
  jobMaxAttempts: numberFromEnv(3),
  jobBackoffMs: numberFromEnv(5000),
  jobKeepCompleted: numberFromEnv(200),
  jobKeepFailed: numberFromEnv(500),

  // Coverage Service integration (downstream microservice that runs diff
  // coverage + LLM unit-test generation). When disabled the OpenReview
  // service still performs code review — the coverage pipeline is opt-in.
  coverageServiceEnabled: z
    .string()
    .optional()
    .transform((raw) => raw?.toLowerCase() === 'true'),
  coverageServiceUrl: stringOrEmpty,
  /** Optional shared secret. Sent as `x-api-key`; ignored by the service if unset. */
  coverageServiceApiKey: stringOrEmpty,
  coverageServicePollIntervalMs: numberFromEnv(5000),
  coverageServicePollTimeoutMs: numberFromEnv(1_800_000), // 30 minutes
  coverageServiceBranchPrefix: stringOrEmpty,
  /** Defaults passed when auto-registering a previously unseen repo. */
  coverageServiceDefaultBranch: stringOrEmpty,
  coverageServiceCoverageCommand: stringOrEmpty,
  coverageServiceTestCommand: stringOrEmpty,
  coverageServiceInstallCommand: stringOrEmpty,

  reviewCacheEnabled: z
    .string()
    .optional()
    .transform((raw) => raw?.toLowerCase() !== 'false'),
  reviewCacheTtlSeconds: numberFromEnv(604_800), // 7 days
});

export type ServiceConfig = z.infer<typeof ConfigSchema> & {
  isProduction: boolean;
};

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

/**
 * Load and validate service configuration from process.env.
 *
 * GITHUB_PAT falls back to the one defined in the project-root .env loaded
 * by @openreview/core. The webhook secret is always required.
 */
export function loadServiceConfig(): ServiceConfig {
  const parsed = ConfigSchema.parse({
    port: process.env.PORT,
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    maxPayloadBytes: process.env.MAX_PAYLOAD_BYTES,

    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    githubPat: process.env.GITHUB_PAT || process.env.GITHUB_TOKEN,

    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    workerConcurrency: process.env.WORKER_CONCURRENCY,
    jobMaxAttempts: process.env.JOB_MAX_ATTEMPTS,
    jobBackoffMs: process.env.JOB_BACKOFF_MS,
    jobKeepCompleted: process.env.JOB_KEEP_COMPLETED,
    jobKeepFailed: process.env.JOB_KEEP_FAILED,

    coverageServiceEnabled: process.env.COVERAGE_SERVICE_ENABLED,
    coverageServiceUrl: process.env.COVERAGE_SERVICE_URL,
    coverageServiceApiKey: process.env.COVERAGE_SERVICE_API_KEY,
    coverageServicePollIntervalMs: process.env.COVERAGE_SERVICE_POLL_INTERVAL_MS,
    coverageServicePollTimeoutMs: process.env.COVERAGE_SERVICE_POLL_TIMEOUT_MS,
    coverageServiceBranchPrefix:
      process.env.COVERAGE_SERVICE_BRANCH_PREFIX || 'openreview/tests',
    coverageServiceDefaultBranch:
      process.env.COVERAGE_SERVICE_DEFAULT_BRANCH || 'main',
    coverageServiceCoverageCommand: process.env.COVERAGE_SERVICE_COVERAGE_COMMAND,
    coverageServiceTestCommand: process.env.COVERAGE_SERVICE_TEST_COMMAND,
    coverageServiceInstallCommand: process.env.COVERAGE_SERVICE_INSTALL_COMMAND,

    reviewCacheEnabled: process.env.REVIEW_CACHE_ENABLED,
    reviewCacheTtlSeconds: process.env.REVIEW_CACHE_TTL_SECONDS,
  });

  return {
    ...parsed,
    isProduction: parsed.nodeEnv === 'production',
  };
}

/**
 * Throw if any required setting is missing. Called once at process start
 * so misconfigured deploys fail fast rather than at first webhook delivery.
 */
export function assertConfigReady(cfg: ServiceConfig): void {
  const missing: string[] = [];

  if (!cfg.githubWebhookSecret) missing.push('GITHUB_WEBHOOK_SECRET');
  if (!cfg.githubPat) missing.push('GITHUB_PAT (or GITHUB_TOKEN)');
  if (!cfg.redisUrl) missing.push('REDIS_URL');

  if (cfg.coverageServiceEnabled) {
    if (!cfg.coverageServiceUrl) missing.push('COVERAGE_SERVICE_URL');
    // COVERAGE_SERVICE_API_KEY is optional — only sent if non-empty.
  }

  if (missing.length > 0) {
    throw new Error(
      `OpenReview service is misconfigured. Missing required env vars: ${missing.join(', ')}.\n` +
        `See service/.env.example for the full list.`,
    );
  }
}
