import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const rows = await prisma.socialConnection.findMany({
    where: {
      provider: "POST_FOR_ME",
      platform: "tiktok",
    },
    select: {
      id: true,
      companyId: true,
      displayName: true,
      loginIdentifier: true,
      authStatus: true,
      providerStatus: true,
      providerAccountId: true,
      providerExternalId: true,
      tokenExpiresAt: true,
      company: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  console.log(JSON.stringify(rows, null, 2));
} finally {
  await prisma.$disconnect();
}
