-- CreateTable
CREATE TABLE "PublicationApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "schedulerGroupKey" TEXT NOT NULL,
    "titleSnapshot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublicationApproval_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublicationApproval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicationApprovalComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approvalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublicationApprovalComment_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "PublicationApproval" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublicationApprovalComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublicationApprovalComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "PublicationApprovalComment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationApproval_companyId_schedulerGroupKey_key" ON "PublicationApproval"("companyId", "schedulerGroupKey");

-- CreateIndex
CREATE INDEX "PublicationApproval_companyId_status_idx" ON "PublicationApproval"("companyId", "status");

-- CreateIndex
CREATE INDEX "PublicationApprovalComment_approvalId_createdAt_idx" ON "PublicationApprovalComment"("approvalId", "createdAt");

-- CreateIndex
CREATE INDEX "PublicationApprovalComment_userId_createdAt_idx" ON "PublicationApprovalComment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PublicationApprovalComment_parentCommentId_idx" ON "PublicationApprovalComment"("parentCommentId");
