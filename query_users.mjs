import prisma from "./src/prisma.js";

const users = await prisma.user.findMany({
  select: { id: true, username: true, email: true },
  orderBy: { id: "asc" },
});
console.log("=== USERS IN DB ===");
console.log(JSON.stringify(users, null, 2));
console.log("=== TOTAL:", users.length, "===");

// Check for duplicate usernames
const usernames = users.map((u) => u.username);
const dupes = usernames.filter((u, i) => usernames.indexOf(u) !== i);
console.log("=== DUPLICATE USERNAMES:", dupes.length ? dupes : "none", "===");

await prisma.$disconnect();
