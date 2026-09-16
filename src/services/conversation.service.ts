import { AppError } from "../errors/AppError.js";
import prisma from "../prisma.js";

export async function getConversations({ userId }: { userId: number }) {
  const conversations = await prisma.conversation.findMany({
    where: {
      members: {
        some: { userId: userId },
      },
    },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, username: true, avatar: true },
          },
        },
      },
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: {
          id: true,
          text: true,
          sentAt: true,
          senderId: true,
          nonce: true,
        },
      },
    },
  });

  // sort the conversations by the latest message time (or creation time)
  const sorted = conversations.sort((a, b) => {
    const aTime = a.messages[0]?.sentAt ?? a.createdAt;
    const bTime = b.messages[0]?.sentAt ?? b.createdAt;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  // clean the response by removing the current user from members
  const cleaned = sorted.map((conv) => {
    const myMembership = conv.members.find((m) => m.userId === userId);
    const clearedAt = myMembership?.clearedAt;
    const lastMessage = conv.messages[0] ?? null;

    return {
      id: conv.id,
      name: conv.name,
      createdById: conv.createdById,
      members: conv.members.map((m) => m.user).filter((u) => u.id !== userId),
      lastMessage:
        lastMessage &&
        clearedAt &&
        new Date(lastMessage.sentAt) <= new Date(clearedAt)
          ? null
          : lastMessage,
    };
  });

  return cleaned;
}

export async function createConversation({
  targetUsername,
  userId,
}: {
  targetUsername: string;
  userId: number;
}) {
  // find the target user
  const targetedUser = await prisma.user.findUnique({
    where: { username: targetUsername },
    select: { id: true, username: true, avatar: true },
  });

  // check if the target user exists or not
  if (!targetedUser) throw new AppError("Searched User not found", 400);

  // check if the target user is the current user or not
  if (targetedUser.id === userId)
    throw new AppError("You can't create a group with yourself", 400);

  // Check for an exact 1:1 conversation only. Group chats must never be
  // treated as a direct conversation just because both people belong to them.
  const matchingConversations = await prisma.conversation.findMany({
    where: {
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: targetedUser.id } } },
      ],
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      },
    },
  });

  const existingConversation = matchingConversations.find((conversation) => {
    const uniqueMemberIds = new Set(
      conversation.members.map((member) => member.userId),
    );

    return (
      uniqueMemberIds.size === 2 &&
      uniqueMemberIds.has(userId) &&
      uniqueMemberIds.has(targetedUser.id)
    );
  });

  if (existingConversation)
    return {
      existing: true,
      conversation: existingConversation,
    };

  // Create a direct conversation and return its members so the client can
  // route to the correct 1:1 chat instead of a group chat.
  const newConversation = await prisma.conversation.create({
    data: {
      createdById: userId,
      members: {
        create: [{ userId: userId }, { userId: targetedUser.id }],
      },
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      },
    },
  });

  return { existing: false, conversation: newConversation };
}

export async function getEncryptedMemberKey({
  conversationId,
  userId,
  nonce,
  encryptedKey,
}: {
  conversationId: number;
  userId: number;
  nonce: string;
  encryptedKey: string;
}) {
  // stores the encrypted conversation key for the target user
  await prisma.conversationMember.update({
    where: {
      conversationId_userId: { conversationId, userId },
    },
    data: {
      encryptedConversationKey: encryptedKey,
      nonce: nonce,
    },
  });
}

export async function getEncryptedKey({
  conversationId,
  userId,
}: {
  conversationId: number;
  userId: number;
}) {
  return prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
    select: {
      encryptedConversationKey: true,
      nonce: true,
      conversation: {
        select: {
          createdById: true,
        },
      },
    },
  });
}
