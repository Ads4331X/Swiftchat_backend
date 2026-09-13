import prisma from "../prisma.js";
import type { Response } from "express";
import type { Server } from "socket.io";

export function parseId(value: string): number {
  return parseInt(value, 10);
}

export function normalizeNonce(nonce: string | Buffer): string {
  return typeof nonce === "string" ? nonce : nonce.toString("base64");
}

export async function findMember(conversationId: number, userId: number) {
  return prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
}

export async function findMessage(messageId: number) {
  return await prisma.message.findUnique({
    where: { id: messageId },
  });
}

export function validateMessageId(messageId: number, res: Response): boolean {
  if (!Number.isInteger(messageId)) {
    res.status(400).json({ error: "Invalid message ID" });
    return true;
  }

  return false;
}

export function validateEmoji(emoji: string, res: Response): boolean {
  if (!emoji) {
    res.status(400).json({ error: "Emoji is required" });
    return true;
  }

  return false;
}

export function emitToConversation(
  io: Server,
  conversationId: number,
  event: string,
  data: unknown,
): void {
  io.to(String(conversationId)).emit(event, data);
}

export function handleError(res: Response): Response {
  return res.status(500).json({ error: "Internal server error" });
}

// find a user by id
export async function findUser(userId: number) {
  return await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, avatar: true },
  });
}

// check if user is the admin (creator) of the conversation
export async function checkAdmin(conversationId: number, userId: number) {
  return await prisma.conversation.findFirst({
    where: { id: conversationId, createdById: userId },
  });
}

// ensure user is a member, return null with 403 if not
export async function ensureMember(
  conversationId: number,
  userId: number,
  res: Response,
) {
  const member = await findMember(conversationId, userId);
  if (!member) {
    res
      .status(403)
      .json({ error: "You are not a member of this conversation" });
    return null;
  }
  return member;
}

// find a message and check ownership, return null with error if any check fails
export async function findAndValidateMessage(
  messageId: number,
  userId: number,
  res: Response,
) {
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

// validate user, membership, message and admin for the pin endpoints
export async function findForPin(
  conversationId: number,
  messageId: number,
  userId: number,
  res: Response,
) {
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(404).json({ error: "User not found" });
    return null;
  }

  const member = await findMember(conversationId, userId);

  if (!member) {
    res
      .status(404)
      .json({ error: "User is not a member of this conversation" });
    return null;
  }

  const message = await findMessage(messageId);

  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return null;
  }

  // groups with more than 2 members can only be managed by the admin
  const conversationMembers = await prisma.conversationMember.findMany({
    where: { conversationId },
  });

  if (
    conversationMembers.length > 2 &&
    !(await checkAdmin(conversationId, userId))
  ) {
    res.status(403).json({ error: "You are not the admin of the group" });
    return null;
  }

  return { message, conversationId };
}

// handle reaction upsert (used by both add and update)
export async function handleReaction(
  messageId: number,
  userId: number,
  emoji: string,
  res: Response,
) {
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
