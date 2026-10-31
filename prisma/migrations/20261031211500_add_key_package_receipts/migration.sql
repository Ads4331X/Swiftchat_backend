ALTER TABLE "ConversationKeyPackage"
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "ConversationKeyPackage_conversationId_userId_epoch_key";
CREATE UNIQUE INDEX "ConversationKeyPackage_conversationId_userId_epoch_senderUs_key"
  ON "ConversationKeyPackage"("conversationId", "userId", "epoch", "senderUserId");

DROP INDEX "ConversationKeyPackage_userId_idx";
CREATE INDEX "ConversationKeyPackage_userId_conversationId_epoch_idx"
  ON "ConversationKeyPackage"("userId", "conversationId", "epoch");

CREATE TABLE "ConversationKeyReceipt" (
  "id" SERIAL NOT NULL,
  "conversationId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "epoch" INTEGER NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConversationKeyReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationKeyReceipt_conversationId_userId_epoch_key"
  ON "ConversationKeyReceipt"("conversationId", "userId", "epoch");
CREATE INDEX "ConversationKeyReceipt_userId_conversationId_epoch_idx"
  ON "ConversationKeyReceipt"("userId", "conversationId", "epoch");

ALTER TABLE "ConversationKeyReceipt"
  ADD CONSTRAINT "ConversationKeyReceipt_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationKeyReceipt"
  ADD CONSTRAINT "ConversationKeyReceipt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
