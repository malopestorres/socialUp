#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const envPath = path.join(repoRoot, ".env");

function parseEnvFile(content) {
  const parsed = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;

    const equalsIndex = normalizedLine.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, equalsIndex).trim();
    let value = normalizedLine.slice(equalsIndex + 1);

    const isDoubleQuoted = value.startsWith("\"") && value.endsWith("\"");
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'");

    if (isDoubleQuoted || isSingleQuoted) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(" #");
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex);
      }
      value = value.trim();
    }

    parsed[key] = value.replace(/\\n/g, "\n");
  }

  return parsed;
}

function loadEnvironment() {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  }
  return parsed;
}

function resolveDatabaseUrl() {
  const localEnv = loadEnvironment();
  return localEnv.DATABASE_URL || process.env.DATABASE_URL || "";
}

function parseDatabaseTarget(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname || "127.0.0.1";
  const port = Number.parseInt(parsed.port || "5432", 10);
  const databaseName = parsed.pathname.replace(/^\//, "") || "(default)";

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("DATABASE_URL possui porta inválida.");
  }

  return { host, port, databaseName };
}

function checkPortOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const done = (ok) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });

  return typeof result.status === "number" ? result.status : 1;
}

async function checkPrismaConnection() {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
    } finally {
      await prisma.$disconnect();
    }
    return { ok: true, error: "" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erro desconhecido ao validar Prisma.",
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(host, port, attempts = 20, delayMs = 1000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await checkPortOpen(host, port, 1500)) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

async function startPostgres(host, port) {
  const alreadyUp = await checkPortOpen(host, port);
  if (alreadyUp) {
    console.log(`PostgreSQL já está ativo em ${host}:${port}.`);
    return 0;
  }

  const brewCheck = spawnSync("brew", ["--version"], { stdio: "ignore", shell: false });
  if ((brewCheck.status ?? 1) !== 0) {
    console.error("Homebrew não encontrado. Suba o PostgreSQL manualmente e rode novamente.");
    return 1;
  }

  console.log("PostgreSQL indisponível. Tentando iniciar via `brew services start postgresql@16`...");
  const startCode = runCommand("brew", ["services", "start", "postgresql@16"]);
  if (startCode !== 0) {
    return startCode;
  }

  const becameUp = await waitForPort(host, port, 20, 1000);
  if (!becameUp) {
    console.error(`Não foi possível subir PostgreSQL em ${host}:${port}.`);
    console.error("Se você usa Postgres.app, abra o app e garanta que a porta 5432 está ativa.");
    return 1;
  }

  console.log(`PostgreSQL iniciado com sucesso em ${host}:${port}.`);
  return 0;
}

function stopPostgres() {
  return runCommand("brew", ["services", "stop", "postgresql@16"]);
}

async function showStatus(host, port, databaseName) {
  const online = await checkPortOpen(host, port, 1500);
  console.log(`PostgreSQL TCP (${host}:${port}): ${online ? "ONLINE" : "OFFLINE"}`);
  console.log(`Database alvo (DATABASE_URL): ${databaseName}`);

  if (!online) {
    return 1;
  }

  const prismaCheck = await checkPrismaConnection();
  if (prismaCheck.ok) {
    console.log("Prisma check: OK");
    return 0;
  }

  console.log("Prisma check: FALHOU");
  console.log(prismaCheck.error);
  return 1;
}

async function main() {
  const command = (process.argv[2] || "status").toLowerCase();
  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    console.error("DATABASE_URL não encontrada em .env.");
    process.exit(1);
  }

  let target;
  try {
    target = parseDatabaseTarget(databaseUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "DATABASE_URL inválida.");
    process.exit(1);
  }

  if (command === "status") {
    const code = await showStatus(target.host, target.port, target.databaseName);
    process.exit(code);
  }

  if (command === "start") {
    const startCode = await startPostgres(target.host, target.port);
    if (startCode !== 0) {
      process.exit(startCode);
    }

    const statusCode = await showStatus(target.host, target.port, target.databaseName);
    process.exit(statusCode);
  }

  if (command === "stop") {
    const stopCode = stopPostgres();
    process.exit(stopCode);
  }

  console.error("Uso: node scripts/db-service.mjs <start|status|stop>");
  process.exit(1);
}

await main();
