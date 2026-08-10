import prisma from "./src/prisma.js";

// List tables
try {
  const tables =
    await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  console.log("TABLES:", JSON.stringify(tables));
} catch (e) {
  console.log("TABLES ERROR:", e.message);
}

// Try conversation findMany (the GET route)
try {
  const convs = await prisma.conversation.findMany({
    include: {
      members: { include: { user: { select: { id: true, username: true } } } },
    },
  });
  console.log("findMany OK:", JSON.stringify(convs));
} catch (e) {
  console.log("findMany ERROR:", e.message);
  console.log("findMany ERROR CODE:", e.code);
}

// Try creating a conversation
try {
  const conv = await prisma.conversation.create({
    data: {
      members: { create: [{ userId: 1 }, { userId: 6 }] },
    },
  });
  console.log("create OK:", JSON.stringify(conv));
} catch (e) {
  console.log("create ERROR:", e.message);
  console.log("create ERROR CODE:", e.code);
}

await prisma.$disconnect();
