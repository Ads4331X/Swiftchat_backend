import * as express from "express";
import auth from "../middleware/auth.js";
import prisma from "../prisma.js";
const router = express.Router();

router.get("/conversations", auth, async (req, res) => {
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
              select: { id: true, username: true },
            },
          },
        },
      },
    });

    const cleaned = conversations.map((conv) => ({
      id: conv.id,
      members: conv.members.map((m) => m.user),
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
      select: { id: true, username: true },
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
            user: { select: { id: true, username: true } },
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
