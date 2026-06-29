-- CreateEnum
CREATE TYPE "GeneratedTestStatus" AS ENUM ('PENDING', 'PASSING', 'FAILED');

-- CreateTable
CREATE TABLE "CoverageIteration" (
    "id" TEXT NOT NULL,
    "prRunId" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL,
    "coverageBefore" DOUBLE PRECISION NOT NULL,
    "coverageAfter" DOUBLE PRECISION,
    "coverageGain" DOUBLE PRECISION,
    "generatedTests" INTEGER NOT NULL DEFAULT 0,
    "failedTests" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageIteration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageGap" (
    "id" TEXT NOT NULL,
    "iterationId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "missingLines" INTEGER[],
    "priority" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageGap_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "GeneratedTestArtifact" ADD COLUMN "coverageIterationId" TEXT,
ADD COLUMN "status" "GeneratedTestStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "repairAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "coverageContribution" DOUBLE PRECISION,
ADD COLUMN "failureReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CoverageIteration_prRunId_iteration_key" ON "CoverageIteration"("prRunId", "iteration");

-- CreateIndex
CREATE INDEX "CoverageIteration_prRunId_idx" ON "CoverageIteration"("prRunId");

-- CreateIndex
CREATE INDEX "CoverageGap_iterationId_idx" ON "CoverageGap"("iterationId");

-- CreateIndex
CREATE INDEX "GeneratedTestArtifact_coverageIterationId_idx" ON "GeneratedTestArtifact"("coverageIterationId");

-- AddForeignKey
ALTER TABLE "CoverageIteration" ADD CONSTRAINT "CoverageIteration_prRunId_fkey" FOREIGN KEY ("prRunId") REFERENCES "PullRequestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageGap" ADD CONSTRAINT "CoverageGap_iterationId_fkey" FOREIGN KEY ("iterationId") REFERENCES "CoverageIteration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedTestArtifact" ADD CONSTRAINT "GeneratedTestArtifact_coverageIterationId_fkey" FOREIGN KEY ("coverageIterationId") REFERENCES "CoverageIteration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill status from passed column
UPDATE "GeneratedTestArtifact" SET "status" = 'PASSING' WHERE "passed" = true;
UPDATE "GeneratedTestArtifact" SET "status" = 'FAILED' WHERE "passed" = false;
