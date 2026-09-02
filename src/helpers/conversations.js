import prisma from "../prisma.js";

export function parseId(value) {
  return parseInt(value);
}

export function normalizeNonce(nonce) {
  return typeof nonce === "string" ? nonce : Buffer.from(nonce).toString("base64");
}

export async function checkMembership(conversationId, userId) {
  return await prisma.conversationMember.findFirst({
    where: { conversationId, userId },
  });
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

export function emitToConversation(io, conversationId, event, data) {
  io.to(String(conversationId)).emit(event, data);
}

export function handleError(res) {
  return res.status(500).json({ error: "Internal server error" });
}
