ALTER TABLE "User"
  ADD COLUMN "email" TEXT,
  ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "UserAuthProvider" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "email" TEXT,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "displayName" TEXT,
  "avatarUrl" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserAuthProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserAuthProvider_provider_providerUserId_key" ON "UserAuthProvider"("provider", "providerUserId");
CREATE UNIQUE INDEX "UserAuthProvider_userId_provider_key" ON "UserAuthProvider"("userId", "provider");
CREATE INDEX "UserAuthProvider_email_idx" ON "UserAuthProvider"("email");

ALTER TABLE "UserAuthProvider"
  ADD CONSTRAINT "UserAuthProvider_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
