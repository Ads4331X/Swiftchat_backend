import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import jwt from "jsonwebtoken";
import type { Server, Socket } from "socket.io";

import prisma from "./prisma.js";

process.env.JWT_SECRET = "swiftchat-socket-test-secret";
const { setupSocket } = await import("./socket.js");

type SocketHandler = (...args: unknown[]) => unknown;

class TestSocket {
  readonly handshake: { auth: { token: string } };
  readonly handlers = new Map<string, SocketHandler>();
  readonly joinedRooms: string[] = [];
  userId?: number;

  constructor(
    readonly id: string,
    userId: number,
    token = jwt.sign({ userId }, process.env.JWT_SECRET!),
  ) {
    this.handshake = { auth: { token } };
  }

  on(event: string, handler: SocketHandler) {
    this.handlers.set(event, handler);
  }

  async join(room: string) {
    this.joinedRooms.push(room);
  }

  async trigger(event: string, ...args: unknown[]) {
    const handler = this.handlers.get(event);
    assert.ok(handler, `Expected a handler for ${event}`);
    await handler(...args);
  }
}

class TestIo {
  readonly emitted: {
    target: string;
    event: string;
    payload: unknown;
  }[] = [];
  middleware:
    | ((socket: TestSocket, next: (error?: Error) => void) => void)
    | undefined;
  connectionHandler:
    | ((socket: TestSocket) => Promise<void> | void)
    | undefined;

  use(handler: unknown) {
    this.middleware = handler as NonNullable<TestIo["middleware"]>;
  }

  on(event: string, handler: unknown) {
    if (event === "connection") {
      this.connectionHandler = handler as NonNullable<
        TestIo["connectionHandler"]
      >;
    }
  }

  to(target: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.emitted.push({ target, event, payload });
      },
    };
  }

  emit(event: string, payload: unknown) {
    this.emitted.push({ target: "broadcast", event, payload });
  }
}

const originalUserDelegate = prisma.user;
const originalMembershipDelegate = prisma.conversationMember;
let members: { conversationId: number; userId: number }[] = [];
let io: TestIo;

beforeEach(() => {
  members = [];
  io = new TestIo();
  Object.defineProperty(prisma, "user", {
    configurable: true,
    value: {
      update: async ({ data }: { data: { lastSeen: Date } }) => ({
        lastSeen: data.lastSeen,
      }),
    },
  });
  Object.defineProperty(prisma, "conversationMember", {
    configurable: true,
    value: {
      findMany: async ({ where }: { where: Record<string, number> }) => {
        if (where.conversationId) {
          return members.filter(
            (member) => member.conversationId === where.conversationId,
          );
        }
        if (where.userId) {
          return members.filter((member) => member.userId === where.userId);
        }
        return members;
      },
      findUnique: async ({
        where,
      }: {
        where: {
          conversationId_userId: { conversationId: number; userId: number };
        };
      }) =>
        members.find(
          (member) =>
            member.conversationId === where.conversationId_userId.conversationId &&
            member.userId === where.conversationId_userId.userId,
        ) ?? null,
      findFirst: async ({
        where,
      }: {
        where: { conversationId: number; userId: number };
      }) =>
        members.find(
          (member) =>
            member.conversationId === where.conversationId &&
            member.userId === where.userId,
        ) ?? null,
    },
  });
  setupSocket(io as unknown as Server);
});

afterEach(() => {
  Object.defineProperty(prisma, "user", {
    configurable: true,
    value: originalUserDelegate,
  });
  Object.defineProperty(prisma, "conversationMember", {
    configurable: true,
    value: originalMembershipDelegate,
  });
});

after(async () => {
  await prisma.$disconnect();
});

async function connect(userId: number, socketId: string, token?: string) {
  assert.ok(io.middleware);
  assert.ok(io.connectionHandler);
  const socket = new TestSocket(socketId, userId, token);
  let authError: Error | undefined;
  io.middleware(socket, (error) => {
    authError = error;
  });
  if (authError) throw authError;
  await io.connectionHandler(socket);
  return socket;
}

async function initiate(
  socket: TestSocket,
  conversationId: number,
  callType: "audio" | "video",
) {
  let response:
    | { success: boolean; data?: { callId: string }; error?: string }
    | undefined;
  await socket.trigger(
    "call:initiate",
    { conversationId, callType },
    (result: unknown) => {
      response = result as typeof response;
    },
  );
  assert.equal(response?.success, true, response?.error);
  assert.ok(response?.data?.callId);
  return response.data.callId;
}

test("authenticates sockets and requires conversation membership to start calls", async () => {
  const unauthorized = new TestSocket("bad-token", 9, "invalid");
  let authError: Error | undefined;
  io.middleware?.(unauthorized, (error) => {
    authError = error;
  });
  assert.ok(authError);

  const caller = await connect(901, "caller");
  members = [{ conversationId: 91, userId: 902 }];
  let response: { success: boolean; error?: string } | undefined;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await caller.trigger(
      "call:initiate",
      { conversationId: 91, callType: "audio" },
      (result: unknown) => {
        response = result as typeof response;
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response?.success, false);
  assert.ok(response?.error);
  assert.equal(
    io.emitted.some(({ event }) => event === "incoming-call"),
    false,
  );
});

test("group signaling, whiteboard validation, and final-socket disconnect clean up participants", async () => {
  members = [101, 102, 103].map((userId) => ({
    conversationId: 11,
    userId,
  }));
  const caller = await connect(101, "group-caller");
  const participant = await connect(102, "group-participant");
  const secondParticipantSocket = await connect(102, "group-participant-2");
  const otherParticipant = await connect(103, "group-other");
  const outsider = await connect(104, "group-outsider");
  const callId = await initiate(caller, 11, "video");

  await participant.trigger("call:accept", { callId });
  await otherParticipant.trigger("call:accept", { callId });
  const offer = { type: "offer", sdp: "mock-offer" };
  await caller.trigger("call:offer", {
    callId,
    receiverId: 102,
    offer,
  });
  assert.equal(
    io.emitted.filter(
      ({ target, event, payload }) =>
        ["group-participant", "group-participant-2"].includes(target) &&
        event === "call:offer" &&
        (payload as { offer?: unknown }).offer === offer,
    ).length,
    2,
  );
  const offerCount = io.emitted.filter(
    ({ event }) => event === "call:offer",
  ).length;
  await outsider.trigger("call:offer", {
    callId,
    receiverId: 102,
    offer,
  });
  assert.equal(
    io.emitted.filter(({ event }) => event === "call:offer").length,
    offerCount,
  );

  const answer = { type: "answer", sdp: "mock-answer" };
  await participant.trigger("call:answer", {
    callId,
    receiverId: 101,
    answer,
  });
  assert.equal(
    io.emitted.filter(
      ({ target, event, payload }) =>
        target === "group-caller" &&
        event === "call:answer" &&
        (payload as { answer?: unknown }).answer === answer,
    ).length,
    1,
  );
  await participant.trigger("call:ice-candidate", {
    callId,
    candidate: { candidate: "candidate:1" },
  });
  assert.equal(
    io.emitted.filter(
      ({ target, event }) =>
        ["group-caller", "group-other"].includes(target) &&
        event === "call:ice-candidate",
    ).length,
    2,
  );

  await participant.trigger("call:screen-share-state", {
    callId,
    isSharing: true,
  });

  const stroke = {
    id: "stroke-1",
    color: "#17212B",
    points: [{ x: 0.2, y: 0.4 }],
  };
  await participant.trigger("call:whiteboard:stroke", { callId, stroke });
  const validStrokeCount = io.emitted.filter(
    ({ event, payload }) =>
      event === "call:whiteboard:stroke" &&
      (payload as { stroke?: { id?: string } }).stroke?.id === stroke.id,
  ).length;
  assert.equal(validStrokeCount, 2);

  await outsider.trigger("call:whiteboard:clear", { callId });
  await outsider.trigger("call:whiteboard:stroke", {
    callId,
    stroke: { ...stroke, points: Array.from({ length: 501 }, () => ({ x: 0, y: 0 })) },
  });
  assert.equal(
    io.emitted.filter(({ event }) => event === "call:whiteboard:clear").length,
    0,
  );
  assert.equal(
    io.emitted.filter(({ event }) => event === "call:whiteboard:stroke").length,
    validStrokeCount,
  );

  const previousLeaveCount = io.emitted.filter(
    ({ event }) => event === "call:participant-left",
  ).length;
  await participant.trigger("disconnect");
  assert.equal(
    io.emitted.filter(({ event }) => event === "call:participant-left").length,
    previousLeaveCount,
  );

  await secondParticipantSocket.trigger("disconnect");
  const leaveEvents = io.emitted.filter(
    ({ event, payload }) =>
      event === "call:participant-left" &&
      (payload as { userId?: number }).userId === 102,
  );
  assert.deepEqual(
    leaveEvents.map(({ target }) => target).sort(),
    ["group-caller", "group-other"],
  );

  const previousShareStateCount = io.emitted.filter(
    ({ event, payload }) =>
      event === "call:screen-share-state" &&
      (payload as { userId?: number }).userId === 102,
  ).length;
  await participant.trigger("call:screen-share-state", {
    callId,
    isSharing: true,
  });
  await participant.trigger("call:whiteboard:clear", { callId });
  assert.equal(
    io.emitted.filter(
      ({ event, payload }) =>
        event === "call:screen-share-state" &&
        (payload as { userId?: number }).userId === 102,
    ).length,
    previousShareStateCount,
  );
  assert.equal(
    io.emitted.filter(({ event }) => event === "call:whiteboard:clear").length,
    0,
  );

  await outsider.trigger("join-conversation", "11");
  assert.equal(outsider.joinedRooms.includes("11"), false);
  await caller.trigger("call:end", { callId });
});

test("one-to-one calls end for the other participant after a disconnect", async () => {
  members = [201, 202].map((userId) => ({
    conversationId: 22,
    userId,
  }));
  const caller = await connect(201, "direct-caller");
  const receiver = await connect(202, "direct-receiver");
  const callId = await initiate(caller, 22, "audio");
  await receiver.trigger("call:accept", { callId });

  await receiver.trigger("disconnect");

  assert.deepEqual(
    io.emitted
      .filter(
        ({ target, event, payload }) =>
          target === "direct-caller" &&
          event === "call:ended" &&
          (payload as { callId?: string }).callId === callId,
      )
      .map(({ event }) => event),
    ["call:ended"],
  );
  await caller.trigger("disconnect");
});

test("group acceptance updates the caller immediately and later invitees can still join", async () => {
  members = [251, 252, 253].map((userId) => ({
    conversationId: 25,
    userId,
  }));
  const caller = await connect(251, "group-status-caller");
  const participantA = await connect(252, "group-status-a");
  const participantB = await connect(253, "group-status-b");
  const callId = await initiate(caller, 25, "video");

  await participantA.trigger("call:accept", { callId });
  await participantA.trigger("call:accept", { callId });

  assert.ok(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "group-status-caller" &&
        event === "call:accepted" &&
        (payload as { userId?: number }).userId === 252,
    ),
  );
  assert.equal(
    io.emitted.filter(
      ({ target, event, payload }) =>
        target === "group-status-caller" &&
        event === "call:accepted" &&
        (payload as { userId?: number }).userId === 252,
    ).length,
    1,
  );
  assert.ok(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "group-status-caller" &&
        event === "call:participant-status" &&
        (payload as { userId?: number; status?: string }).userId === 252 &&
        (payload as { status?: string }).status === "accepted",
    ),
  );
  assert.equal(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "group-status-b" &&
        event === "incoming-call" &&
        (payload as { callId?: string }).callId === callId,
    ),
    true,
  );

  await participantA.trigger("disconnect");
  assert.ok(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "group-status-caller" &&
        event === "call:participant-status" &&
        (payload as { userId?: number; status?: string }).userId === 252 &&
        (payload as { status?: string }).status === "disconnected",
    ),
  );
  assert.equal(
    io.emitted.some(
      ({ event, payload }) =>
        event === "call:ended" &&
        (payload as { callId?: string }).callId === callId,
    ),
    false,
  );

  await participantB.trigger("call:accept", { callId });
  assert.ok(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "group-status-caller" &&
        event === "call:accepted" &&
        (payload as { userId?: number }).userId === 253,
    ),
  );
  assert.equal(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "group-status-b" &&
        event === "call:accepted" &&
        (payload as { userId?: number; peerIds?: number[] }).userId === 253 &&
        (payload as { peerIds?: number[] }).peerIds?.includes(252),
    ),
    false,
  );
  assert.equal(
    io.emitted.filter(
      ({ target, event, payload }) =>
        target === "group-status-caller" &&
        event === "call:ended" &&
        (payload as { callId?: string }).callId === callId,
    ).length,
    0,
  );
});

test("a group decline does not end a call while an accepted participant remains", async () => {
  members = [261, 262, 263].map((userId) => ({
    conversationId: 26,
    userId,
  }));
  const caller = await connect(261, "group-decline-caller");
  const participantA = await connect(262, "group-decline-a");
  const participantB = await connect(263, "group-decline-b");
  const callId = await initiate(caller, 26, "audio");

  await participantA.trigger("call:accept", { callId });
  await participantB.trigger("call:decline", { callId });

  assert.ok(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "group-decline-a" &&
        event === "call:participant-status" &&
        (payload as { userId?: number; status?: string }).userId === 263 &&
        (payload as { status?: string }).status === "declined",
    ),
  );
  assert.equal(
    io.emitted.some(
      ({ event, payload }) =>
        event === "call:ended" &&
        (payload as { callId?: string }).callId === callId,
    ),
    false,
  );

  await caller.trigger("call:end", { callId });
});

test("a disconnected group-call host leaves the call running for accepted participants", async () => {
  members = [301, 302, 303].map((userId) => ({
    conversationId: 33,
    userId,
  }));
  const caller = await connect(301, "group-host");
  const participant = await connect(302, "group-attendee");
  const waitingParticipant = await connect(303, "group-waiting");
  const callId = await initiate(caller, 33, "video");
  await participant.trigger("call:accept", { callId });

  await caller.trigger("disconnect");

  assert.equal(
    io.emitted.filter(
      ({ event, payload }) =>
        event === "call:ended" &&
        (payload as { callId?: string }).callId === callId,
    ).length,
    0,
  );
  assert.ok(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "group-attendee" &&
        event === "call:participant-left" &&
        (payload as { userId?: number }).userId === 301,
    ),
  );
  assert.ok(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "group-waiting" &&
        event === "call:participant-left" &&
        (payload as { userId?: number }).userId === 301,
    ),
  );

  await participant.trigger("disconnect");
  await waitingParticipant.trigger("disconnect");
});

test("a callee can renegotiate media and receive the caller's answer", async () => {
  members = [321, 322].map((userId) => ({
    conversationId: 35,
    userId,
  }));
  const caller = await connect(321, "renegotiation-caller");
  const participant = await connect(322, "renegotiation-participant");
  const callId = await initiate(caller, 35, "audio");
  await participant.trigger("call:accept", { callId });

  const offer = { type: "offer", sdp: "screen-share-offer" };
  await participant.trigger("call:offer", {
    callId,
    receiverId: 321,
    offer,
  });
  assert.equal(
    io.emitted.filter(
      ({ target, event, payload }) =>
        target === "renegotiation-caller" &&
        event === "call:offer" &&
        (payload as { offer?: unknown }).offer === offer,
    ).length,
    1,
  );

  const answer = { type: "answer", sdp: "screen-share-answer" };
  await caller.trigger("call:answer", {
    callId,
    receiverId: 322,
    answer,
  });
  assert.equal(
    io.emitted.filter(
      ({ target, event, payload }) =>
        target === "renegotiation-participant" &&
        event === "call:answer" &&
        (payload as { answer?: unknown }).answer === answer,
    ).length,
    1,
  );

  await caller.trigger("call:end", { callId });
  await participant.trigger("disconnect");
});

test("an audio call can publish and receive screen-share state", async () => {
  members = [311, 312].map((userId) => ({
    conversationId: 34,
    userId,
  }));
  const caller = await connect(311, "audio-share-caller");
  const participant = await connect(312, "audio-share-participant");
  const callId = await initiate(caller, 34, "audio");
  await participant.trigger("call:accept", { callId });

  await participant.trigger("call:screen-share-state", {
    callId,
    isSharing: true,
  });

  assert.ok(
    io.emitted.some(
      ({ target, event, payload }) =>
        target === "audio-share-caller" &&
        event === "call:screen-share-state" &&
        (payload as { userId?: number; isSharing?: boolean }).userId === 312 &&
        (payload as { isSharing?: boolean }).isSharing === true,
    ),
  );

  await caller.trigger("call:end", { callId });
  await participant.trigger("disconnect");
});
