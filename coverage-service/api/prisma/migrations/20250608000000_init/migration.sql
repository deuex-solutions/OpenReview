-- CreateEnum
CREATE TYPE "PrRunStatus" AS ENUM ('PENDING', 'CLONING', 'RUNNING_COVERAGE', 'ANALYZING', 'GENERATING_TESTS', 'RUNNING_TESTS', 'RECALCULATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PASS', 'FAIL', 'SKIPPED', 'PARTIAL');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "githubRepo" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "coverageCommand" TEXT NOT NULL DEFAULT 'npm test -- --coverage',
    "testCommand" TEXT NOT NULL DEFAULT 'npm test',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestRun" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "headBranch" TEXT,
    "headSha" TEXT,
    "baseBranch" TEXT,
    "status" "PrRunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PullRequestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageResult" (
    "id" TEXT NOT NULL,
    "prRunId" TEXT NOT NULL,
    "beforeCoverage" DOUBLE PRECISION,
    "afterCoverage" DOUBLE PRECISION,
    "diffCoverageBefore" DOUBLE PRECISION,
    "diffCoverageAfter" DOUBLE PRECISION,
    "generatedTestsCount" INTEGER NOT NULL DEFAULT 0,
    "filesImproved" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "executionStatus" "ExecutionStatus" NOT NULL DEFAULT 'SKIPPED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedTestArtifact" (
    "id" TEXT NOT NULL,
    "prRunId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "targetFile" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "passed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedTestArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" TEXT NOT NULL,
    "prRunId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_workspaceId_githubRepo_key" ON "Repository"("workspaceId", "githubRepo");

-- CreateIndex
CREATE INDEX "PullRequestRun_repositoryId_prNumber_idx" ON "PullRequestRun"("repositoryId", "prNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageResult_prRunId_key" ON "CoverageResult"("prRunId");

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestRun" ADD CONSTRAINT "PullRequestRun_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageResult" ADD CONSTRAINT "CoverageResult_prRunId_fkey" FOREIGN KEY ("prRunId") REFERENCES "PullRequestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedTestArtifact" ADD CONSTRAINT "GeneratedTestArtifact_prRunId_fkey" FOREIGN KEY ("prRunId") REFERENCES "PullRequestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_prRunId_fkey" FOREIGN KEY ("prRunId") REFERENCES "PullRequestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
