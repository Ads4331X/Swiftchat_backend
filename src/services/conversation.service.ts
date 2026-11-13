import { AppError } from "../errors/AppError.js";
import {
  getAllEpochsForConversation,
  getCurrentEpochForConversation,
  validateHistoricalEpochs,
} from "../helpers/helper.js";
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
        rejectedAt: null,
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

export async function getKeyGaps({
  conversationId,
}: {
  conversationId: number;
}) {
  const currentKeyEpoch = await getCurrentEpochForConversation(conversationId);

  if (!currentKeyEpoch) {
    throw new AppError("Conversation not found", 404);
  }

  // members of the group
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });

  const allKnownEpochs = await getAllEpochsForConversation(
    conversationId,
    currentKeyEpoch,
  );

  const recipients = [];

  for (const member of members) {
    // gets acknowledged epochs for that user
    const epochKeyReceipts = await prisma.conversationKeyReceipt.findMany({
      where: { conversationId, userId: member.userId },
      select: { epoch: true },
    });

    const epochKeyReceiptsSet = new Set(
      epochKeyReceipts.map((data) => data.epoch),
    );

    // missing epochs of the user
    const missingEpochs = allKnownEpochs.filter(
      (epoch) => !epochKeyReceiptsSet.has(epoch),
    );

    recipients.push({
      userId: member.userId,
      missingEpochs,
    });
  }

  return {
    currentKeyEpoch: currentKeyEpoch,
    recipients,
  };
}

export async function uploadHistoricalKeys({
  conversationId,
  senderId,
  historicalKeys,
  userId,
}: {
  conversationId: number;
  senderId: number;
  historicalKeys: { epoch: number; encryptedKey: string; nonce: string }[];
  userId: number;
}) {
  const epochs = historicalKeys.map((key) => key.epoch);

  await validateHistoricalEpochs(epochs, conversationId);

  const results = [];

  for (const { epoch, encryptedKey, nonce } of historicalKeys) {
    // Skip if already acknowledged
    const receipt = await prisma.conversationKeyReceipt.findUnique({
      where: {
        conversationId_userId_epoch: { conversationId, userId, epoch },
      },
    });

    if (receipt) {
      results.push({ epoch, status: "alreadySatisfied" });
      continue;
    }

    const existingPackage = await prisma.conversationKeyPackage.findUnique({
      where: {
        conversationId_userId_epoch_senderUserId: {
          conversationId,
          userId,
          epoch,
          senderUserId: senderId,
        },
      },
    });

    if (existingPackage && !existingPackage.rejectedAt) {
      if (
        existingPackage.encryptedKey !== encryptedKey ||
        existingPackage.nonce !== nonce
      ) {
        throw new AppError(`Different package exists for epoch ${epoch}`, 409);
      }

      results.push({ epoch, status: "duplicate" });
      continue;
    }

    if (existingPackage) {
      await prisma.conversationKeyPackage.update({
        where: { id: existingPackage.id },
        data: { encryptedKey, nonce, rejectedAt: null },
      });
    } else {
      await prisma.conversationKeyPackage.create({
        data: {
          conversationId,
          userId,
          epoch,
          encryptedKey,
          nonce,
          senderUserId: senderId,
        },
      });
    }

    results.push({ epoch, status: "stored" });
  }

  return {
    message: "Historical key packages processed",
    results,
  };
}

export async function acknowledgeHistoricalKey({
  conversationId,
  userId,
  epochs,
}: {
  conversationId: number;
  userId: number;
  epochs: number[];
}) {
  const result = await validateHistoricalEpochs(epochs, conversationId);

  const packages = await prisma.conversationKeyPackage.findMany({
    where: {
      conversationId,
      userId,
      epoch: { in: result },
      rejectedAt: null,
    },
    select: { epoch: true },
  });

  const availableEpochs = new Set(packages.map((keyPackage) => keyPackage.epoch));
  const missingEpochs = result.filter(
    (epoch) => !availableEpochs.has(epoch),
  );

  if (missingEpochs.length > 0) {
    throw new AppError(
      `No valid historical key package for epoch: ${missingEpochs.join(", ")}`,
      400,
    );
  }

  const keyReceipt = await prisma.conversationKeyReceipt.createMany({
    data: result.map((epoch) => ({ conversationId, userId, epoch })),
    skipDuplicates: true,
  });

  return {
    message: "Historical keys acknowledged successfully",
    totalEpoch: epochs.length,
    acknowledgedEpochs: keyReceipt.count,
  };
}

export async function rejectHistoricalKeyPackage({
  conversationId,
  packageId,
  userId,
}: {
  conversationId: number;
  packageId: number;
  userId: number;
}) {
  const keyPackage = await prisma.conversationKeyPackage.findFirst({
    where: {
      id: packageId,
      conversationId,
      userId,
    },
  });

  if (!keyPackage) {
    throw new AppError("Key package not found", 404);
  }

  if (keyPackage.rejectedAt) {
    throw new AppError("Key package already rejected", 409);
  }

  await prisma.conversationKeyPackage.update({
    where: { id: packageId },
    data: { rejectedAt: new Date() },
  });

  return {
    message: "Historical key package rejected successfully",
    packageId,
  };
}
