import type { Request, Response, NextFunction } from "express";
import { prisma, withPrismaConnectionRetry } from "./prisma.js";

export type AdminUserAuth = {
  id: string;
  username: string;
  name: string;
  timeZone: string;
  role: string;
};

export async function adminAuthMiddleware(
  request: Request & { adminUser?: AdminUserAuth },
  response: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    response.status(401).json({ error: "Sessao invalida ou expirada." });
    return;
  }

  const sessionToken = authHeader.slice("Bearer ".length).trim();

  if (!sessionToken) {
    response.status(401).json({ error: "Sessao invalida ou expirada." });
    return;
  }

  let user:
    | {
        id: string;
        username: string;
        name: string;
        timeZone: string;
        role: string;
      }
    | null = null;

  try {
    user = await withPrismaConnectionRetry(
      () =>
        prisma.user.findFirst({
          where: { sessionToken },
          select: {
            id: true,
            username: true,
            name: true,
            timeZone: true,
            role: true,
          },
        }),
      { maxAttempts: 3, retryDelayMs: 350 },
    );
  } catch {
    response.status(503).json({ error: "Banco temporariamente indisponível. Tente novamente." });
    return;
  }

  if (!user) {
    response.status(401).json({ error: "Sessao invalida ou expirada." });
    return;
  }

  request.adminUser = user;
  next();
}
