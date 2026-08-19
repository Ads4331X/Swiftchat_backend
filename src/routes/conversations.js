import * as express from "express";
import auth from "../middleware/auth.js";
import prisma from "../prisma.js";

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
          select: { id: true, text: true, sentAt: true, senderId: true },
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
      members: conv.members
        .map((m) => m.user)
        .filter((u) => u.id !== req.userId),
      lastMessage: conv.messages[0] ?? null,
    }));

    return res.json(cleaned);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
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
    return res.status(500).json({ error: "Internal server error" });
  }
});
router.get("/messages/:conversationId", auth, async (req, res) => {
  try {
    const conversationId = parseInt(req.params.conversationId);

    const membership = await prisma.conversationMember.findFirst({
      where: { conversationId: conversationId, userId: req.userId },
    });

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
    });

    messages.reverse();

    return res.status(200).json(messages);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/messages", auth, async (req, res) => {
  try {
    const { messageText, conversationId: rawConversationId } = req.body;
    const conversationId = parseInt(rawConversationId);
    const senderId = req.userId;

    const membership = await prisma.conversationMember.findFirst({
      where: { conversationId: conversationId, userId: senderId },
    });

    if (!membership)
      return res.status(403).json({
        error: "You are not a member of this conversation",
      });

    const message = await prisma.message.create({
      data: {
        conversationId: conversationId,
        senderId: senderId,
        text: messageText,
      },
    });

    const io = req.app.get("io");
    io.to(String(conversationId)).emit("new-message", message);

    return res.status(201).json(message);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/messages/:id", auth, async (req, res) => {
  try {
    const messageId = parseInt(req.params.id);
    const { text } = req.body;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

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
      },
    });
    const io = req.app.get("io");
    io.to(String(message.conversationId)).emit("message-updated", updatedMessage);

    return res.status(200).json(updatedMessage);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/messages/:id", auth, async (req, res) => {
  try {
    const messageId = parseInt(req.params.id);

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

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
    io.to(String(message.conversationId)).emit("message-deleted", {
      id: messageId,
    });

    return res.status(200).json(deletedMessage);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});
export default router;
