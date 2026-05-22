import { PrismaClient } from "@prisma/client";
import { loadBackendEnv } from "./env-loader.js";

loadBackendEnv();

try {
  const bootstrapUrl = import.meta.url || "";
  const mode = bootstrapUrl.includes("/dist/") ? "dist" : bootstrapUrl.includes("/src/") ? "src" : "unknown";
  console.log(`[bootstrap] mode=${mode}`);
} catch {
  // ignore
}

const DATABASE_BOOT_ATTEMPTS = parsePositiveInt(process.env.BACKEND_DB_BOOT_ATTEMPTS, 20);
const DATABASE_BOOT_DELAY_MS = parsePositiveInt(process.env.BACKEND_DB_BOOT_DELAY_MS, 1_500);

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeDatabaseTarget(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    return "DATABASE_URL não configurada";
  }

  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname || "localhost";
    const port = parsed.port || "5432";
    const database = parsed.pathname.replace(/^\//, "") || "(default)";
    return `${host}:${port}/${database}`;
  } catch {
    return databaseUrl;
  }
}

async function waitForDatabaseReady(): Promise<void> {
  const databaseTarget = describeDatabaseTarget(process.env.DATABASE_URL);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= DATABASE_BOOT_ATTEMPTS; attempt += 1) {
    const prisma = new PrismaClient();
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      await prisma.$disconnect();
      if (attempt > 1) {
        console.log(`[bootstrap] Banco disponível em ${databaseTarget} após ${attempt} tentativa(s).`);
      }
      return;
    } catch (error) {
      lastError = error;
      await prisma.$disconnect().catch(() => undefined);

      if (attempt < DATABASE_BOOT_ATTEMPTS) {
        console.warn(
          `[bootstrap] Aguardando banco em ${databaseTarget} (${attempt}/${DATABASE_BOOT_ATTEMPTS})...`,
        );
        await sleep(DATABASE_BOOT_DELAY_MS);
      }
    }
  }

  const lastMessage = lastError instanceof Error ? lastError.message : "Erro desconhecido ao conectar no banco.";
  throw new Error(
    `Banco indisponível em ${databaseTarget}. ` +
      `Verifique se o PostgreSQL de destino está ativo e se a DATABASE_URL está correta antes de subir o backend.\n` +
      lastMessage,
  );
}

await waitForDatabaseReady();
await import("./index.js");
