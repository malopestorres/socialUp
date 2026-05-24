import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.socialConnection.findMany({
    where: { platform: "whatsapp" },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      companyId: true,
      displayName: true,
      authStatus: true,
      loginIdentifier: true,
      lastAuthAt: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true,
      providerMetadata: true,
    },
  });

  // Keep output concise/readable for quick diagnostics.
  for (const item of items) {
    console.log(
      JSON.stringify(
        {
          id: item.id,
          companyId: item.companyId,
          displayName: item.displayName,
          authStatus: item.authStatus,
          loginIdentifier: item.loginIdentifier,
          lastAuthAt: item.lastAuthAt,
          lastSeenAt: item.lastSeenAt,
          updatedAt: item.updatedAt,
          providerMetadata: item.providerMetadata,
        },
        null,
        0,
      ),
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

