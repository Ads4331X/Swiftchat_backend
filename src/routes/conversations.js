import * as express from "express";
import auth from "../middleware/auth.js";
import prisma from "../prisma.js";
import {
  parseId,
  normalizeNonce,
  findMember,
  findMessage,
  validateMessageId,
  validateEmoji,
  emitToConversation,
  handleError,
  findUser,
  checkAdmin,
  ensureMember,
  findAndValidateMessage,
  handleReaction,
} from "../helpers/conversations.js";

const router = express.Router();

router.get("/", auth, async (req, res) => {
  try {
    // gets all the conversations the user is a member of
    const conversations = await prisma.conversation.findMany({
      where: {
        members: {
          some: { userId: req.userId },
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
    const cleaned = sorted.map((conv) => ({
      id: conv.id,
      name: conv.name,
      createdById: conv.createdById,
      members: conv.members
        .map((m) => m.user)
        .filter((u) => u.id !== req.userId),
      lastMessage: conv.messages[0] ?? null,
    }));

    return res.json(cleaned);
  } catch (error) {
    return handleError(res);
  }
});

router.post("/new-conversation", auth, async (req, res) => {
  try {
    // gets the target username from the user
    const { targetUsername } = req.body;

    // find the target user
    const targetedUser = await prisma.user.findUnique({
      where: { username: targetUsername },
      select: { id: true, username: true, avatar: true },
    });

    // check if the target user exists or not
    if (!targetedUser)
      return res.status(400).json({ error: "Searched User not found" });

    // check if the target user is the current user or not
    if (targetedUser.id === req.userId)
      return res.status(400).json({ error: "You can't create a group with yourself" });

    // check if conversation already exists between these two users
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        AND: [
          { members: { some: { userId: req.userId } } },
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

    if (existingConversation) {
      return res.status(200).json({
        message: "Conversation already exists",
        conversation: existingConversation,
      });
    }

    // create the conversation
    const newConversation = await prisma.conversation.create({
      data: {
        createdById: req.userId,
        members: {
          create: [{ userId: req.userId }, { userId: targetedUser.id }],
        },
      },
    });

    return res.status(201).json({
      message: "New conversation created successfully",
      conversation: newConversation,
    });
  } catch (error) {
    return handleError(res);
  }
});
router.get("/messages/:conversationId", auth, async (req, res) => {
  try {
    // gets the conversation id
    const conversationId = parseId(req.params.conversationId);

    // check if user is a member of the conversation
    const membership = await ensureMember(conversationId, req.userId, res);
    if (!membership) return;

    // sets the pagination limit and cursor
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = parseInt(req.query.before);

    const where = { conversationId: conversationId };

    // get messages before a cursor (for pagination)
    if (before) {
      const cursorMessage = await prisma.message.findFirst({
        where: { id: before },
        select: { sentAt: true },
      });
      if (cursorMessage) {
        where.sentAt = { lt: cursorMessage.sentAt };
      }
    }

    // gets the messages of the conversation
    const messages = await prisma.message.findMany({
      where,
      orderBy: { sentAt: "desc" },
      take: limit,
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

    messages.reverse();

    return res.status(200).json(messages);
  } catch (error) {
    return handleError(res);
  }
});

router.post("/messages", auth, async (req, res) => {
  try {
    // gets the message details from the user
    const { messageText, conversationId: rawConversationId, nonce } = req.body;
    const conversationId = parseId(rawConversationId);
    const senderId = req.userId;

    // check if the required fields are present or not
    if (!messageText || !nonce || Number.isNaN(conversationId)) {
      return res.status(400).json({
        error: "messageText, nonce, and conversationId are required",
      });
    }

    const normalizedNonce = normalizeNonce(nonce);

    // check if user is a member of the conversation
    const membership = await ensureMember(conversationId, senderId, res);
    if (!membership) return;

    // creates a new message in the conversation
    const message = await prisma.message.create({
      data: {
        conversationId: conversationId,
        senderId: senderId,
        text: messageText,
        nonce: normalizedNonce,
      },
      include: {
        reactions: {
          select: {
            emoji: true,
            user: { select: { id: true } },
          },
        },
      },
    });

    // emits the new message to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, conversationId, "new-message", message);

    return res.status(201).json(message);
  } catch (error) {
    return handleError(res);
  }
});

router.patch("/messages/:id", auth, async (req, res) => {
  try {
    // gets the message details from the user
    const messageId = parseId(req.params.id);
    const { text, nonce } = req.body;

    // check if the required fields are present or not
    if (!text || !nonce || Number.isNaN(messageId)) {
      return res.status(400).json({ error: "text and nonce are required" });
    }

    const normalizedNonce = normalizeNonce(nonce);

    // find message and check ownership
    const message = await findAndValidateMessage(messageId, req.userId, res);
    if (!message) return;

    // updates the message
    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: { text: text, nonce: normalizedNonce },
    });

    // emits the updated message to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, message.conversationId, "message-updated", updatedMessage);

    return res.status(200).json(updatedMessage);
  } catch (error) {
    return handleError(res);
  }
});

router.delete("/messages/:id", auth, async (req, res) => {
  try {
    // gets the message id
    const messageId = parseId(req.params.id);

    // find message and check ownership
    const message = await findAndValidateMessage(messageId, req.userId, res);
    if (!message) return;

    // deletes the message
    const deletedMessage = await prisma.message.delete({
      where: { id: messageId },
    });

    // emits the deleted message id to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, message.conversationId, "message-deleted", {
      id: messageId,
    });

    return res.status(200).json(deletedMessage);
  } catch (error) {
    return handleError(res);
  }
});

router.put("/:id/key/:userId", auth, async (req, res) => {
  try {
    // gets the required data ( conversation id and user id)
    const conversationId = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    const { encryptedKey, nonce } = req.body;

    // check if the required fields are present or not
    if (!encryptedKey || !nonce)
      return res.status(400).json({ error: "encryptedKey and nonce are required" });

    // check if requester is a member
    const conversationMember = await ensureMember(conversationId, req.userId, res);
    if (!conversationMember) return;

    // check if target user is a member
    const targetMember = await findMember(conversationId, userId);
    if (!targetMember) {
      return res.status(404).json({
        error: "Target user is not a member of this conversation",
      });
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

    return res.status(200).json({ message: "Conversation key stored successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
router.get("/:id/key", auth, async (req, res) => {
  try {
    // gets the conversation id and user id
    const conversationId = parseId(req.params.id);
    const userId = req.userId;

    // gets the encrypted conversation key of the user
    const result = await prisma.conversationMember.findUnique({
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

    // check if the user is a member of the conversation or not
    if (!result) {
      return res.status(403).json({
        error: "You are not a member of this conversation",
      });
    }

    return res.status(200).json({
      encryptedConversationKey: result.encryptedConversationKey,
      nonce: result.nonce,
      createdById: result.conversation.createdById,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post("/messages/:conversationId/mark-read", auth, async (req, res) => {
  try {
    // gets the user id, conversation id and message id
    const userId = req.userId;
    const conversationId = Number(req.params.conversationId);
    const { messageId } = req.body;

    // check if the required fields are present or not
    if (!conversationId || !messageId) {
      return res.status(400).json({
        error: "conversationId and messageId are required",
      });
    }

    // check if user is a member
    const membership = await ensureMember(conversationId, userId, res);
    if (!membership) return;

    // check if message exists in this conversation
    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, senderId: true, conversationId: true },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // check if the user is trying to mark their own message as read or not
    if (message.senderId === userId) {
      return res.status(400).json({ error: "You cannot mark your own message as read" });
    }

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

    // emits the mark-read event to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, conversationId, "mark-read", {
      conversationId,
      messageId,
      userId,
      readAt,
    });

    return res.status(200).json({ message: "Messages marked as read", conversationId, messageId, userId, readAt });
  } catch (error) {
    console.error("Mark read error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/messages/:id/reactions", auth, async (req, res) => {
  try {
    // gets the message id and emoji from the user
    const { emoji } = req.body;
    const messageId = parseId(req.params.id);
    const userId = req.userId;

    // check if the message id and emoji are validate or not
    if (validateMessageId(messageId, res)) return;
    if (validateEmoji(emoji, res)) return;

    // adds or updates the reaction for the message
    const result = await handleReaction(messageId, userId, emoji, res);
    if (!result) return;

    // emits the reaction to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, result.message.conversationId, "message-reaction", {
      conversationId: result.message.conversationId,
      messageId: result.message.id,
      userId,
      emoji,
      removed: false,
    });

    return res.status(201).json(result.reaction);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to add reaction" });
  }
});

router.put("/messages/:id/reactions", auth, async (req, res) => {
  try {
    // gets the message id and emoji from the user
    const { emoji } = req.body;
    const messageId = parseId(req.params.id);
    const userId = req.userId;

    // check if the message id and emoji are validate or not
    if (validateMessageId(messageId, res)) return;
    if (validateEmoji(emoji, res)) return;

    // updates the reaction for the message
    const result = await handleReaction(messageId, userId, emoji, res);
    if (!result) return;

    // emits the updated reaction to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, result.message.conversationId, "message-reaction-update", {
      conversationId: result.message.conversationId,
      messageId: result.message.id,
      userId,
      emoji,
      removed: false,
    });

    return res.status(200).json(result.reaction);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to add reaction" });
  }
});

router.delete("/messages/:id/reactions", auth, async (req, res) => {
  try {
    // gets the message id and emoji from the user
    const { emoji } = req.body;
    const messageId = parseId(req.params.id);
    const userId = req.userId;

    // check if the message id is validate or not
    if (validateMessageId(messageId, res)) return;

    // check if the message exists or not
    const message = await findMessage(messageId);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // deletes the reaction for the message
    const deletedReaction = await prisma.messageReaction.delete({
      where: {
        messageId_userId: { messageId: message.id, userId },
      },
    });

    // emits the removed reaction to all the members of the conversation
    const io = req.app.get("io");
    emitToConversation(io, message.conversationId, "message-reaction", {
      conversationId: message.conversationId,
      messageId: message.id,
      userId,
      emoji,
      removed: true,
    });

    return res.status(200).json(deletedReaction);
  } catch (error) {
    console.error(error);
    return res.status(404).json({ error: "Reaction not found" });
  }
});

router.post("/group", auth, async (req, res) => {
  try {
    // gets the group details from the user
    const { name, membersId } = req.body;
    const userId = req.userId;

    // check if the group has enough members or not
    if (!membersId || membersId.length < 1) {
      return res.status(400).json({
        error: "It is still 1 to 1 conversation",
      });
    }

    // creates a new group with the current user as the admin
    const group = await prisma.conversation.create({
      data: {
        createdById: userId,
        name,
        members: {
          create: [
            { userId: req.userId },
            ...membersId.map((id) => ({ userId: id })),
          ],
        },
      },
    });

    return res.status(201).json(group);
  } catch (error) {
    console.error("Error creating group:", error);

    return res.status(500).json({
      error: "Failed to create group",
    });
  }
});

router.post("/:id/members", auth, async (req, res) => {
  try {
    // gets the user ids and conversation id
    const { userIds } = req.body;
    const conversationId = parseId(req.params.id);

    // check if the user ids are validate or not
    if (!Array.isArray(userIds) || userIds.length === 0)
      return res.status(400).json({ error: "Invalid userIds send or null" });

    // check if the user is a member of the conversation or not
    const membership = await ensureMember(conversationId, req.userId, res);
    if (!membership) return;

    // filter out users that don't exist
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });

    const validUserIds = users.map((u) => u.id);

    // adds all the valid users to the conversation
    const { count } = await prisma.conversationMember.createMany({
      data: validUserIds.map((uid) => ({
        conversationId: Number(conversationId),
        userId: uid,
      })),
      skipDuplicates: true,
    });

    res.status(201).json({ added: count });
  } catch (error) {
    console.error("Error adding conversation members:", error);
    res.status(500).json({
      message: "Failed to add conversation members",
      error: error.message,
    });
  }
});

router.post("/:id/members/add", auth, async (req, res) => {
  try {
    // gets the required data ( userId and conversation id )
    const { userId } = req.body;
    const conversationId = parseId(req.params.id);

    // check if the user is a member of the conversation or not
    const membership = await ensureMember(conversationId, req.userId, res);
    if (!membership) return;

    // check if the user exists or not
    const user = await findUser(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // check if the user is already in the conversation (group) or not
    const existingMember = await findMember(conversationId, userId);

    if (existingMember) {
      return res.status(409).json({ error: "User is already in the conversation" });
    }

    // adds the user in the group (conversation)
    const addUser = await prisma.conversationMember.create({
      data: { conversationId, userId },
    });

    return res.status(201).json(addUser);
  } catch (error) {
    console.error("Error adding conversation members:", error);
    return res.status(500).json({
      message: "Failed to add conversation members",
      error: error.message,
    });
  }
});

router.delete("/:id/members/:userId", auth, async (req, res) => {
  try {
    // gets the required data ( userid and conversation id)
    const userId = parseId(req.params.userId);
    const conversationId = parseId(req.params.id);

    // check the one who is removing the user is admin of the group (conversation) or not
    const conversation = await checkAdmin(conversationId, req.userId);

    if (!conversation) {
      return res.status(403).json({ error: "You are not the admin of the group" });
    }

    // check if the user exists or not
    const user = await findUser(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // check if the user is in the conversation (group) or not
    const member = await findMember(conversationId, userId);

    if (!member) {
      return res.status(404).json({ error: "User is not a member of this conversation" });
    }

    // removes the user
    await prisma.conversationMember.delete({
      where: {
        conversationId_userId: { conversationId, userId },
      },
    });

    return res.status(200).json({ message: "User removed from conversation" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", auth, async (req, res) => {
  try {
    // gets the name of the group
    const { name } = req.body;

    // small validations ( name must not be empty and must be string)
    if (typeof name !== "string") {
      return res.status(400).json({ error: "Name must be a string" });
    }

    const trimmedName = name.trim();

    if (!trimmedName) {
      return res.status(400).json({ error: "Name cannot be empty" });
    }

    // gets the conversation id
    const conversationId = parseId(req.params.id);

    // fetch the conversation with its members so we can tell
    // whether this is a 1:1 and whether the user is a member
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId },
      include: { members: { select: { userId: true } } },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const isMember = conversation.members.some(
      (m) => m.userId === req.userId,
    );

    if (!isMember) {
      return res
        .status(403)
        .json({ error: "You are not a member of this conversation" });
    }

    // any member of a 1:1 conversation can set a nickname,
    // but groups can only be renamed by the admin
    const isAdmin = conversation.createdById === req.userId;
    const is1to1 = conversation.members.length === 2;

    if (!isAdmin && !is1to1) {
      return res
        .status(403)
        .json({ error: "You are not the admin of the group" });
    }

    // updates the name of the conversation
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: { name: trimmedName },
    });

    return res.status(200).json({
      message: "Group name changed",
      conversation: updatedConversation,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id/leave", auth, async (req, res) => {
  try {
    const conversationId = parseId(req.params.id);

    // check if user exists
    const user = await findUser(req.userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // check if user is in the group
    const inConversation = await findMember(conversationId, req.userId);

    if (!inConversation) {
      return res.status(401).json({ error: "You are not in the conversation" });
    }

    // remove user from the group
    await prisma.conversationMember.delete({
      where: {
        conversationId_userId: { conversationId, userId: req.userId },
      },
    });

    return res.status(200).json({ message: "User removed from conversation" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
