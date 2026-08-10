import prisma from "./src/prisma.js";

try {
  await prisma.user.create({
    data: {
      username: "test_bob", // already exists
      email: "unique_new_email_123@test.com",
      password_hash: "hash",
    },
  });
  console.log("Create succeeded (unexpected)");
} catch (e) {
  console.log("CODE:", e.code);
  console.log("META:", JSON.stringify(e.meta));
  console.log("target:", JSON.stringify(e.meta?.target));
  console.log("target[0]:", e.meta?.target?.[0]);
}

await prisma.$disconnect();
