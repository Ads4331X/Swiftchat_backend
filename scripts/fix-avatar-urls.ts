import "dotenv/config";
import prisma from "../src/prisma.js";

async function main() {
  const users = await prisma.user.findMany({
    where: {
      avatar: {
        // Matches the corrupted double-version URLs, e.g.
        // .../image/upload/v1790247792355/v1790247791/swiftchat/avatars/1.png
        contains: "/v",
      },
    },
    select: { id: true, username: true, avatar: true },
  });

  const corrupted = users.filter((u) => /\/upload\/v\d+\/v\d+\//.test(u.avatar));
  if (corrupted.length === 0) {
    console.log("No corrupted avatar URLs found.");
    return;
  }

  console.log(`Fixing ${corrupted.length} corrupted avatar URL(s)...`);
  for (const user of corrupted) {
    console.log(`- id=${user.id} username=${user.username}: ${user.avatar}`);
    await prisma.user.update({
      where: { id: user.id },
      data: { avatar: "" },
    });
  }
  console.log("Done. Re-upload the avatar to store a valid URL.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());