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
  epoch,
  nonce,
  encryptedKey,
}: {
  conversationId: number;
  userId: number;
  requesterId: number;
  epoch: number;
  nonce: string;
  encryptedKey: string;
}) {
  const [conversation, requester, target] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        currentKeyEpoch: true,
        keyClaimedById: true,
      },
    }),

    prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId: requesterId,
        },
      },
    }),

    prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
    }),
  ]);

  if (!conversation) {
    throw new AppError("Conversation not found", 404);
  }

  if (!requester) {
    throw new AppError("You are not a conversation member", 403);
  }

  if (!target) {
    throw new AppError("Target user is not a conversation member", 404);
  }

  if (epoch !== conversation.currentKeyEpoch) {
    throw new AppError("Invalid key epoch", 400);
  }

  if (conversation.keyClaimedById !== requesterId) {
    throw new AppError("You have not claimed this key epoch", 403);
  }

  await prisma.conversationKeyPackage.create({
    data: {
      conversationId,
      userId,
      epoch,
      encryptedKey,
      nonce,
      senderUserId: requesterId,
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
  // gets the user's current key epoch
  const conversation = await prisma.conversation.findUnique({
    where: {
      id: conversationId,
    },
  });

  if (!conversation) return null;

  const keyPackage = await prisma.conversationKeyPackage.findFirst({
    where: {
      conversationId,
      userId,
      epoch: conversation.currentKeyEpoch,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!keyPackage) throw new AppError("No Package Exists", 404);

  return {
    encryptedConversationKey: keyPackage.encryptedKey,
    nonce: keyPackage.nonce,
    epoch: keyPackage.epoch,
    createdById: conversation.createdById,
    keyCreatedById: conversation.keyCreatedById,
    senderUserId: keyPackage.senderUserId,
  };
}

export async function getHistoricalKeyPackages({
  conversationId,
  userId,
}: {
  conversationId: number;
  userId: number;
}) {
  const [conversation, member] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { currentKeyEpoch: true },
    }),
    prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      select: { id: true },
    }),
  ]);

  if (!conversation) {
    throw new AppError("Conversation not found", 404);
  }

  if (!member) {
    throw new AppError("You are not a conversation member", 403);
  }

  const [packages, receipts] = await Promise.all([
    prisma.conversationKeyPackage.findMany({
      where: {
        conversationId,
        userId,
        epoch: { lt: conversation.currentKeyEpoch },
      },
      select: {
        id: true,
        epoch: true,
        encryptedKey: true,
        nonce: true,
        senderUserId: true,
      },
      orderBy: [{ epoch: "asc" }, { id: "asc" }],
    }),
    prisma.conversationKeyReceipt.findMany({
      where: { conversationId, userId },
      select: { epoch: true },
      orderBy: { epoch: "asc" },
    }),
  ]);

  return {
    currentKeyEpoch: conversation.currentKeyEpoch,
    acknowledgedEpochs: receipts.map((receipt) => receipt.epoch),
    packages,
  };
}

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
        currentKeyEpoch: true,
        keyClaimedById: true,
      },
    });

    if (!conversation) {
      throw new AppError("Conversation not found", 404);
    }

    // This user has already claimed this epoch.
    // Allow them to continue if they are retrying.
    if (conversation.keyClaimedById === userId) {
      return {
        claimed: true,
        epoch: conversation.currentKeyEpoch,
        keyCreatedById: userId,
      };
    }

    // Atomically claim the epoch only if nobody has claimed it.
    const claim = await tx.conversation.updateMany({
      where: {
        id: conversationId,
        currentKeyEpoch: conversation.currentKeyEpoch,
        keyClaimedById: null,
      },
      data: {
        keyClaimedById: userId,
      },
    });

    if (claim.count === 1) {
      return {
        claimed: true,
        epoch: conversation.currentKeyEpoch,
        keyCreatedById: userId,
      };
    }

    return {
      claimed: false,
      message: "Another user has already claimed this key epoch",
    };
  });
}
