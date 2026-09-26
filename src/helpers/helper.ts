import prisma from "../prisma.js";
import type { Server } from "socket.io";
import { AppError } from "../errors/AppError.js";

export function parseId(value: string): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError("Invalid ID", 400);
  }

  return id;
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

export function validateMessageId(messageId: number): void {
  if (!Number.isInteger(messageId)) {
    throw new AppError("Invalid message ID", 400);
  }
}

export function validateEmoji(emoji: string): void {
  if (!emoji) {
    throw new AppError("Emoji is required", 400);
  }
}

export function emitToConversation(
  io: Server,
  conversationId: number,
  event: string,
  data: unknown,
): void {
  io.to(String(conversationId)).emit(event, data);
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

// ensure user is a member
export async function ensureMember(conversationId: number, userId: number) {
  const member = await findMember(conversationId, userId);
  if (!member) {
    throw new AppError("You are not a member of this conversation", 403);
  }
  return member;
}

// find a message and check ownership
export async function findAndValidateMessage(
  messageId: number,
  userId: number,
) {
  const message = await findMessage(messageId);

  if (!message) {
    throw new AppError("Message not found", 404);
  }

  if (message.senderId !== userId) {
    throw new AppError("You can only modify your own messages", 403);
  }

  return message;
}

// validate user, membership and message for reading pin status (GET)
export async function findForPinRead(
  conversationId: number,
  messageId: number,
  userId: number,
) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError("User not found", 404);
  }

  const member = await findMember(conversationId, userId);

  if (!member) {
    throw new AppError("User is not a member of this conversation", 404);
  }

  const message = await findMessage(messageId);

  if (!message) {
    throw new AppError("Message not found", 404);
  }

  return { message, conversationId };
}

// validate user, membership, message and admin for the pin endpoints
export async function findForPin(
  conversationId: number,
  messageId: number,
  userId: number,
) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError("User not found", 404);
  }

  const member = await findMember(conversationId, userId);

  if (!member) {
    throw new AppError("User is not a member of this conversation", 404);
  }

  const message = await findMessage(messageId);

  if (!message) {
    throw new AppError("Message not found", 404);
  }

  // groups with more than 2 members can only be managed by the admin
  const conversationMembers = await prisma.conversationMember.findMany({
    where: { conversationId },
  });

  if (
    conversationMembers.length > 2 &&
    !(await checkAdmin(conversationId, userId))
  ) {
    throw new AppError("You are not the admin of the group", 403);
  }

  return { message, conversationId };
}

export async function isUserBlocked({
  blockerId,
  blockedId,
}: {
  blockerId: number;
  blockedId: number;
}) {
  const block = await prisma.userBlock.findUnique({
    where: {
      blockerId_blockedId: {
        blockerId,
        blockedId,
      },
    },
    select: {
      id: true,
    },
  });

  return !!block;
}

export async function canEmitToConversation({
  conversationId,
  senderId,
}: {
  conversationId: number;
  senderId: number;
}) {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });

  // Group
  if (members.length > 2) {
    return true;
  }

  // 1-to-1
  const receiver = members.find((member) => member.userId !== senderId);

  if (!receiver) {
    return false;
  }

  const isBlocked = await isUserBlocked({
    blockerId: receiver.userId,
    blockedId: senderId,
  });

  return !isBlocked;
}
export async function findAttachment(messageId: number) {
  const attachment = await prisma.attachment.findUnique({
    where: { messageId },
  });
  return attachment;
}
