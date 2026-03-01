import { PrismaClient } from "@prisma/client";
import { createRandomToken, hashPassword } from "../src/security.js";

const prisma = new PrismaClient();
const ROOT_USERNAME = "root";
const ROOT_PASSWORD = "Root@SocialUp2026!";

async function main() {
  const passwordHash = hashPassword(ROOT_PASSWORD);

  const rootUser = await prisma.user.upsert({
    where: { username: ROOT_USERNAME },
    update: {
      name: "Root",
      passwordHash,
      role: "ROOT",
      sessionToken: null,
      sessionIssuedAt: null,
    },
    create: {
      name: "Root",
      username: ROOT_USERNAME,
      passwordHash,
      role: "ROOT",
    },
  });

  let invite = await prisma.setupInvite.findFirst({
    where: { usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!invite) {
    invite = await prisma.setupInvite.create({
      data: {
        inviteKey: createRandomToken(16),
      },
    });
  }

  console.log("Root user seeded.");
  console.log(`Username: ${ROOT_USERNAME}`);
  console.log(`Password: ${ROOT_PASSWORD}`);
  console.log(`Setup key: ${invite.inviteKey}`);
  console.log(`Setup URL: http://localhost:5173/?setupKey=${invite.inviteKey}`);
  console.log(`User ID: ${rootUser.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
