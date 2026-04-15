import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "avisos"
    ADD COLUMN IF NOT EXISTS "broadcastKey" TEXT,
    ADD COLUMN IF NOT EXISTS "iconKey" TEXT,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "avisos_kind_broadcastKey_idx"
    ON "avisos"("kind", "broadcastKey");
  `);

  console.log("Aviso broadcast schema is ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
