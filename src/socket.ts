import jwt from "jsonwebtoken";
import prisma from "./prisma.js";
import type { ExtendedError, Server, Socket } from "socket.io";
import { canEmitToConversation, ensureMember } from "./helpers/helper.js";
import { randomUUID } from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET ?? "";

type AuthenticatedSocket = Socket & { userId?: number };
type ParticipantCallStatus =
  | "ringing"
  | "accepted"
  | "declined"
  | "disconnected";

interface Call {
  callId: string;
  callerId: number;
  conversationId: number;
  callType: "audio" | "video";
  receiverIds: number[];
  status:
    | "Outgoing"
    | "ringing"
    | "connecting"
    | "connected"
    | "ended"
    | "failed";
  acceptedBy: Set<number>;
  participantStatuses: Map<number, ParticipantCallStatus>;
  cameraStates: Map<number, boolean>;
  screenShareStates: Map<number, boolean>;
  createdAt: Date;
  declinedBy: Set<number>;
  leftBy: Set<number>;
}

type WhiteboardStroke = {
  id: string;
  color: string;
  points: { x: number; y: number }[];
};

function isWhiteboardStroke(value: unknown): value is WhiteboardStroke {
  if (!value || typeof value !== "object") return false;
  const stroke = value as Record<string, unknown>;
  if (
    typeof stroke.id !== "string" ||
    stroke.id.length > 100 ||
    typeof stroke.color !== "string" ||
    !/^#[0-9a-fA-F]{6}$/.test(stroke.color) ||
    !Array.isArray(stroke.points) ||
    stroke.points.length < 1 ||
    stroke.points.length > 500
  ) {
    return false;
  }

  return stroke.points.every((point) => {
    if (!point || typeof point !== "object") return false;
    const { x, y } = point as { x?: unknown; y?: unknown };
    return (
      typeof x === "number" &&
      Number.isFinite(x) &&
      x >= 0 &&
      x <= 1 &&
      typeof y === "number" &&
      Number.isFinite(y) &&
      y >= 0 &&
      y <= 1
    );
  });
}

function canUseActiveCall(call: Call | undefined, userId: number) {
  return Boolean(
    call &&
      call.status !== "ended" &&
      call.status !== "failed" &&
      !call.leftBy.has(userId) &&
      (call.callerId === userId || call.acceptedBy.has(userId)),
  );
}

function canUseCallWhiteboard(call: Call | undefined, userId: number) {
  return canUseActiveCall(call, userId);
}

function emitParticipantStatus(
  io: Server,
  call: Call,
  userId: number,
  status: ParticipantCallStatus,
) {
  const payload = { callId: call.callId, userId, status };
  for (const participantId of [call.callerId, ...call.receiverIds]) {
    const socketIds = userSockets.get(participantId);
    if (!socketIds) continue;
    for (const socketId of socketIds) {
      io.to(socketId).emit("call:participant-status", payload);
    }
  }
}

function handleCallParticipantDisconnect(io: Server, userId: number) {
  for (const [callId, call] of activeCalls) {
    const isCaller = call.callerId === userId;
    if (!isCaller && !call.receiverIds.includes(userId)) continue;

    call.cameraStates.delete(userId);
    call.screenShareStates.delete(userId);
    call.participantStatuses.set(userId, "disconnected");
    emitParticipantStatus(io, call, userId, "disconnected");

    if (call.receiverIds.length <= 1) {
      call.status = "ended";
      activeCalls.delete(callId);

      for (const participantId of [call.callerId, ...call.receiverIds]) {
        if (participantId === userId) continue;
        const socketIds = userSockets.get(participantId);
        if (!socketIds) continue;
        for (const socketId of socketIds) {
          io.to(socketId).emit("call:ended", { callId, userId });
        }
      }
      continue;
    }

    call.leftBy.add(userId);
    for (const participantId of [call.callerId, ...call.receiverIds]) {
      if (participantId === userId) continue;
      const socketIds = userSockets.get(participantId);
      if (!socketIds) continue;
      for (const socketId of socketIds) {
        io.to(socketId).emit("call:participant-left", { callId, userId });
      }
    }

    const hasAcceptedParticipant = [...call.acceptedBy].some(
      (participantId) => !call.leftBy.has(participantId),
    );
    const hasRingingParticipant = call.receiverIds.some(
      (participantId) =>
        call.participantStatuses.get(participantId) === "ringing",
    );
    if (!hasAcceptedParticipant && !hasRingingParticipant) {
      call.status = "ended";
      activeCalls.delete(callId);
      for (const participantId of [call.callerId, ...call.receiverIds]) {
        if (participantId === userId) continue;
        const socketIds = userSockets.get(participantId);
        if (!socketIds) continue;
        for (const socketId of socketIds) {
          io.to(socketId).emit("call:ended", { callId, userId });
        }
      }
    }
  }
}

// Track every active socket for each user
const userSockets = new Map<number, Set<string>>();
const activeCalls = new Map<string, Call>();

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

      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return next(new Error("Invalid token"));
      }

      socket.userId = userId;

      return next();
    } catch {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket: AuthenticatedSocket) => {
    const userId = Number(socket.userId);

    // Track the user's active socket connection
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }

    userSockets.get(userId)!.add(socket.id);

    // Make a user active on connection
    await prisma.user.update({
      data: {
        lastSeen: null,
      },
      where: { id: userId },
    });

    const members = await prisma.conversationMember.findMany({
      where: { userId },
    });

    members.forEach((member) => {
      void socket.join(String(member.conversationId));
    });

    io.emit("presence", {
      userId,
      lastSeen: null,
    });

    // Remove this socket when it disconnects
    socket.on("disconnect", async () => {
      const sockets = userSockets.get(userId);

      sockets?.delete(socket.id);

      // Only mark the user offline when all their sockets disconnect
      if (!sockets || sockets.size === 0) {
        userSockets.delete(userId);

        const updatedLastSeen = await prisma.user.update({
          data: {
            lastSeen: new Date(),
          },
          where: { id: userId },
        });

        io.emit("presence", {
          userId,
          lastSeen: updatedLastSeen.lastSeen,
        });
        handleCallParticipantDisconnect(io, userId);
      }
    });

    socket.on("join-conversation", async (id: string) => {
      const conversationId = Number(id);
      if (!conversationId) return;

      const check = await prisma.conversationMember.findFirst({
        where: { conversationId, userId },
      });

      if (check) {
        await socket.join(String(conversationId));
      }
    });

    socket.on(
      "typing-start",
      async ({ conversationId }: { conversationId: string }) => {
        if (!conversationId) return;

        const canEmit = await canEmitToConversation({
          conversationId: Number(conversationId),
          senderId: userId,
        });

        if (canEmit) {
          void socket.to(String(conversationId)).emit("typing-start", {
            conversationId: Number(conversationId),
            userId,
          });
        }
      },
    );

    socket.on(
      "typing-stop",
      async ({ conversationId }: { conversationId: string }) => {
        if (!conversationId) return;

        const canEmit = await canEmitToConversation({
          conversationId: Number(conversationId),
          senderId: userId,
        });

        if (canEmit) {
          void socket.to(String(conversationId)).emit("typing-stop", {
            conversationId: Number(conversationId),
            userId,
          });
        }
      },
    );

    // Initiate a call
    socket.on(
      "call:initiate",
      async (
        {
          callType,
          conversationId,
        }: {
          callType: "audio" | "video";
          conversationId: number;
        },
        ack?: (response: {
          success: boolean;
          data?: {
            callId: string;
            participantCount: number;
            participantStatuses: Record<number, ParticipantCallStatus>;
          };
          error?: string;
        }) => void,
      ) => {
        try {
          if (
            !Number.isSafeInteger(conversationId) ||
            conversationId <= 0 ||
            !["audio", "video"].includes(callType)
          ) {
            ack?.({
              success: false,
              error: "Invalid call details",
            });
            return;
          }

          // Verify that the caller belongs to this conversation
          const user = await ensureMember(conversationId, userId);

          if (!user) {
            ack?.({
              success: false,
              error: "You are not a member of this conversation",
            });
            return;
          }

          // Get the conversation members
          const conversationMembers = await prisma.conversationMember.findMany({
            where: { conversationId },
          });

          const receiverIds = conversationMembers
            .map((member) => member.userId)
            .filter((memberId) => memberId !== userId);

          if (receiverIds.length === 0) {
            ack?.({
              success: false,
              error: "No other participants in this conversation",
            });
            return;
          }

          // Generate a unique call ID
          const callId = randomUUID();

          // Store the call BEFORE notifying receivers
          const call: Call = {
            callId,
            callerId: userId,
            conversationId,
            callType,
            receiverIds,
            status: "ringing",
            acceptedBy: new Set<number>(),
            participantStatuses: new Map([
              [userId, "accepted"],
              ...receiverIds.map(
                (receiverId) => [receiverId, "ringing"] as const,
              ),
            ]),
            cameraStates: new Map([[userId, callType === "video"]]),
            screenShareStates: new Map(),
            declinedBy: new Set<number>(),
            leftBy: new Set<number>(),
            createdAt: new Date(),
          };

          activeCalls.set(callId, call);

          // Notify every connected receiver
          for (const receiverId of receiverIds) {
            const socketIds = userSockets.get(receiverId);

            if (!socketIds) continue;

            for (const socketId of socketIds) {
              io.to(socketId).emit("incoming-call", {
                callId,
                conversationId,
                callerId: userId,
                callType,
                participantCount: receiverIds.length + 1,
                participantStatuses: Object.fromEntries(
                  call.participantStatuses,
                ),
              });
            }
          }

          // Return the generated call ID to the caller
          ack?.({
            success: true,
            data: {
              callId,
              participantCount: receiverIds.length + 1,
              participantStatuses: Object.fromEntries(
                call.participantStatuses,
              ),
            },
          });
        } catch (error) {
          console.error("Failed to initiate call:", error);

          ack?.({
            success: false,
            error: "Failed to initiate call",
          });
        }
      },
    );

    // accept a call
    socket.on("call:accept", async ({ callId }: { callId: string }) => {
      const call = activeCalls.get(callId);
      // check if that call is active or not
      if (!call) return;

      // call status is rigning
      if (call.status === "ringing" || call.status === "connecting") {
        // ensure the call receiver is in the conversation (chat)
        const user = await ensureMember(
          Number(call.conversationId),
          Number(socket.userId),
        );
        if (!user) return;
        if (
          call.receiverIds.includes(user.userId) &&
          !call.leftBy.has(user.userId) &&
          !call.declinedBy.has(user.userId) &&
          !call.acceptedBy.has(user.userId)
        ) {
          call.acceptedBy.add(user.userId);
          call.declinedBy.delete(user.userId);
          call.cameraStates.set(user.userId, call.callType === "video");
          call.participantStatuses.set(user.userId, "accepted");
          call.status = "connecting";
          emitParticipantStatus(io, call, user.userId, "accepted");

          const participantIds = [call.callerId, ...call.acceptedBy].filter(
            (participantId) => !call.leftBy.has(participantId),
          );
          for (const recipientId of participantIds) {
            const recipientSockets = userSockets.get(recipientId);
            if (!recipientSockets) continue;
            for (const [participantId, cameraOn] of call.cameraStates) {
              if (
                participantId === recipientId ||
                call.leftBy.has(participantId)
              ) {
                continue;
              }
              for (const socketId of recipientSockets) {
                io.to(socketId).emit("call:camera-state", {
                  callId,
                  userId: participantId,
                  cameraOn,
                });
              }
            }
            for (const [participantId, isSharing] of call.screenShareStates) {
              if (
                !isSharing ||
                participantId === recipientId ||
                call.leftBy.has(participantId)
              ) {
                continue;
              }
              for (const socketId of recipientSockets) {
                io.to(socketId).emit("call:screen-share-state", {
                  callId,
                  userId: participantId,
                  isSharing,
                });
              }
            }
          }

          const establishedPeerIds = [
            call.callerId,
            ...call.acceptedBy,
          ].filter(
            (peerId) =>
              peerId !== user.userId && !call.leftBy.has(peerId),
          );

          for (const peerId of establishedPeerIds) {
            const peerSocketIds = userSockets.get(peerId);
            if (!peerSocketIds) continue;
            for (const socketId of peerSocketIds) {
              io.to(socketId).emit("call:accepted", {
                callId,
                userId: user.userId,
                peerIds: [user.userId],
                offerPeerIds: [user.userId],
              });
            }
          }

          const acceptedSocketIds = userSockets.get(user.userId);
          if (acceptedSocketIds) {
            for (const socketId of acceptedSocketIds) {
              io.to(socketId).emit("call:accepted", {
                callId,
                userId: user.userId,
                peerIds: establishedPeerIds,
                offerPeerIds: [],
              });
            }
          }
        }
      } else return;
    });

    // decline a call
    socket.on("call:decline", async ({ callId }: { callId: string }) => {
      const call = activeCalls.get(callId);

      // if no active call is found
      if (!call) return;

      // if call is ringing
      if (call.status === "ringing" || call.status === "connecting") {
        // check if user is member of the chat (conversation)
        const user = await ensureMember(
          Number(call.conversationId),
          Number(socket.userId),
        );

        if (!user) return;

        //record the receiver's decline.
        if (
          call.receiverIds.includes(user.userId) &&
          !call.acceptedBy.has(user.userId) &&
          !call.declinedBy.has(user.userId) &&
          !call.leftBy.has(user.userId)
        ) {
          // remove the user from accepted by
          call.acceptedBy.delete(user.userId);
          // add the user to the declined by
          call.declinedBy.add(user.userId);
          call.participantStatuses.set(user.userId, "declined");
          emitParticipantStatus(io, call, user.userId, "declined");
          call.status = call.acceptedBy.size > 0 ? "connecting" : "ringing";
          const hasAcceptedParticipant = [...call.acceptedBy].some(
            (participantId) => !call.leftBy.has(participantId),
          );
          const hasRingingParticipant = call.receiverIds.some(
            (participantId) =>
              call.participantStatuses.get(participantId) === "ringing",
          );
          if (!hasAcceptedParticipant && !hasRingingParticipant) {
            call.status = "ended";
          }

          const callerSocketIds = userSockets.get(call.callerId);

          if (callerSocketIds) {
            for (const socketId of callerSocketIds) {
              io.to(String(socketId)).emit("call:declined", {
                callId,
                userId: user.userId,
              });
            }
          }

          // A direct call is over after its receiver declines it.
          // Remove it so it cannot remain in memory as an ended call.
          if (call.status === "ended") {
            activeCalls.delete(callId);
            for (const participantId of [call.callerId, ...call.receiverIds]) {
              const participantSocketIds = userSockets.get(participantId);
              if (!participantSocketIds) continue;
              for (const socketId of participantSocketIds) {
                io.to(socketId).emit("call:ended", {
                  callId,
                  userId: user.userId,
                });
              }
            }
          }
        } else return;
      }
    });

    // End a call or leave a group call
    socket.on("call:end", async ({ callId }: { callId: string }) => {
      const call = activeCalls.get(callId);

      if (!call || call.status === "ended" || call.status === "failed") {
        return;
      }

      const user = await ensureMember(
        Number(call.conversationId),
        Number(socket.userId),
      );

      if (!user) return;

      const userId = user.userId;

      // Only the caller or someone who accepted the call can end/leave it
      const isCaller = call.callerId === userId;
      const hasAccepted = call.acceptedBy.has(userId);

      if (!isCaller && !hasAccepted) return;

      call.participantStatuses.set(userId, "disconnected");
      emitParticipantStatus(io, call, userId, "disconnected");

      const members = await prisma.conversationMember.findMany({
        where: { conversationId: Number(call.conversationId) },
      });

      // if 1 to 1 (Direct call) end the entire call
      if (members.length <= 2) {
        call.status = "ended";

        // Notify the caller
        const callerSocketIds = userSockets.get(call.callerId);

        if (callerSocketIds) {
          for (const socketId of callerSocketIds) {
            io.to(socketId).emit("call:ended", {
              callId,
              userId,
            });
          }
        }

        // Notify all intended receivers
        for (const receiverId of call.receiverIds) {
          const receiverSocketIds = userSockets.get(receiverId);

          if (receiverSocketIds) {
            for (const socketId of receiverSocketIds) {
              io.to(socketId).emit("call:ended", {
                callId,
                userId,
              });
            }
          }
        }

        activeCalls.delete(callId);
        return;
      }

      // Group call: record that this participant has left
      call.leftBy.add(userId);
      call.screenShareStates.delete(userId);

      // Notify the caller
      const callerSocketIds = userSockets.get(call.callerId);

      if (callerSocketIds) {
        for (const socketId of callerSocketIds) {
          io.to(socketId).emit("call:participant-left", {
            callId,
            userId,
          });
        }
      }

      // Notify the other receivers
      for (const receiverId of call.receiverIds) {
        if (receiverId === userId || call.leftBy.has(receiverId)) continue;

        const receiverSocketIds = userSockets.get(receiverId);

        if (receiverSocketIds) {
          for (const socketId of receiverSocketIds) {
            io.to(socketId).emit("call:participant-left", {
              callId,
              userId,
            });
          }
        }
      }

      // If the caller leaves, end the group call for everyone
      if (isCaller) {
        call.status = "ended";

        for (const receiverId of call.receiverIds) {
          const receiverSocketIds = userSockets.get(receiverId);

          if (receiverSocketIds) {
            for (const socketId of receiverSocketIds) {
              io.to(socketId).emit("call:ended", {
                callId,
                userId,
              });
            }
          }
        }

        activeCalls.delete(callId);
        return;
      }

      const hasAcceptedParticipant = [...call.acceptedBy].some(
        (participantId) => !call.leftBy.has(participantId),
      );
      const hasRingingParticipant = call.receiverIds.some(
        (participantId) =>
          call.participantStatuses.get(participantId) === "ringing",
      );
      if (!hasAcceptedParticipant && !hasRingingParticipant) {
        call.status = "ended";
        activeCalls.delete(callId);
        for (const participantId of [call.callerId, ...call.receiverIds]) {
          if (participantId === userId) continue;
          const socketIds = userSockets.get(participantId);
          if (!socketIds) continue;
          for (const socketId of socketIds) {
            io.to(socketId).emit("call:ended", { callId, userId });
          }
        }
      }
    });

    // Forward WebRTC offer to the intended receiver
    socket.on(
      "call:offer",
      async ({
        callId,
        receiverId,
        offer,
      }: {
        callId: string;
        receiverId: number;
        offer: RTCSessionDescriptionInit;
      }) => {
        const call = activeCalls.get(callId);

        if (!call || call.status === "ended" || call.status === "failed") {
          return;
        }

        const senderId = Number(socket.userId);

        const senderIsParticipant =
          call.callerId === senderId || call.acceptedBy.has(senderId);
        if (!senderIsParticipant || call.leftBy.has(senderId)) return;

        const receiverIsParticipant =
          call.callerId === receiverId || call.acceptedBy.has(receiverId);
        if (senderId === receiverId || !receiverIsParticipant) return;

        // The caller may offer only to an accepted receiver.
        if (receiverId !== call.callerId && !call.acceptedBy.has(receiverId)) {
          return;
        }

        const receiverSocketIds = userSockets.get(receiverId);

        if (!receiverSocketIds) return;

        // Forward offer to all connected sockets belonging to the receiver
        for (const socketId of receiverSocketIds) {
          io.to(socketId).emit("call:offer", {
            callId,
            senderId,
            offer,
            callType: call.callType,
          });
        }
      },
    );

    socket.on(
      "call:answer",
      async ({
        callId,
        receiverId,
        answer,
      }: {
        callId: string;
        receiverId: number;
        answer: RTCSessionDescriptionInit;
      }) => {
        const call = activeCalls.get(callId);

        if (!call || call.status === "ended" || call.status === "failed") {
          return;
        }

        // one who sends the answer
        const senderId = Number(socket.userId);

        // Either side of an accepted call can answer a renegotiation. The
        // caller is not in acceptedBy, so requiring that here dropped answers
        // whenever a receiver started screen sharing or restarted ICE.
        const senderIsParticipant =
          call.callerId === senderId || call.acceptedBy.has(senderId);
        if (!senderIsParticipant || call.leftBy.has(senderId)) return;

        const receiverIsParticipant =
          receiverId === call.callerId || call.acceptedBy.has(receiverId);
        if (
          !receiverIsParticipant ||
          receiverId === senderId ||
          call.leftBy.has(receiverId)
        ) {
          return;
        }

        const receiverSocketIds = userSockets.get(receiverId);

        if (!receiverSocketIds) return;

        for (const socketId of receiverSocketIds) {
          io.to(socketId).emit("call:answer", {
            callId,
            senderId,
            answer,
          });
        }
      },
    );

    socket.on(
      "call:ice-candidate",
      async ({
        callId,
        candidate,
      }: {
        callId: string;
        candidate: RTCIceCandidateInit;
      }) => {
        const call = activeCalls.get(callId);

        if (!call || call.status === "ended" || call.status === "failed") {
          return;
        }

        // userid who sends ice canditate
        const senderId = Number(socket.userId);

        // Check that the sender is the caller or an accepted receiver
        const isCaller = call.callerId === senderId;
        const isAcceptedReceiver = call.acceptedBy.has(senderId);

        if (!isCaller && !isAcceptedReceiver) return;

        // Find the intended recipients
        const otherUserIds = [
          call.callerId,
          ...call.acceptedBy,
        ].filter(
          (id) =>
            id !== senderId &&
            !call.leftBy.has(id) &&
            (id === call.callerId || call.acceptedBy.has(id)),
        );

        // Forward to each recipient's connected sockets
        for (const otherUserId of otherUserIds) {
          const socketIds = userSockets.get(otherUserId);

          if (!socketIds) continue;

          for (const socketId of socketIds) {
            io.to(socketId).emit("call:ice-candidate", {
              callId,
              senderId,
              candidate,
            });
          }
        }
      },
    );

    socket.on(
      "call:camera-state",
      ({ callId, cameraOn }: { callId: string; cameraOn: boolean }) => {
        const call = activeCalls.get(callId);
        if (
          !call ||
          call.status === "ended" ||
          call.status === "failed" ||
          typeof cameraOn !== "boolean" ||
          !canUseActiveCall(call, userId)
        ) {
          return;
        }

        call.cameraStates.set(userId, cameraOn);
        const participantIds = [call.callerId, ...call.acceptedBy].filter(
          (participantId) =>
            participantId !== userId && !call.leftBy.has(participantId),
        );
        for (const participantId of participantIds) {
          const socketIds = userSockets.get(participantId);
          if (!socketIds) continue;
          for (const socketId of socketIds) {
            io.to(socketId).emit("call:camera-state", {
              callId,
              userId,
              cameraOn,
            });
          }
        }
      },
    );

    socket.on(
      "call:screen-share-state",
      ({ callId, isSharing }: { callId: string; isSharing: boolean }) => {
        const call = activeCalls.get(callId);
        if (
          !call ||
          call.status === "ended" ||
          call.status === "failed" ||
          typeof isSharing !== "boolean" ||
          !canUseActiveCall(call, userId)
        ) {
          return;
        }

        call.screenShareStates.set(userId, isSharing);
        const participantIds = [call.callerId, ...call.acceptedBy].filter(
          (participantId) =>
            participantId !== userId && !call.leftBy.has(participantId),
        );
        for (const participantId of participantIds) {
          const socketIds = userSockets.get(participantId);
          if (!socketIds) continue;
          for (const socketId of socketIds) {
            io.to(socketId).emit("call:screen-share-state", {
              callId,
              userId,
              isSharing,
            });
          }
        }
      },
    );

    socket.on(
      "call:whiteboard:stroke",
      ({
        callId,
        stroke,
      }: {
        callId: string;
        stroke: unknown;
      }) => {
        const call = activeCalls.get(callId);
        if (
          !call ||
          !canUseCallWhiteboard(call, userId) ||
          !isWhiteboardStroke(stroke)
        ) {
          return;
        }

        const participantIds = [call.callerId, ...call.acceptedBy].filter(
          (participantId) =>
            participantId !== userId && !call.leftBy.has(participantId),
        );
        for (const participantId of participantIds) {
          const socketIds = userSockets.get(participantId);
          if (!socketIds) continue;
          for (const socketId of socketIds) {
            io.to(socketId).emit("call:whiteboard:stroke", {
              callId,
              userId,
              stroke,
            });
          }
        }
      },
    );

    socket.on("call:whiteboard:clear", ({ callId }: { callId: string }) => {
      const call = activeCalls.get(callId);
      if (!call || !canUseCallWhiteboard(call, userId)) return;

      const participantIds = [call.callerId, ...call.acceptedBy].filter(
        (participantId) =>
          participantId !== userId && !call.leftBy.has(participantId),
      );
      for (const participantId of participantIds) {
        const socketIds = userSockets.get(participantId);
        if (!socketIds) continue;
        for (const socketId of socketIds) {
          io.to(socketId).emit("call:whiteboard:clear", { callId, userId });
        }
      }
    });
  });
}
