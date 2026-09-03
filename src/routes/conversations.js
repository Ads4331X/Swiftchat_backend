import * as express from "express";
import auth from "../middleware/auth.js";
import prisma from "../prisma.js";
import {
  parseId,
  normalizeNonce,
  checkMembership,
  findMember,
  findMessage,
  validateMessageId,
  validateEmoji,
  emitToConversation,
  handleError,
} from "../helpers/conversations.js";

const router = express.Router();

router.get("/", auth, async (req, res) => {
  try {
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

    const sorted = conversations.sort((a, b) => {
      const aTime = a.messages[0]?.sentAt ?? a.createdAt;
      const bTime = b.messages[0]?.sentAt ?? b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    const cleaned = sorted.map((conv) => ({
      id: conv.id,
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
    const { targetUsername } = req.body;

    const targetedUser = await prisma.user.findUnique({
      where: { username: targetUsername },
      select: { id: true, username: true, avatar: true },
    });
    if (!targetedUser)
      return res.status(400).json({
        error: "Searched User not found",
      });

    if (targetedUser.id === req.userId)
      return res.status(400).json({
        error: "You can't create a group with yourself",
      });

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
    const conversationId = parseId(req.params.conversationId);

    const membership = await checkMembership(conversationId, req.userId);

    if (!membership)
      return res
        .status(403)
        .json({ error: "You are not a member of this conversation" });

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = parseInt(req.query.before);

    const where = { conversationId: conversationId };
    if (before) {
      const cursorMessage = await prisma.message.findFirst({
        where: { id: before },
        select: { sentAt: true },
      });
      if (cursorMessage) {
        where.sentAt = { lt: cursorMessage.sentAt };
      }
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: {
        sentAt: "desc",
      },
      take: limit,
      include: {
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
    const { messageText, conversationId: rawConversationId, nonce } = req.body;
    const conversationId = parseId(rawConversationId);
    const senderId = req.userId;

    if (!messageText || !nonce || Number.isNaN(conversationId)) {
      return res.status(400).json({
        error: "messageText, nonce, and conversationId are required",
      });
    }

    const normalizedNonce = normalizeNonce(nonce);

    const membership = await checkMembership(conversationId, senderId);

    if (!membership)
      return res.status(403).json({
        error: "You are not a member of this conversation",
      });

    const message = await prisma.message.create({
      data: {
        conversationId: conversationId,
        senderId: senderId,
        text: messageText,
        nonce: normalizedNonce,
      },
    });

    const io = req.app.get("io");
    emitToConversation(io, conversationId, "new-message", message);

    return res.status(201).json(message);
  } catch (error) {
    return handleError(res);
  }
});

router.patch("/messages/:id", auth, async (req, res) => {
  try {
    const messageId = parseId(req.params.id);
    const { text, nonce } = req.body;

    if (!text || !nonce || Number.isNaN(messageId)) {
      return res.status(400).json({
        error: "text and nonce are required",
      });
    }

    const normalizedNonce = normalizeNonce(nonce);

    const message = await findMessage(messageId);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.senderId !== req.userId) {
      return res
        .status(403)
        .json({ error: "You can only edit your own messages" });
    }

    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        text: text,
        nonce: normalizedNonce,
      },
    });
    const io = req.app.get("io");
    emitToConversation(
      io,
      message.conversationId,
      "message-updated",
      updatedMessage,
    );

    return res.status(200).json(updatedMessage);
  } catch (error) {
    return handleError(res);
  }
});

router.delete("/messages/:id", auth, async (req, res) => {
  try {
    const messageId = parseId(req.params.id);

    const message = await findMessage(messageId);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.senderId !== req.userId) {
      return res
        .status(403)
        .json({ error: "You can only delete your own messages" });
    }

    const deletedMessage = await prisma.message.delete({
      where: { id: messageId },
    });

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
    const conversationId = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    const { encryptedKey, nonce } = req.body;

    if (!encryptedKey || !nonce)
      return res.status(400).json({
        error: "encryptedKey and nonce are required",
      });

    const conversationMember = await findMember(conversationId, req.userId);

    if (!conversationMember) {
      return res.status(403).json({
        error: "You are not a member of this conversation",
      });
    }
    const targetMember = await findMember(conversationId, userId);

    if (!targetMember) {
      return res.status(404).json({
        error: "Target user is not a member of this conversation",
      });
    }

    await prisma.conversationMember.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: {
        encryptedConversationKey: encryptedKey,
        nonce: nonce,
      },
    });
    return res.status(200).json({
      message: "Conversation key stored successfully",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});
router.get("/:id/key", auth, async (req, res) => {
  try {
    const conversationId = parseId(req.params.id);
    const userId = req.userId;

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
    const userId = req.userId;
    const conversationId = Number(req.params.conversationId);
    const { messageId } = req.body;

    if (!conversationId || !messageId) {
      return res.status(400).json({
        error: "conversationId and messageId are required",
      });
    }

    const membership = await findMember(conversationId, userId);

    if (!membership) {
      return res.status(403).json({
        error: "You are not a member of this conversation",
      });
    }

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId,
      },
      select: {
        id: true,
        senderId: true,
        conversationId: true,
      },
    });

    if (!message) {
      return res.status(404).json({
        error: "Message not found",
      });
    }

    if (message.senderId === userId) {
      return res.status(400).json({
        error: "You cannot mark your own message as read",
      });
    }

    const readAt = new Date();

    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        id: {
          lte: messageId,
        },
        senderId: {
          not: userId,
        },
      },
      select: {
        id: true,
      },
    });

    await prisma.messageRead.createMany({
      data: messages.map((message) => ({
        messageId: message.id,
        userId,
        conversationId,
        readAt,
      })),
      skipDuplicates: true,
    });

    const io = req.app.get("io");

    emitToConversation(io, conversationId, "mark-read", {
      conversationId,
      messageId,
      userId,
      readAt,
    });

    return res.status(200).json({
      message: "Messages marked as read",
      conversationId,
      messageId,
      userId,
      readAt,
    });
  } catch (error) {
    console.error("Mark read error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post("/messages/:id/reactions", auth, async (req, res) => {
  try {
    const { emoji } = req.body;
    const messageId = parseId(req.params.id);
    const userId = req.userId;

    if (validateMessageId(messageId, res)) return;
    if (validateEmoji(emoji, res)) return;

    const message = await findMessage(messageId);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const reaction = await prisma.messageReaction.upsert({
      where: {
        messageId_userId: {
          messageId: message.id,
          userId,
        },
      },
      update: {
        emoji,
      },
      create: {
        userId,
        messageId: message.id,
        emoji,
      },
    });

    const io = req.app.get("io");
    emitToConversation(io, message.conversationId, "message-reaction", {
      conversationId: message.conversationId,
      messageId: message.id,
      userId: userId,
      emoji: emoji,
      removed: false,
    });

    return res.status(201).json(reaction);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to add reaction" });
  }
});

router.put("/messages/:id/reactions", auth, async (req, res) => {
  try {
    const { emoji } = req.body;
    const messageId = parseId(req.params.id);
    const userId = req.userId;

    if (validateMessageId(messageId, res)) return;
    if (validateEmoji(emoji, res)) return;

    const message = await findMessage(messageId);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const reaction = await prisma.messageReaction.upsert({
      where: {
        messageId_userId: {
          messageId: message.id,
          userId,
        },
      },
      update: {
        emoji,
      },
      create: {
        userId,
        messageId: message.id,
        emoji,
      },
    });

    const io = req.app.get("io");
    emitToConversation(io, message.conversationId, "message-reaction-update", {
      conversationId: message.conversationId,
      messageId: message.id,
      userId: userId,
      emoji: emoji,
      removed: false,
    });

    return res.status(200).json(reaction);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to add reaction" });
  }
});

router.delete("/messages/:id/reactions", auth, async (req, res) => {
  try {
    const { emoji } = req.body;
    const messageId = parseId(req.params.id);
    const userId = req.userId;

    if (validateMessageId(messageId, res)) return;

    const message = await findMessage(messageId);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const deletedReaction = await prisma.messageReaction.delete({
      where: {
        messageId_userId: {
          messageId: message.id,
          userId,
        },
      },
    });
    const io = req.app.get("io");
    emitToConversation(io, message.conversationId, "message-reaction", {
      conversationId: message.conversationId,
      messageId: message.id,
      userId: userId,
      emoji: emoji,
      removed: true,
    });

    return res.status(200).json(deletedReaction);
  } catch (error) {
    console.error(error);

    return res.status(404).json({
      error: "Reaction not found",
    });
  }
});

router.post("/group", auth, async (req, res) => {
  try {
    const { name, membersId } = req.body;
    const userId = req.userId;

    if (!membersId || membersId.length < 1) {
      return res.status(400).json({
        error: "It is still 1 to 1 conversation",
      });
    }

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

export default router;
