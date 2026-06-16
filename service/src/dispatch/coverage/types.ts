/**
 * Wire contract between OpenReview and the Coverage Service.
 *
 * Mirrors the controllers / DTOs in `coverage-service/api/src/**`. Keep these
 * schemas tolerant: every response field that we do not consume is left as
 * `unknown` (or simply omitted from the schema), so unrelated additions on
 * the downstream side never break us at parse time.
 *
 * If a field listed here disappears from the coverage service, the runtime
 * Zod parse will fail loud — that is intentional. We want a 500 on contract
 * drift, not a silent "tests not generated" outage.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/*  POST /repositories                                                  */
/* ------------------------------------------------------------------ */

export const CreateRepositoryRequestSchema = z.object({
  githubRepo: z.string().min(1), // "owner/repo"
  defaultBranch: z.string().min(1).optional(),
  coverageCommand: z.string().optional(),
  testCommand: z.string().optional(),
  installCommand: z.string().optional(),
});

export type CreateRepositoryRequest = z.infer<typeof CreateRepositoryRequestSchema>;

/** Returned by both POST /repositories and entries of GET /repositories. */
export const RepositorySchema = z
  .object({
    id: z.string().min(1),
    githubRepo: z.string().min(1),
    defaultBranch: z.string().optional(),
    coverageCommand: z.string().optional(),
    testCommand: z.string().optional(),
    installCommand: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

export type Repository = z.infer<typeof RepositorySchema>;

/* ------------------------------------------------------------------ */
/*  POST /repositories/:id/analyze                                      */
/* ------------------------------------------------------------------ */

export const TriggerAnalysisRequestSchema = z.object({
  prNumber: z.number().int().positive(),
});

export type TriggerAnalysisRequest = z.infer<typeof TriggerAnalysisRequestSchema>;

export const TriggerAnalysisResponseSchema = z
  .object({
    prRunId: z.string().min(1),
    status: z.string().optional(), // "enqueued"
    repository: z.string().optional(),
    prNumber: z.number().optional(),
  })
  .passthrough();

export type TriggerAnalysisResponse = z.infer<typeof TriggerAnalysisResponseSchema>;

/* ------------------------------------------------------------------ */
/*  GET /pr-runs/:id                                                    */
/* ------------------------------------------------------------------ */

/** Status enum exactly as published by `coverage-service/lib/src/types`. */
export const PrRunStatusSchema = z.enum([
  'PENDING',
  'CLONING',
  'RUNNING_COVERAGE',
  'ANALYZING',
  'GENERATING_TESTS',
  'RUNNING_TESTS',
  'RECALCULATING',
  'COMPLETED',
  'FAILED',
]);

export type PrRunStatus = z.infer<typeof PrRunStatusSchema>;

export const TERMINAL_PR_RUN_STATUSES: ReadonlySet<PrRunStatus> = new Set([
  'COMPLETED',
  'FAILED',
]);

/** One side (before OR after) of a file's coverage snapshot. */
const FileCoverageSnapshotSchema = z
  .object({
    lineCoveragePercent: z.number(),
    diffCoveragePercent: z.number().nullable().optional(),
    uncoveredLines: z.array(z.number()).optional(),
  })
  .passthrough();

export const FileCoverageEntrySchema = z.object({
  file: z.string().min(1),
  before: FileCoverageSnapshotSchema.nullable(),
  after: FileCoverageSnapshotSchema.nullable(),
});

export type FileCoverageEntry = z.infer<typeof FileCoverageEntrySchema>;

export const GeneratedTestFileSchema = z
  .object({
    id: z.string().min(1),
    filePath: z.string().min(1),
    targetFile: z.string().min(1),
    passed: z.boolean().nullable().optional(),
    fileContent: z.string(),
    downloadUrl: z.string().optional(),
  })
  .passthrough();

export type GeneratedTestFile = z.infer<typeof GeneratedTestFileSchema>;

export const PrRunSchema = z
  .object({
    id: z.string().min(1),
    repository: z.string().min(1), // "owner/repo"
    prNumber: z.number().int().positive(),
    status: PrRunStatusSchema,
    startedAt: z.string().optional(),
    completedAt: z.string().nullable().optional(),

    // Overall (whole-repo) coverage
    coverageBefore: z.number().nullable().optional(),
    coverageAfter: z.number().nullable().optional(),

    // Diff coverage (only the lines changed in this PR)
    diffCoverageBefore: z.number().nullable().optional(),
    diffCoverageAfter: z.number().nullable().optional(),

    fileCoverage: z.array(FileCoverageEntrySchema).default([]),

    generatedTestsCount: z.number().int().nonnegative().optional(),
    filesImproved: z.array(z.string()).optional(),
    executionStatus: z
      .enum(['PASS', 'FAIL', 'SKIPPED', 'PARTIAL'])
      .optional(),
    generatedTestFiles: z.array(GeneratedTestFileSchema).default([]),
  })
  .passthrough();

export type PrRun = z.infer<typeof PrRunSchema>;

/* ------------------------------------------------------------------ */
/*  GET /repositories                                                   */
/* ------------------------------------------------------------------ */

export const RepositoryListSchema = z.array(RepositorySchema);

export type RepositoryList = z.infer<typeof RepositoryListSchema>;
