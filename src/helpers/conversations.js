import prisma from "../prisma.js";

export function parseId(value) {
  return parseInt(value);
}

export function normalizeNonce(nonce) {
  return typeof nonce === "string" ? nonce : Buffer.from(nonce).toString("base64");
}

export async function findMember(conversationId, userId) {
  return await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
}

export async function findMessage(messageId) {
  return await prisma.message.findUnique({
    where: { id: messageId },
  });
}

export function validateMessageId(messageId, res) {
  if (!Number.isInteger(messageId)) {
    res.status(400).json({ error: "Invalid message ID" });
    return true;
  }
  return false;
}

export function validateEmoji(emoji, res) {
  if (!emoji || typeof emoji !== "string") {
    res.status(400).json({ error: "Emoji is required" });
    return true;
  }
  return false;
}

export function emitToConversation(io, conversationId, event, data) {
  io.to(String(conversationId)).emit(event, data);
}

export function handleError(res) {
  return res.status(500).json({ error: "Internal server error" });
}

// find a user by id
export async function findUser(userId) {
  return await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, avatar: true },
  });
}

// check if user is the admin (creator) of the conversation
export async function checkAdmin(conversationId, userId) {
  return await prisma.conversation.findFirst({
    where: { id: conversationId, createdById: userId },
  });
}

// ensure user is a member, return null with 403 if not
export async function ensureMember(conversationId, userId, res) {
  const member = await findMember(conversationId, userId);
  if (!member) {
    res.status(403).json({ error: "You are not a member of this conversation" });
    return null;
  }
  return member;
}

// find a message and check ownership, return null with error if any check fails
export async function findAndValidateMessage(messageId, userId, res) {
  const message = await findMessage(messageId);

  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return null;
  }

  if (message.senderId !== userId) {
    res.status(403).json({ error: "You can only modify your own messages" });
    return null;
  }

  return message;
}

// handle reaction upsert (used by both add and update)
export async function handleReaction(messageId, userId, emoji, res) {
  const message = await findMessage(messageId);

  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return null;
  }

  const reaction = await prisma.messageReaction.upsert({
    where: {
      messageId_userId: { messageId: message.id, userId },
    },
    update: { emoji },
    create: { userId, messageId: message.id, emoji },
  });

  return { reaction, message };
}
