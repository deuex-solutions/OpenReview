-- DropForeignKey
ALTER TABLE "Repository" DROP CONSTRAINT "Repository_workspaceId_fkey";

-- DropIndex
DROP INDEX "Repository_workspaceId_githubRepo_key";

-- AlterTable
ALTER TABLE "Repository" DROP COLUMN "workspaceId";

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubRepo_key" ON "Repository"("githubRepo");

-- DropTable
DROP TABLE "Workspace";
