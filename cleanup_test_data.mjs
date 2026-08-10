import prisma from "./src/prisma.js";

// Delete all test users and conversations
await prisma.conversationMember.deleteMany({});
await prisma.conversation.deleteMany({});
await prisma.user.deleteMany({
  where: {
    OR: [
      { username: { startsWith: "test_" } },
      { email: { contains: "@test.com" } },
    ],
  },
});

console.log("Test data cleaned");

await prisma.$disconnect();
