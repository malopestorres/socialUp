import type { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma.js";

export type AdminUserAuth = {
  id: string;
  username: string;
  name: string;
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

  const user = await prisma.user.findFirst({
    where: { sessionToken },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
    },
  });

  if (!user) {
    response.status(401).json({ error: "Sessao invalida ou expirada." });
    return;
  }

  request.adminUser = user;
  next();
}
