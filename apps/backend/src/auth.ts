import type { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma.js";

export interface AgentAuthContext {
  id: string;
  companyId: string;
  token: string;
  deviceId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      agentAuth?: AgentAuthContext;
    }
  }
}

export async function agentAuthMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const token = request.header("x-agent-token");
  const deviceId = request.header("x-agent-device-id");
  if (!token) {
    response.status(401).json({ error: "Missing x-agent-token header." });
    return;
  }

  if (!deviceId) {
    response.status(401).json({ error: "Missing x-agent-device-id header." });
    return;
  }

  const agent = await prisma.agent.findUnique({
    where: { token },
    select: { id: true, companyId: true, token: true, deviceId: true, activationStatus: true, revokedAt: true },
  });

  if (!agent) {
    response.status(401).json({ error: "Invalid agent token." });
    return;
  }

  if (agent.activationStatus !== "ACTIVE" || agent.revokedAt || agent.deviceId !== deviceId) {
    response.status(401).json({ error: "Agent access revoked or bound to another device." });
    return;
  }

  request.agentAuth = agent;
  await prisma.agent.update({
    where: { id: agent.id },
    data: { lastSeenAt: new Date() },
  });
  next();
}

export function ensureAgentOwnsCompany(request: Request, companyId: string): boolean {
  return request.agentAuth?.companyId === companyId;
}
