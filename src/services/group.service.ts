import { AppError } from "../errors/AppError.js";
import prisma from "../prisma.js";

export async function createGroup({
  userId,
  membersId,
  name,
}: {
  userId: number;
  membersId: any;
  name: string;
}) {
  // creates a new group with the current user as the admin
  const group = await prisma.conversation.create({
    data: {
      createdById: userId,
      name,
members: {
          create: [
            { userId },
            ...membersId.map((id: number) => ({ userId: id })),
          ],
        },
    },
  });
  return group;
}

export async function addMembers({
  userIds,
  conversationId,
}: {
  userIds: number[];
  conversationId: number;
}) {
  // filter out users that don't exist
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true },
  });

  const validUserIds = users.map((u) => u.id);

  // adds all the valid users to the conversation
  const { count } = await prisma.conversationMember.createMany({
    data: validUserIds.map((uid) => ({
      conversationId,
      userId: uid,
    })),
    skipDuplicates: true,
  });
  return count;
}

export async function removeGroupMember({
  conversationId,
  userId,
}: {
  conversationId: number;
  userId: number;
}) {
  // removes the user
  await prisma.conversationMember.delete({
    where: {
      conversationId_userId: { conversationId, userId },
    },
  });
}

export async function changeGroupName({
  conversationId,
  userId,
  trimmedName,
}: {
  conversationId: number;
  userId: number;
  trimmedName: string;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId },
    include: {
      members: {
        select: { userId: true },
      },
    },
  });

  if (!conversation) {
    throw new AppError("Conversation not found", 404);
  }

  const isMember = conversation.members.some(
    (member) => member.userId === userId,
  );

  if (!isMember) {
    throw new AppError("You are not a member of this conversation", 403);
  }

  const isAdmin = conversation.createdById === userId;
  const is1to1 = conversation.members.length === 2;

  if (!isAdmin && !is1to1) {
    throw new AppError("You are not the admin of the group", 403);
  }

  const updatedConversation = await prisma.conversation.update({
    where: { id: conversationId },
    data: { name: trimmedName },
  });

  return updatedConversation;
}

export async function leaveGroup({
  conversationId,
  userId,
}: {
  conversationId: number;
  userId: number;
}) {
  // remove user from the group
  await prisma.conversationMember.delete({
    where: {
      conversationId_userId: { conversationId, userId },
    },
  });
}

export async function deleteGroup({
  conversationId,
}: {
  conversationId: number;
}) {
  /*  flow (removes all the data of the group)
      get all the msg id of that group 
      delete all the reactions of mesage that is done in that group
      delete all the read messages of that group
      delete all the messages of the group
      delete all the members of the group
      delete the group
    */
  await prisma.$transaction(async (tx) => {
    // gets all the mesage ids form that group
    const groupMsgs = await tx.message.findMany({
      where: { conversationId: conversationId },
      select: { id: true },
    });
    // deletes all the message reaction done in the group
    const messageIds = groupMsgs.map((msg) => msg.id);
    await tx.messageReaction.deleteMany({
      where: {
        messageId: {
          in: messageIds,
        },
      },
    });
    // deletes all the message read data of that group
    await tx.messageRead.deleteMany({
      where: { conversationId: conversationId },
    });

    // deletes all the messages of that group
    await tx.message.deleteMany({
      where: { conversationId: conversationId },
    });

    // deletes all the conversation members ( group members ) of that group
    await tx.conversationMember.deleteMany({
      where: {
        conversationId: conversationId,
      },
    });
    // deletes the group
    await tx.conversation.delete({
      where: { id: conversationId },
    });
  });
}


