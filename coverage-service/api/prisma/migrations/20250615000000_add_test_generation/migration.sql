-- CreateEnum
CREATE TYPE "TestGenerationStatus" AS ENUM ('PENDING', 'CLONING', 'GENERATING_TESTS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "TestGenerationRun" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "targetFile" TEXT NOT NULL,
    "headBranch" TEXT,
    "baseBranch" TEXT,
    "status" "TestGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TestGenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestGenerationLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestGenerationLog_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "GeneratedTestArtifact" ALTER COLUMN "prRunId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GeneratedTestArtifact" ADD COLUMN "testGenerationRunId" TEXT;

-- CreateIndex
CREATE INDEX "TestGenerationRun_repositoryId_prNumber_idx" ON "TestGenerationRun"("repositoryId", "prNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedTestArtifact_testGenerationRunId_key" ON "GeneratedTestArtifact"("testGenerationRunId");

-- AddForeignKey
ALTER TABLE "TestGenerationRun" ADD CONSTRAINT "TestGenerationRun_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestGenerationLog" ADD CONSTRAINT "TestGenerationLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestGenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedTestArtifact" ADD CONSTRAINT "GeneratedTestArtifact_testGenerationRunId_fkey" FOREIGN KEY ("testGenerationRunId") REFERENCES "TestGenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
