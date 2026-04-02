import { Prisma, PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __socialupPrisma__: PrismaClient | undefined;
}

export const prisma = globalThis.__socialupPrisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__socialupPrisma__ = prisma;
}

function normalizePrismaErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }

  return String(error ?? "").toLowerCase();
}

export function isRetryablePrismaConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P1017" || error.code === "P1001";
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    const message = normalizePrismaErrorMessage(error);
    return (
      message.includes("server has closed the connection") ||
      message.includes("connection terminated unexpectedly") ||
      message.includes("can't reach database server") ||
      message.includes("connection closed")
    );
  }

  const message = normalizePrismaErrorMessage(error);
  return (
    message.includes("server has closed the connection") ||
    message.includes("connection terminated unexpectedly") ||
    message.includes("can't reach database server") ||
    message.includes("connection closed")
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withPrismaConnectionRetry<T>(
  operation: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    retryDelayMs?: number;
  },
): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 2);
  const retryDelayMs = Math.max(50, options?.retryDelayMs ?? 250);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryablePrismaConnectionError(error) || attempt >= maxAttempts) {
        throw error;
      }

      await prisma.$disconnect().catch(() => undefined);
      await wait(retryDelayMs);
      await prisma.$connect().catch(() => undefined);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("PRISMA_RETRY_FAILED");
}
