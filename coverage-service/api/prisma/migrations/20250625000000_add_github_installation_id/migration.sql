-- AlterTable: add optional githubInstallationId to Repository
ALTER TABLE "Repository" ADD COLUMN "githubInstallationId" TEXT;

-- CreateIndex: allows looking up a repo by its GitHub App installation
CREATE INDEX "Repository_githubInstallationId_idx" ON "Repository"("githubInstallationId");
