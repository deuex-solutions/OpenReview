-- CreateTable
CREATE TABLE "LlmUsageRecord" (
    "id"                  TEXT NOT NULL,
    "prRunId"             TEXT,
    "testGenerationRunId" TEXT,
    "provider"            TEXT NOT NULL,
    "modelName"           TEXT NOT NULL,
    "promptTokens"        INTEGER NOT NULL,
    "completionTokens"    INTEGER NOT NULL,
    "totalTokens"         INTEGER NOT NULL,
    "estimatedCostUsd"    DOUBLE PRECISION,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmUsageRecord_prRunId_idx" ON "LlmUsageRecord"("prRunId");

-- CreateIndex
CREATE INDEX "LlmUsageRecord_testGenerationRunId_idx" ON "LlmUsageRecord"("testGenerationRunId");

-- AddForeignKey
ALTER TABLE "LlmUsageRecord" ADD CONSTRAINT "LlmUsageRecord_prRunId_fkey"
    FOREIGN KEY ("prRunId") REFERENCES "PullRequestRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsageRecord" ADD CONSTRAINT "LlmUsageRecord_testGenerationRunId_fkey"
    FOREIGN KEY ("testGenerationRunId") REFERENCES "TestGenerationRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
