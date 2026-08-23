-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "awaitingReplyNodeId" TEXT;

-- CreateIndex
CREATE INDEX "Execution_conversationId_awaitingReplyNodeId_idx" ON "Execution"("conversationId", "awaitingReplyNodeId");
