import jwt from "jsonwebtoken";
import prisma from "./prisma.js";

export function setupSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("No token provided"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch (error) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    console.log("User connected:", socket.userId);
    const members = await prisma.conversationMember.findMany({
      where: { userId: socket.userId },
    });
    members.forEach((member) => {
      socket.join(String(member.conversationId));
    });
    socket.on("join-conversation", async (id) => {
      const conversationId = Number(id);
      if (!conversationId) return;
      const check = await prisma.conversationMember.findFirst({
        where: { conversationId, userId: socket.userId },
      });
      if (check) socket.join(String(conversationId));
    });
  });
}
