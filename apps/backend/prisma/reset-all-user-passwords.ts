import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/security.js";

const NEW_PASSWORD = "SocialUp@2026!";

function redactDatabaseUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return "<invalid DATABASE_URL>";
  }
}

async function main(): Promise<void> {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_MISSING");
  }

  const prisma = new PrismaClient();
  try {
    const totalUsers = await prisma.user.count();
    const passwordHash = hashPassword(NEW_PASSWORD);

    const result = await prisma.user.updateMany({
      data: {
        passwordHash,
        sessionToken: null,
        sessionIssuedAt: null,
      },
    });

    console.log("Database:", redactDatabaseUrl(databaseUrl));
    console.log("Users total:", totalUsers);
    console.log("Users updated:", result.count);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
