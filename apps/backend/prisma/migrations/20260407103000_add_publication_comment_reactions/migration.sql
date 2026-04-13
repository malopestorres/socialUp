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

CREATE UNIQUE INDEX IF NOT EXISTS "PublicationApprovalCommentReaction_commentId_userId_emoji_key"
ON "PublicationApprovalCommentReaction"("commentId", "userId", "emoji");

CREATE INDEX IF NOT EXISTS "PublicationApprovalCommentReaction_commentId_createdAt_idx"
ON "PublicationApprovalCommentReaction"("commentId", "createdAt");

CREATE INDEX IF NOT EXISTS "PublicationApprovalCommentReaction_userId_createdAt_idx"
ON "PublicationApprovalCommentReaction"("userId", "createdAt");
