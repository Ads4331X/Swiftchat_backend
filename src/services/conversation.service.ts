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
            select: { id: true, username: true, avatar: true, lastSeen: true },
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
  const cleaned = [];

  for (const conv of sorted) {
    const myMembership = conv.members.find((m) => m.userId === userId);

    const clearedAt = myMembership?.clearedAt;
    const lastMessage = conv.messages[0] ?? null;

    const latestReadAt = await prisma.messageRead.findFirst({
      where: {
        userId,
        conversationId: conv.id,
      },
      select: {
        conversationId: true,
        readAt: true,
      },
      orderBy: {
        readAt: "desc",
      },
    });

    const unread = await prisma.message.count({
      where: {
        conversationId: conv.id,
        senderId: { not: userId },
        sentAt: {
          gt: latestReadAt?.readAt ?? new Date(0),
        },
      },
    });

    cleaned.push({
      id: conv.id,
      name: conv.name,
      createdById: conv.createdById,
      members: conv.members
        .map((member) => member.user)
        .filter((member) => member != null && member.id !== userId),
      lastMessage:
        lastMessage &&
        clearedAt &&
        new Date(lastMessage.sentAt) <= new Date(clearedAt)
          ? null
          : lastMessage,
      unread,
    });
  }
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
  requesterId,
  nonce,
  encryptedKey,
}: {
  conversationId: number;
  userId: number;
  requesterId: number;
  nonce: string;
  encryptedKey: string;
}) {
  /*
   * Only the member who generated the conversation key may seal members'
   * copies. All copies are encrypted with that member's private key, so a
   * copy sealed by anyone else could never be opened by its recipient.
   * Legacy conversations (keyCreatedById = NULL) keep the old behavior.
   */
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { keyCreatedById: true },
  });

  if (
    conversation?.keyCreatedById != null &&
    conversation.keyCreatedById !== requesterId
  ) {
    throw new AppError(
      "Only the key creator can distribute the conversation key",
      403,
    );
  }

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
  const member = await prisma.conversationMember.findUnique({
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
          keyCreatedById: true,
        },
      },
    },
  });

  if (!member) return null;

  const { conversation, encryptedConversationKey, nonce } = member;

  // FLAT shape, matching what the client expects. `keyCreatedById` records who
  // actually generated/sealed the conversation key (NOT always the creator),
  // so recipients can open their copy with the correct public key.
  // Legacy conversations (keyCreatedById = NULL) fall back to the creator.
  return {
    encryptedConversationKey,
    nonce,
    createdById: conversation.createdById,
    keyCreatedById: conversation.keyCreatedById,
    senderUserId: conversation.keyCreatedById ?? conversation.createdById,
  };
}

/**
 * Claims the right to generate the conversation key for a conversation.
 *
 * The first member to call this becomes the "key creator" and is the only one
 * allowed to seal per-member copies. A transactional conditional-update makes
 * concurrent claims race-safe (only one wins). Refuses to claim once any
 * member already holds an encrypted key copy (legacy conversation).
 */
export async function claimConversationKey({
  conversationId,
  userId,
}: {
  conversationId: number;
  userId: number;
}) {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: {
        keyCreatedById: true,
        members: {
          select: { encryptedConversationKey: true },
        },
      },
    });

    if (!conversation) {
      throw new AppError("Conversation not found", 404);
    }

    if (conversation.keyCreatedById != null) {
      return { claimed: false, keyCreatedById: conversation.keyCreatedById };
    }

    const alreadyHasKey = conversation.members.some(
      (m) => m.encryptedConversationKey != null,
    );
    if (alreadyHasKey) {
      return { claimed: false, keyCreatedById: null, alreadyHasKey: true };
    }

    const updated = await tx.conversation.updateMany({
      where: { id: conversationId, keyCreatedById: null },
      data: { keyCreatedById: userId },
    });

    if (updated.count === 0) {
      // Lost a concurrent claim — another device generated the key first.
      const winner = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: { keyCreatedById: true },
      });
      return { claimed: false, keyCreatedById: winner?.keyCreatedById ?? null };
    }

    return { claimed: true, keyCreatedById: userId };
  });
}
