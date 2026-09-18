-- Additive migration: track which member generated/sealed the conversation key
-- so every device can open its per-member key copy with the right public key.
-- Legacy conversations keep keyCreatedById NULL and fall back to createdById.

ALTER TABLE "Conversation" ADD COLUMN "keyCreatedById" INTEGER;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_keyCreatedById_fkey"
  FOREIGN KEY ("keyCreatedById") REFERENCES "User"(id)
  ON UPDATE CASCADE ON DELETE SET NULL;