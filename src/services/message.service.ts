import { AppError } from "../errors/AppError.js";
import { isUserBlocked } from "../helpers/helper.js";
import prisma from "../prisma.js";
import { SendMessage } from "../types/message.type.js";

export async function getMessages({
  clearedAt,
  limit,
  before,
  conversationId,
  userId,
}: {
  clearedAt: Date | null;
  limit: number;
  before: number | undefined;
  conversationId: number;
  userId: number;
}) {
  const where: any = { conversationId };

  if (clearedAt) {
    where.sentAt = { gt: clearedAt };
  }
  if (before) {
    const cursorMessage = await prisma.message.findFirst({
      where: { id: Number(before) },
      select: { sentAt: true },
    });

    if (cursorMessage) {
      where.sentAt = { lt: cursorMessage.sentAt };
      if (clearedAt) {
        where.sentAt = { gt: clearedAt, lt: cursorMessage.sentAt };
      }
    }
  }

  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });

  // Match the socket layer (canEmitToConversation): in a 1:1, hide messages
  // from a sender the requesting user has blocked. Without this, a refetch or
  // reopen would surface messages that the live feed already suppressed.
  if (members.length === 2) {
    const otherId = members.find((member) => member.userId !== userId)?.userId;

    if (
      otherId != null &&
      (await isUserBlocked({ blockerId: userId, blockedId: otherId }))
    ) {
      where.senderId = { not: otherId };
    }
  }

  const messages = await prisma.message.findMany({
    where,
    orderBy: { sentAt: "desc" },
    take: Number(limit),
    include: {
      user: { select: { id: true, username: true, avatar: true } },
      reactions: {
        select: {
          emoji: true,
          user: { select: { id: true } },
        },
      },
    },
  });

  const replyToIds = messages
    .map((m) => m.replyToId)
    .filter((id) => id !== null);

  const repliedMessages = await prisma.message.findMany({
    where: {
      id: {
        in: replyToIds,
      },
    },
  });

  const replyMap = new Map(repliedMessages.map((msg) => [msg.id, msg]));

  const resolvedReplies = messages.map((m) => ({
    ...m,
    replyTo: m.replyToId ? (replyMap.get(m.replyToId) ?? null) : null,
  }));

  // Reverse the resolved array instead of the raw messages
  resolvedReplies.reverse();

  return resolvedReplies;
}

export async function sendMessages({
  conversationId: conversationId,
  senderId: senderId,
  text: messageText,
  nonce: normalizedNonce,
  replyToId: replyToId,
  forwardedFromMsgId: forwardedFromMsgId,
}: SendMessage) {
  // creates a new message in the conversation
  const message = await prisma.message.create({
    data: {
      conversationId: conversationId,
      senderId: senderId,
      text: messageText,
      nonce: normalizedNonce,
      replyToId: replyToId,
      forwardedFromMsgId: forwardedFromMsgId,
    },
    include: {
      user: { select: { id: true, username: true, avatar: true } },
      reactions: {
        select: {
          emoji: true,
          user: { select: { id: true } },
        },
      },
      replyTo: {
        include: {
          user: { select: { id: true, username: true } },
        },
      },
    },
  });

  return message;
}

export async function editMessage({
  messageId,
  text,
  nonce: normalizedNonce,
}: {
  messageId: number;
  text: string;
  nonce: string;
}) {
  // updates the message
  const updatedMessage = await prisma.message.update({
    where: { id: messageId },
    data: { text: text, nonce: normalizedNonce },
  });
  return updatedMessage;
}

export async function deleteMessage({ messageId }: { messageId: number }) {
  // deletes the message
  const deletedMessage = await prisma.message.delete({
    where: { id: messageId },
  });
  return deletedMessage;
}

export async function getMessageReadStatus({
  conversationId,
  messageId,
}: {
  conversationId: number;
  messageId: number;
}) {
  const messageReadUsers = await prisma.messageRead.findMany({
    where: {
      conversationId,
      messageId,
    },
    select: {
      userId: true,
    },
  });

  const userIds = messageReadUsers.map((read) => read.userId);

  const messageReadUsersDetails = await prisma.user.findMany({
    where: {
      id: {
        in: userIds,
      },
    },
  });
  return messageReadUsersDetails;
}

export async function markMessagesAsRead({
  conversationId,
  userId,
  messageId,
}: {
  conversationId: number;
  userId: number;
  messageId: number;
}) {
  // check if message exists in this conversation
  const message = await prisma.message.findFirst({
    where: { id: messageId, conversationId },
    select: { id: true, senderId: true, conversationId: true },
  });

  if (!message) throw new AppError("Message not found", 404);

  // check if the user is trying to mark their own message as read or not
  if (message.senderId === userId)
    throw new AppError("You cannot mark your own message as read", 400);

  const readAt = new Date();

  // get all messages up to the given message that are not from the user
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      id: { lte: messageId },
      senderId: { not: userId },
    },
    select: { id: true },
  });

  // marks all the messages as read
  await prisma.messageRead.createMany({
    data: messages.map((message) => ({
      messageId: message.id,
      userId,
      conversationId,
      readAt,
    })),
    skipDuplicates: true,
  });

  return readAt;
}

export async function addReaction({
  messageId,
  userId,
  emoji,
}: {
  messageId: number;
  userId: number;
  emoji: string;
}) {
  const reaction = await prisma.messageReaction.upsert({
    where: {
      messageId_userId: {
        messageId: messageId,
        userId,
      },
    },
    update: { emoji },
    create: {
      userId,
      messageId: messageId,
      emoji,
    },
  });

  return { reaction };
}

export async function deleteReaction({
  messageId,
  userId,
}: {
  userId: number;
  messageId: number;
}) {
  // deletes the reaction for the message
  const deletedReaction = await prisma.messageReaction.delete({
    where: {
      messageId_userId: { messageId, userId },
    },
  });
  return deletedReaction;
}

export async function getPinnedMessages({
  conversationId,
}: {
  conversationId: number;
}) {
  const pinnedMsgs = await prisma.pinnedMessage.findMany({
    where: {
      conversationId: conversationId,
    },
  });
  return pinnedMsgs;
}

export async function pinMessage({
  conversationId,
  messageId,
  userId,
}: {
  conversationId: number;
  messageId: number;
  userId: number;
}) {
  const isMsgPinned = await prisma.pinnedMessage.findUnique({
    where: {
      conversationId_messageId: {
        conversationId: conversationId,
        messageId: messageId,
      },
    },
  });

  if (isMsgPinned) throw new AppError("Message is already pinned", 409);
  const pinMsg = await prisma.pinnedMessage.create({
    data: {
      messageId: messageId,
      conversationId: conversationId,
      pinnedById: userId,
      pinnedAt: new Date(),
    },
  });
  return pinMsg;
}

export async function deletePin({
  conversationId,
  messageId,
}: {
  conversationId: number;
  messageId: number;
}) {
  const isMsgPinned = await prisma.pinnedMessage.findUnique({
    where: {
      conversationId_messageId: {
        conversationId: conversationId,
        messageId: messageId,
      },
    },
  });

  if (!isMsgPinned) throw new AppError("Pinned Message not found", 404);
  const pinMsg = await prisma.pinnedMessage.delete({
    where: {
      conversationId_messageId: {
        conversationId: conversationId,
        messageId: messageId,
      },
    },
  });
  return pinMsg;
}

export async function clearChat({
  conversationId,
  userId,
}: {
  conversationId: number;
  userId: number;
}) {
  const clearedAt = new Date();

  await prisma.conversationMember.upsert({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
    create: {
      conversationId,
      userId,
      clearedAt,
    },
    update: {
      clearedAt,
    },
  });
  return clearedAt;
}
