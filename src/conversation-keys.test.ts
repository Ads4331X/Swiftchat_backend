import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, afterEach, beforeEach, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";

import prisma from "./prisma.js";

process.env.JWT_SECRET = "swiftchat-conversation-keys-test-secret";
const { default: conversationRoutes } = await import(
  "./routes/conversations.routes.js"
);

const originalDelegates = new Map<string, PropertyDescriptor | undefined>();
const delegateNames = [
  "conversation",
  "conversationMember",
  "conversationKeyPackage",
  "conversationKeyReceipt",
];
let memberExists = true;
let packages: {
  id: number;
  conversationId: number;
  userId: number;
  epoch: number;
  encryptedKey: string;
  nonce: string;
  senderUserId: number;
}[] = [];
let acknowledgedEpochs: number[] = [];
let packageQuery: Record<string, unknown> | undefined;

for (const name of delegateNames) {
  originalDelegates.set(
    name,
    Object.getOwnPropertyDescriptor(prisma, name),
  );
}

function installPrismaMocks() {
  Object.defineProperty(prisma, "conversation", {
    configurable: true,
    value: {
      findUnique: async () => ({ currentKeyEpoch: 4 }),
    },
  });
  Object.defineProperty(prisma, "conversationMember", {
    configurable: true,
    value: {
      findUnique: async () => (memberExists ? { id: 1 } : null),
    },
  });
  Object.defineProperty(prisma, "conversationKeyPackage", {
    configurable: true,
    value: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        packageQuery = where;
        const epochFilter = where.epoch as { lt: number };
        return packages
          .filter(
            (keyPackage) =>
              keyPackage.conversationId === where.conversationId &&
              keyPackage.userId === where.userId &&
              keyPackage.epoch < epochFilter.lt,
          )
          .map(({ id, epoch, encryptedKey, nonce, senderUserId }) => ({
            id,
            epoch,
            encryptedKey,
            nonce,
            senderUserId,
          }));
      },
    },
  });
  Object.defineProperty(prisma, "conversationKeyReceipt", {
    configurable: true,
    value: {
      findMany: async () => acknowledgedEpochs.map((epoch) => ({ epoch })),
    },
  });
}

function restorePrismaMocks() {
  for (const [name, descriptor] of originalDelegates) {
    if (descriptor) {
      Object.defineProperty(prisma, name, descriptor);
    } else {
      Reflect.deleteProperty(prisma, name);
    }
  }
}

async function request(
  path: string,
  userId?: number,
): Promise<Response> {
  const app = express();
  app.use("/api/conversations", conversationRoutes);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const headers: Record<string, string> = {};
    if (userId !== undefined) {
      headers.Authorization = `Bearer ${jwt.sign(
        { userId },
        process.env.JWT_SECRET!,
      )}`;
    }
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

beforeEach(() => {
  memberExists = true;
  packages = [];
  acknowledgedEpochs = [];
  packageQuery = undefined;
  installPrismaMocks();
});

afterEach(() => {
  restorePrismaMocks();
});

after(() => {
  restorePrismaMocks();
});

test("historical key packages require authentication", async () => {
  const response = await request("/api/conversations/12/keys");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("historical key packages require active conversation membership", async () => {
  memberExists = false;

  const response = await request("/api/conversations/12/keys", 7);

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "You are not a conversation member",
  });
});

test("returns only the authenticated user's historical packages and receipts", async () => {
  packages = [
    {
      id: 1,
      conversationId: 12,
      userId: 7,
      epoch: 2,
      encryptedKey: "encrypted-package",
      nonce: "package-nonce",
      senderUserId: 5,
    },
    {
      id: 2,
      conversationId: 12,
      userId: 8,
      epoch: 1,
      encryptedKey: "other-recipient-package",
      nonce: "other-nonce",
      senderUserId: 5,
    },
    {
      id: 3,
      conversationId: 12,
      userId: 7,
      epoch: 4,
      encryptedKey: "current-epoch-package",
      nonce: "current-nonce",
      senderUserId: 5,
    },
  ];
  acknowledgedEpochs = [1, 2];

  const response = await request("/api/conversations/12/keys", 7);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    currentKeyEpoch: 4,
    acknowledgedEpochs: [1, 2],
    packages: [
      {
        id: 1,
        epoch: 2,
        encryptedKey: "encrypted-package",
        nonce: "package-nonce",
        senderUserId: 5,
      },
    ],
  });
  assert.deepEqual(packageQuery, {
    conversationId: 12,
    userId: 7,
    epoch: { lt: 4 },
  });
});
