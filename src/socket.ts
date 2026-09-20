import jwt from "jsonwebtoken";
import prisma from "./prisma.js";
import type { ExtendedError, Server, Socket } from "socket.io";

const JWT_SECRET = process.env.JWT_SECRET ?? "";

type AuthenticatedSocket = Socket & { userId?: number };

export function setupSocket(io: Server) {
  io.use((socket: AuthenticatedSocket, next: (err?: ExtendedError) => void) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("No token provided"));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      if (typeof decoded === "string" || !("userId" in decoded)) {
        return next(new Error("Invalid token"));
      }

      const userId = Number(decoded.userId);
      if (!Number.isFinite(userId)) {
        return next(new Error("Invalid token"));
      }

      socket.userId = userId;

      return next();
    } catch {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket: AuthenticatedSocket) => {
    // make a user active on connection
    await prisma.user.update({
      data: {
        lastSeen: null,
      },
      where: { id: Number(socket.userId) },
    });

    const members = await prisma.conversationMember.findMany({
      where: { userId: socket.userId ?? 0 },
    });

    members.forEach((member) => {
      void socket.join(String(member.conversationId));
    });

    io.emit("presence", {
      userId: socket.userId,
      lastSeen: null,
    });
    // make a user unactive on connection
    socket.on("disconnect", async () => {
      const updatedLastSeen = await prisma.user.update({
        data: {
          lastSeen: new Date(),
        },
        where: { id: Number(socket.userId) },
      });

      io.emit("presence", {
        userId: socket.userId,
        lastSeen: updatedLastSeen.lastSeen,
      });
    });

    socket.on("join-conversation", async (id: string) => {
      const conversationId = Number(id);
      if (!conversationId) return;

      const check = await prisma.conversationMember.findFirst({
        where: { conversationId, userId: socket.userId ?? 0 },
      });

      if (check) {
        await socket.join(String(conversationId));
      }
    });

    socket.on(
      "typing-start",
      ({ conversationId }: { conversationId: string }) => {
        if (!conversationId) return;

        void socket.to(String(conversationId)).emit("typing-start", {
          conversationId: Number(conversationId),
          userId: socket.userId,
        });
      },
    );

    socket.on(
      "typing-stop",
      ({ conversationId }: { conversationId: string }) => {
        if (!conversationId) return;

        void socket.to(String(conversationId)).emit("typing-stop", {
          conversationId: Number(conversationId),
          userId: socket.userId,
        });
      },
    );
  });
}
