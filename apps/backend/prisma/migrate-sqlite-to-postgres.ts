import { PrismaClient } from "@prisma/client";
import { PrismaClient as SqlitePrismaClient } from "../src/generated/sqlite-client/index.js";
import { loadBackendEnv } from "../src/env-loader.js";

loadBackendEnv();

const SOURCE_SQLITE_URL = (process.env.SOURCE_SQLITE_URL || "file:./dev.db").trim();

const postgres = new PrismaClient();
const sqlite = new SqlitePrismaClient({
  datasources: {
    db: {
      url: SOURCE_SQLITE_URL,
    },
  },
});

function nowIso(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  console.log(`[${nowIso()}] Starting SQLite -> PostgreSQL migration`);
  console.log(`[${nowIso()}] Source SQLite URL: ${SOURCE_SQLITE_URL}`);
  console.log(`[${nowIso()}] Target PostgreSQL URL: ${process.env.DATABASE_URL ? "configured" : "missing"}`);

  const [
    users,
    setupInvites,
    companies,
    agents,
    socialConnections,
    jobs,
    agentLogs,
    appSettings,
    avisos,
  ] = await Promise.all([
    sqlite.user.findMany(),
    sqlite.setupInvite.findMany(),
    sqlite.company.findMany(),
    sqlite.agent.findMany(),
    sqlite.socialConnection.findMany(),
    sqlite.job.findMany(),
    sqlite.agentLog.findMany(),
    sqlite.appSetting.findMany(),
    sqlite.aviso.findMany(),
  ]);

  console.log(`[${nowIso()}] Rows read from SQLite`);
  console.table({
    users: users.length,
    setupInvites: setupInvites.length,
    companies: companies.length,
    agents: agents.length,
    socialConnections: socialConnections.length,
    jobs: jobs.length,
    agentLogs: agentLogs.length,
    appSettings: appSettings.length,
    avisos: avisos.length,
  });

  await postgres.$transaction(async (tx) => {
    await tx.aviso.deleteMany();
    await tx.agentLog.deleteMany();
    await tx.job.deleteMany();
    await tx.socialConnection.deleteMany();
    await tx.agent.deleteMany();
    await tx.company.deleteMany();
    await tx.setupInvite.deleteMany();
    await tx.appSetting.deleteMany();
    await tx.user.deleteMany();

    if (users.length > 0) {
      await tx.user.createMany({ data: users });
    }
    if (setupInvites.length > 0) {
      await tx.setupInvite.createMany({ data: setupInvites });
    }
    if (companies.length > 0) {
      await tx.company.createMany({ data: companies });
    }
    if (agents.length > 0) {
      await tx.agent.createMany({ data: agents });
    }
    if (socialConnections.length > 0) {
      await tx.socialConnection.createMany({ data: socialConnections });
    }
    if (jobs.length > 0) {
      await tx.job.createMany({ data: jobs });
    }
    if (agentLogs.length > 0) {
      await tx.agentLog.createMany({ data: agentLogs });
    }
    if (appSettings.length > 0) {
      await tx.appSetting.createMany({ data: appSettings });
    }
    if (avisos.length > 0) {
      await tx.aviso.createMany({ data: avisos });
    }
  });

  console.log(`[${nowIso()}] Migration finished successfully.`);
}

main()
  .catch((error) => {
    console.error(`[${nowIso()}] Migration failed`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([sqlite.$disconnect(), postgres.$disconnect()]);
  });
