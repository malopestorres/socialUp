import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function needsRenewal(connection, now) {
  return (
    connection.authStatus === "AUTH_REQUIRED" ||
    (connection.tokenExpiresAt instanceof Date && connection.tokenExpiresAt.getTime() <= now.getTime())
  );
}

function platformLabel(platform) {
  switch (platform) {
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "threads":
      return "Threads";
    case "tiktok":
      return "TikTok";
    case "x":
      return "X";
    default:
      return platform;
  }
}

function accountLabel(connection) {
  const login = (connection.loginIdentifier || "").trim();
  if (login) {
    return login.startsWith("@") ? login : `@${login}`;
  }

  return connection.displayName;
}

function defaultAuthLaunchUrl(platform) {
  return `/connections?platform=${encodeURIComponent(platform)}&intent=renew`;
}

async function main() {
  const now = new Date();
  const rootUsers = await prisma.user.findMany({
    where: { role: "ROOT" },
    select: { id: true },
  });
  const rootUserIds = rootUsers.map((row) => row.id.trim()).filter(Boolean);

  const connections = await prisma.socialConnection.findMany({
    where: {
      provider: "POST_FOR_ME",
      OR: [
        { authStatus: "AUTH_REQUIRED" },
        { tokenExpiresAt: { lte: now } },
      ],
    },
    select: {
      id: true,
      companyId: true,
      platform: true,
      displayName: true,
      loginIdentifier: true,
      authStatus: true,
      tokenExpiresAt: true,
      authLaunchUrl: true,
      company: {
        select: {
          name: true,
          createdByUserId: true,
          members: {
            select: {
              userId: true,
            },
          },
        },
      },
    },
  });

  let connectionsNeedingRenewal = 0;
  let avisosCreated = 0;
  let connectionsUpdated = 0;

  for (const connection of connections) {
    if (!needsRenewal(connection, now)) {
      continue;
    }

    connectionsNeedingRenewal += 1;

    if (!connection.authLaunchUrl) {
      await prisma.socialConnection.update({
        where: { id: connection.id },
        data: {
          authLaunchUrl: defaultAuthLaunchUrl(connection.platform),
        },
      });
      connectionsUpdated += 1;
    }

    const userIds = new Set();
    const ownerId = (connection.company.createdByUserId || "").trim();
    if (ownerId) {
      userIds.add(ownerId);
    }

    for (const member of connection.company.members) {
      const userId = (member.userId || "").trim();
      if (userId) {
        userIds.add(userId);
      }
    }

    for (const rootUserId of rootUserIds) {
      if (rootUserId) {
        userIds.add(rootUserId);
      }
    }

    const title = "Conta precisa de renovação";
    const message =
      `${platformLabel(connection.platform)} ${accountLabel(connection)} expirou e precisa de renovação ` +
      `no workspace ${connection.company.name}.`;
    const targetUserIds = [...userIds];
    if (targetUserIds.length === 0) {
      continue;
    }

    const existingAvisos = await prisma.aviso.findMany({
      where: {
        userId: { in: targetUserIds },
        title,
        message,
        createdAt: {
          gte: new Date(Date.now() - DEDUPE_WINDOW_MS),
        },
      },
      select: {
        userId: true,
      },
    });
    const existingUserIds = new Set(existingAvisos.map((row) => row.userId));
    const missingUserIds = targetUserIds.filter((userId) => !existingUserIds.has(userId));

    if (missingUserIds.length === 0) {
      continue;
    }

    await prisma.aviso.createMany({
      data: missingUserIds.map((userId) => ({
        userId,
        title,
        message,
        kind: "SYSTEM",
        createdByUserId: null,
      })),
    });
    avisosCreated += missingUserIds.length;
  }

  console.log(
    JSON.stringify(
      {
        connectionsNeedingRenewal,
        avisosCreated,
        connectionsUpdated,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
