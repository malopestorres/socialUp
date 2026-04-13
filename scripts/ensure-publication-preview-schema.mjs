import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PublicationApproval" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "companyId" TEXT NOT NULL,
      "schedulerGroupKey" TEXT NOT NULL,
      "titleSnapshot" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "decidedByUserId" TEXT,
      "decidedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PublicationApproval_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PublicationApproval_decidedByUserId_fkey"
        FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PublicationApprovalComment" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "approvalId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "parentCommentId" TEXT,
      "message" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PublicationApprovalComment_approvalId_fkey"
        FOREIGN KEY ("approvalId") REFERENCES "PublicationApproval"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PublicationApprovalComment_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PublicationApprovalComment_parentCommentId_fkey"
        FOREIGN KEY ("parentCommentId") REFERENCES "PublicationApprovalComment"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "PublicationApproval_companyId_schedulerGroupKey_key"
    ON "PublicationApproval"("companyId", "schedulerGroupKey");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PublicationApproval_companyId_status_idx"
    ON "PublicationApproval"("companyId", "status");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PublicationApprovalComment_approvalId_createdAt_idx"
    ON "PublicationApprovalComment"("approvalId", "createdAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PublicationApprovalComment_userId_createdAt_idx"
    ON "PublicationApprovalComment"("userId", "createdAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PublicationApprovalComment_parentCommentId_idx"
    ON "PublicationApprovalComment"("parentCommentId");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PublicationApprovalCommentReaction" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "commentId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "emoji" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PublicationApprovalCommentReaction_commentId_fkey"
        FOREIGN KEY ("commentId") REFERENCES "PublicationApprovalComment"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PublicationApprovalCommentReaction_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "PublicationApprovalCommentReaction_commentId_userId_emoji_key"
    ON "PublicationApprovalCommentReaction"("commentId", "userId", "emoji");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PublicationApprovalCommentReaction_commentId_createdAt_idx"
    ON "PublicationApprovalCommentReaction"("commentId", "createdAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PublicationApprovalCommentReaction_userId_createdAt_idx"
    ON "PublicationApprovalCommentReaction"("userId", "createdAt");
  `);

  console.log("Publication preview schema is ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
