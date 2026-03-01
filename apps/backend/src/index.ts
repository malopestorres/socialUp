import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PublicationType, WhatsappMode } from "@socialup/shared";
import { z } from "zod";
import { adminAuthMiddleware } from "./admin-auth.js";
import { agentAuthMiddleware, ensureAgentOwnsCompany } from "./auth.js";
import { prisma } from "./prisma.js";
import { createRandomToken, verifyPassword, hashPassword } from "./security.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../uploads");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_request, file, callback) => {
    const uniquePrefix = `${Date.now()}-${createRandomToken(4)}`;
    callback(null, `${uniquePrefix}-${file.originalname.replace(/\s+/g, "_")}`);
  },
});

const upload = multer({ storage });

const createOrganizationSchema = z.object({
  name: z.string().min(2),
});

const createCompanySchema = z.object({
  name: z.string().min(2),
  organizationId: z.string().min(1),
});

const createAgentSchema = z.object({
  name: z.string().min(2),
  companyId: z.string().min(1),
});

const pairAgentSchema = z.object({
  activationCode: z.string().min(1),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const setupInviteQuerySchema = z.object({
  key: z.string().min(1),
});

const createUserFromInviteSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(2).max(80),
  username: z.string().min(3).max(32).regex(/^[a-z0-9._-]+$/i),
  password: z.string().min(8).max(128),
});

const updateProfileSchema = z.object({
  name: z.string().min(2).max(80),
  username: z.string().min(3).max(32).regex(/^[a-z0-9._-]+$/i),
  password: z.string().min(8).max(128).optional().or(z.literal("")),
});

const createJobSchema = z.object({
  companyId: z.string().min(1),
  filePath: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  publicationType: z.enum([
    "instagram_story",
    "instagram_reel",
    "instagram_post",
    "whatsapp_status_midia",
    "whatsapp_status_texto",
  ]),
  dataPostagem: z.string().datetime(),
});

const updateJobSchema = z.object({
  companyId: z.string().min(1),
  filePath: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  publicationType: z.enum([
    "instagram_story",
    "instagram_reel",
    "instagram_post",
    "whatsapp_status_midia",
    "whatsapp_status_texto",
  ]),
  dataPostagem: z.string().datetime(),
});

function deriveLegacyJobFields(publicationType: PublicationType): {
  postStory: boolean;
  postReel: boolean;
  postWhatsapp: boolean;
  modoWhatsapp: WhatsappMode;
} {
  switch (publicationType) {
    case "instagram_story":
      return { postStory: true, postReel: false, postWhatsapp: false, modoWhatsapp: "midia" };
    case "instagram_reel":
      return { postStory: false, postReel: true, postWhatsapp: false, modoWhatsapp: "midia" };
    case "instagram_post":
      return { postStory: false, postReel: false, postWhatsapp: false, modoWhatsapp: "midia" };
    case "whatsapp_status_midia":
      return { postStory: false, postReel: false, postWhatsapp: true, modoWhatsapp: "midia" };
    case "whatsapp_status_texto":
      return { postStory: false, postReel: false, postWhatsapp: true, modoWhatsapp: "texto" };
  }
}

function normalizePublicationType(job: {
  publicationType?: string | null;
  postStory?: boolean;
  postReel?: boolean;
  postWhatsapp?: boolean;
  modoWhatsapp?: string | null;
}): PublicationType {
  if (
    job.publicationType === "instagram_story" ||
    job.publicationType === "instagram_reel" ||
    job.publicationType === "instagram_post" ||
    job.publicationType === "whatsapp_status_midia" ||
    job.publicationType === "whatsapp_status_texto"
  ) {
    return job.publicationType;
  }

  if (job.postStory) {
    return "instagram_story";
  }

  if (job.postReel) {
    return "instagram_reel";
  }

  if (job.postWhatsapp && job.modoWhatsapp === "texto") {
    return "whatsapp_status_texto";
  }

  if (job.postWhatsapp) {
    return "whatsapp_status_midia";
  }

  return "instagram_post";
}

function ensureFilePathForPublication(publicationType: PublicationType, filePath?: string | null): string {
  if (publicationType === "whatsapp_status_texto") {
    return filePath ?? "";
  }

  if (!filePath || filePath.trim().length === 0) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["filePath"],
        message: "Este tipo de publicacao exige uma midia.",
      },
    ]);
  }

  return filePath;
}

function createAgentToken(): string {
  return createRandomToken();
}

async function appendLog(input: {
  companyId: string;
  agentId?: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
}): Promise<void> {
  await prisma.agentLog.create({
    data: {
      companyId: input.companyId,
      agentId: input.agentId,
      level: input.level,
      message: input.message,
    },
  });
}

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/auth/setup-access", async (request, response) => {
  const query = setupInviteQuerySchema.parse(request.query);
  const invite = await prisma.setupInvite.findFirst({
    where: {
      inviteKey: query.key,
      usedAt: null,
    },
    select: {
      inviteKey: true,
      createdAt: true,
    },
  });

  if (!invite) {
    response.status(404).json({ error: "Chave de cadastro invalida ou ja utilizada." });
    return;
  }

  response.json({
    valid: true,
    inviteKey: invite.inviteKey,
    createdAt: invite.createdAt,
  });
});

app.post("/auth/setup-access", async (request, response) => {
  const payload = createUserFromInviteSchema.parse(request.body);

  const invite = await prisma.setupInvite.findFirst({
    where: {
      inviteKey: payload.key,
      usedAt: null,
    },
  });

  if (!invite) {
    response.status(404).json({ error: "Chave de cadastro invalida ou ja utilizada." });
    return;
  }

  const existingUser = await prisma.user.findUnique({
    where: { username: payload.username },
  });

  if (existingUser) {
    response.status(409).json({ error: "Ja existe um usuario com esse username." });
    return;
  }

  const user = await prisma.$transaction(async (transaction) => {
    const createdUser = await transaction.user.create({
      data: {
        name: payload.name,
        username: payload.username,
        passwordHash: hashPassword(payload.password),
        role: "ADMIN",
      },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });

    await transaction.setupInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });

    return createdUser;
  });

  response.status(201).json(user);
});

app.post("/auth/login", async (request, response) => {
  const payload = loginSchema.parse(request.body);
  const user = await prisma.user.findUnique({
    where: { username: payload.username },
  });

  if (!user || !verifyPassword(payload.password, user.passwordHash)) {
    response.status(401).json({ error: "Username ou senha invalidos." });
    return;
  }

  const sessionToken = createRandomToken();
  const authenticatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      sessionToken,
      sessionIssuedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
    },
  });

  response.json({
    sessionToken,
    user: authenticatedUser,
  });
});

app.get("/auth/me", adminAuthMiddleware, async (request, response) => {
  const user = (request as Request & { adminUser?: { id: string; name: string; username: string; role: string } }).adminUser!;
  response.json({ user });
});

app.put("/auth/profile", adminAuthMiddleware, async (request, response) => {
  const user = (request as Request & { adminUser?: { id: string } }).adminUser!;
  const payload = updateProfileSchema.parse(request.body);

  const usernameOwner = await prisma.user.findUnique({
    where: { username: payload.username },
    select: { id: true },
  });

  if (usernameOwner && usernameOwner.id !== user.id) {
    response.status(409).json({ error: "Ja existe um usuário com esse login." });
    return;
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      name: payload.name,
      username: payload.username,
      passwordHash: payload.password ? hashPassword(payload.password) : undefined,
    },
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
    },
  });

  response.json({ user: updatedUser });
});

app.post("/auth/logout", adminAuthMiddleware, async (request, response) => {
  const user = (request as Request & { adminUser?: { id: string } }).adminUser!;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      sessionToken: null,
      sessionIssuedAt: null,
    },
  });
  response.status(204).send();
});

app.use(["/organizations", "/companies", "/agents", "/upload", "/jobs", "/dashboard", "/logs"], adminAuthMiddleware);

app.get("/organizations", async (_request, response) => {
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
  });
  response.json(organizations);
});

app.post("/organizations", async (request, response) => {
  const payload = createOrganizationSchema.parse(request.body);
  const existingOrganization = await prisma.organization.count();

  if (existingOrganization > 0) {
    response.status(409).json({ error: "Apenas uma empresa principal pode ser cadastrada." });
    return;
  }

  const organization = await prisma.organization.create({ data: payload });
  response.status(201).json(organization);
});

app.get("/companies", async (request, response) => {
  const organizationId = typeof request.query.organizationId === "string" ? request.query.organizationId : undefined;
  const companies = await prisma.company.findMany({
    where: organizationId ? { organizationId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  response.json(companies);
});

app.post("/companies", async (request, response) => {
  const payload = createCompanySchema.parse(request.body);
  const company = await prisma.company.create({ data: payload });
  response.status(201).json(company);
});

app.delete("/organizations/:id", async (request, response) => {
  const existingOrganization = await prisma.organization.findUnique({ where: { id: request.params.id } });

  if (!existingOrganization) {
    response.status(404).json({ error: "Empresa nao encontrada." });
    return;
  }

  await prisma.organization.delete({ where: { id: request.params.id } });
  response.status(204).send();
});

app.get("/agents", async (request, response) => {
  const companyId = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
  const agents = await prisma.agent.findMany({
    where: companyId ? { companyId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  response.json(
    agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      companyId: agent.companyId,
      createdAt: agent.createdAt,
      hasToken: Boolean(agent.token),
      lastSeenAt: agent.lastSeenAt,
      activationCode: agent.activationCode,
      activationStatus: agent.activationStatus,
      deviceName: agent.deviceName,
    })),
  );
});

app.post("/agents", async (request, response) => {
  const payload = createAgentSchema.parse(request.body);
  const agent = await prisma.agent.create({
    data: {
      ...payload,
      token: createAgentToken(),
      activationCode: createAgentToken(),
      activationStatus: "PENDING",
      activationIssuedAt: new Date(),
    },
  });
  await appendLog({
    companyId: agent.companyId,
    agentId: agent.id,
    level: "INFO",
    message: `Agent ${agent.name} criado com chave de ativacao pendente.`,
  });
  response.status(201).json({
    id: agent.id,
    name: agent.name,
    companyId: agent.companyId,
    createdAt: agent.createdAt,
    hasToken: true,
    lastSeenAt: agent.lastSeenAt,
    activationCode: agent.activationCode,
    activationStatus: agent.activationStatus,
    deviceName: agent.deviceName,
  });
});

app.post("/agents/:id/issue-activation", async (request, response) => {
  const currentAgent = await prisma.agent.findUnique({ where: { id: request.params.id } });

  if (!currentAgent) {
    response.status(404).json({ error: "Agent nao encontrado." });
    return;
  }

  if (currentAgent.activationStatus === "ACTIVE" && !currentAgent.revokedAt) {
    response.status(409).json({
      error: "Revogue o acesso atual antes de emitir uma nova chave de ativacao.",
    });
    return;
  }

  const activationCode = createAgentToken();
  const token = createAgentToken();
  const agent = await prisma.agent.update({
    where: { id: request.params.id },
    data: {
      token,
      activationCode,
      activationStatus: "PENDING",
      activationIssuedAt: new Date(),
      activationUsedAt: null,
      deviceId: null,
      deviceName: null,
      revokedAt: null,
      lastSeenAt: null,
    },
  });
  await appendLog({
    companyId: agent.companyId,
    agentId: agent.id,
    level: "WARN",
    message: `Nova chave de ativacao emitida para o agent ${agent.name}.`,
  });
  response.json({ activationCode });
});

app.post("/agents/:id/revoke-access", async (request, response) => {
  const token = createAgentToken();
  const activationCode = createAgentToken();
  const agent = await prisma.agent.update({
    where: { id: request.params.id },
    data: {
      token,
      activationCode,
      activationStatus: "PENDING",
      revokedAt: new Date(),
      deviceId: null,
      deviceName: null,
      activationIssuedAt: new Date(),
      activationUsedAt: null,
      lastSeenAt: null,
    },
  });
  await appendLog({
    companyId: agent.companyId,
    agentId: agent.id,
    level: "WARN",
    message: `Acesso do agent ${agent.name} foi revogado e uma nova chave de ativacao foi emitida.`,
  });
  response.json({ revoked: true, activationCode });
});

app.delete("/agents/:id", async (request, response) => {
  const existingAgent = await prisma.agent.findUnique({ where: { id: request.params.id } });

  if (!existingAgent) {
    response.status(404).json({ error: "Agent nao encontrado." });
    return;
  }

  await prisma.agent.delete({ where: { id: request.params.id } });
  await appendLog({
    companyId: existingAgent.companyId,
    level: "WARN",
    message: `Agent ${existingAgent.name} foi excluido.`,
  });

  response.status(204).send();
});

app.post("/upload", upload.single("file"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "Arquivo nao enviado." });
    return;
  }

  response.status(201).json({
    filePath: `/uploads/${request.file.filename}`,
    originalName: request.file.originalname,
  });
});

app.get("/jobs", async (request, response) => {
  const companyId = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
  const status = typeof request.query.status === "string" ? request.query.status : undefined;

  const jobs = await prisma.job.findMany({
    where: {
      companyId: companyId ?? undefined,
      status: status ?? undefined,
    },
    orderBy: { dataPostagem: "asc" },
  });

  response.json(
    jobs.map((job) => ({
      id: job.id,
      companyId: job.companyId,
      filePath: job.filePath,
      caption: job.caption,
      publicationType: normalizePublicationType(job),
      postStory: job.postStory,
      postReel: job.postReel,
      postWhatsapp: job.postWhatsapp,
      modoWhatsapp: job.modoWhatsapp,
      dataPostagem: job.dataPostagem,
      status: job.status,
      tentativas: job.tentativas,
      createdAt: job.criadoEm,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      lastError: job.lastError,
    })),
  );
});

app.post("/jobs", async (request, response) => {
  const payload = createJobSchema.parse(request.body);
  const legacyFields = deriveLegacyJobFields(payload.publicationType);
  const filePath = ensureFilePathForPublication(payload.publicationType, payload.filePath);
  const job = await prisma.job.create({
    data: {
      companyId: payload.companyId,
      filePath,
      caption: payload.caption ?? null,
      publicationType: payload.publicationType,
      postStory: legacyFields.postStory,
      postReel: legacyFields.postReel,
      postWhatsapp: legacyFields.postWhatsapp,
      modoWhatsapp: legacyFields.modoWhatsapp,
      dataPostagem: new Date(payload.dataPostagem),
    },
  });
  await appendLog({
    companyId: payload.companyId,
    level: "INFO",
    message: `Job ${job.id} agendado para ${job.dataPostagem.toISOString()}.`,
  });
  response.status(201).json(job);
});

app.put("/jobs/:id", async (request, response) => {
  const payload = updateJobSchema.parse(request.body);
  const legacyFields = deriveLegacyJobFields(payload.publicationType);
  const filePath = ensureFilePathForPublication(payload.publicationType, payload.filePath);
  const existingJob = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  const job = await prisma.job.update({
    where: { id: request.params.id },
    data: {
      companyId: payload.companyId,
      filePath,
      caption: payload.caption ?? null,
      publicationType: payload.publicationType,
      postStory: legacyFields.postStory,
      postReel: legacyFields.postReel,
      postWhatsapp: legacyFields.postWhatsapp,
      modoWhatsapp: legacyFields.modoWhatsapp,
      dataPostagem: new Date(payload.dataPostagem),
      status: "PENDING",
      startedAt: null,
      completedAt: null,
      lastError: null,
    },
  });

  await appendLog({
    companyId: payload.companyId,
    level: "INFO",
    message: `Job ${job.id} foi editado e reagendado para ${job.dataPostagem.toISOString()}.`,
  });

  response.json(job);
});

app.delete("/jobs/:id", async (request, response) => {
  const existingJob = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  await prisma.job.delete({ where: { id: request.params.id } });
  await appendLog({
    companyId: existingJob.companyId,
    level: "WARN",
    message: `Job ${existingJob.id} foi excluido.`,
  });

  response.status(204).send();
});

app.get("/dashboard", async (request, response) => {
  const companyId = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
  const where = companyId ? { companyId } : undefined;

  const [jobs, agentsOnline] = await Promise.all([
    prisma.job.findMany({ where, select: { status: true } }),
    prisma.agent.count({
      where: {
        companyId: companyId ?? undefined,
        lastSeenAt: {
          gte: new Date(Date.now() - 60_000),
        },
      },
    }),
  ]);

  const totals = {
    PENDING: 0,
    RUNNING: 0,
    COMPLETED: 0,
    FAILED: 0,
    WAITING_LOGIN: 0,
  };

  for (const job of jobs) {
    if (job.status in totals) {
      totals[job.status as keyof typeof totals] += 1;
    }
  }

  response.json({
    companyId: companyId ?? null,
    totals,
    agentsOnline,
    pendingJobs: totals.PENDING,
    failedJobs: totals.FAILED,
    completedJobs: totals.COMPLETED,
  });
});

app.get("/logs", async (request, response) => {
  const companyId = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
  const logs = await prisma.agentLog.findMany({
    where: companyId ? { companyId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  response.json(logs);
});

app.post("/agent/pair", async (request, response) => {
  const payload = pairAgentSchema.parse(request.body);

  const agent = await prisma.agent.findFirst({
    where: { activationCode: payload.activationCode },
  });

  if (!agent) {
    response.status(404).json({ error: "Codigo de ativacao invalido." });
    return;
  }

  if (agent.activationStatus === "REVOKED") {
    response.status(409).json({ error: "Acesso revogado. Gere uma nova chave de ativacao no painel web." });
    return;
  }

  if (agent.activationStatus === "ACTIVE" && agent.deviceId && agent.deviceId !== payload.deviceId) {
    response.status(409).json({
      error: "Este codigo ja esta em uso em outro computador. Revogue o acesso anterior no painel web.",
    });
    return;
  }

  const activeCompanyAgent = await prisma.agent.findFirst({
    where: {
      companyId: agent.companyId,
      activationStatus: "ACTIVE",
      revokedAt: null,
      id: { not: agent.id },
    },
  });

  if (activeCompanyAgent) {
    response.status(409).json({
      error: "Esta company ja possui um dispositivo ativo. Revogue o acesso anterior no painel web antes de ativar outro.",
    });
    return;
  }

  const activatedAgent =
    agent.activationStatus === "ACTIVE"
      ? agent
      : await prisma.agent.update({
          where: { id: agent.id },
          data: {
            activationStatus: "ACTIVE",
            activationUsedAt: new Date(),
            deviceId: payload.deviceId,
            deviceName: payload.deviceName,
            revokedAt: null,
          },
        });

  await appendLog({
    companyId: activatedAgent.companyId,
    agentId: activatedAgent.id,
    level: "INFO",
    message: `Agent ${activatedAgent.name} ativado no dispositivo ${payload.deviceName}.`,
  });

  response.json({
    agentId: activatedAgent.id,
    companyId: activatedAgent.companyId,
    agentToken: activatedAgent.token,
    agentName: activatedAgent.name,
  });
});

app.get("/agent/me", agentAuthMiddleware, async (request, response) => {
  const agent = request.agentAuth!;
  response.json({
    agentId: agent.id,
    companyId: agent.companyId,
    deviceId: agent.deviceId,
  });
});

app.get("/agent/jobs/next", agentAuthMiddleware, async (request, response) => {
  const agent = request.agentAuth!;
  const now = new Date();
  const job = await prisma.$transaction(async (transaction) => {
    const nextJob = await transaction.job.findFirst({
      where: {
        companyId: agent.companyId,
        status: {
          in: ["PENDING", "WAITING_LOGIN"],
        },
        dataPostagem: { lte: now },
      },
      orderBy: { dataPostagem: "asc" },
    });

    if (!nextJob) {
      return null;
    }

    const lockedJob = await transaction.job.update({
      where: { id: nextJob.id },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        tentativas: { increment: 1 },
        lastError: null,
      },
    });

    await transaction.agentLog.create({
      data: {
        companyId: agent.companyId,
        agentId: agent.id,
        level: "INFO",
        message: `Job ${nextJob.id} reservado pelo agent ${agent.id}.`,
      },
    });

    return lockedJob;
  });

  if (!job) {
    response.json({ job: null });
    return;
  }

  response.json({
    job: {
      id: job.id,
      companyId: job.companyId,
      filePath: job.filePath,
      caption: job.caption,
      publicationType: normalizePublicationType(job),
      postStory: job.postStory,
      postReel: job.postReel,
      postWhatsapp: job.postWhatsapp,
      modoWhatsapp: job.modoWhatsapp,
      dataPostagem: job.dataPostagem,
      status: job.status,
      tentativas: job.tentativas,
      createdAt: job.criadoEm,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      lastError: job.lastError,
    },
  });
});

app.post("/agent/jobs/:id/start", agentAuthMiddleware, async (request, response) => {
  const agent = request.agentAuth!;
  const job = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!job || !ensureAgentOwnsCompany(request, job.companyId)) {
    response.status(404).json({ error: "Job nao encontrado para este agent." });
    return;
  }

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      tentativas: { increment: 1 },
      lastError: null,
    },
  });

  await appendLog({
    companyId: agent.companyId,
    agentId: agent.id,
    level: "INFO",
    message: `Job ${job.id} iniciado pelo agent ${agent.id}.`,
  });

  response.json(updated);
});

app.post("/agent/jobs/:id/complete", agentAuthMiddleware, async (request, response) => {
  const agent = request.agentAuth!;
  const job = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!job || !ensureAgentOwnsCompany(request, job.companyId)) {
    response.status(404).json({ error: "Job nao encontrado para este agent." });
    return;
  }

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      lastError: null,
    },
  });

  await appendLog({
    companyId: agent.companyId,
    agentId: agent.id,
    level: "INFO",
    message: `Job ${job.id} concluido com sucesso.`,
  });

  response.json(updated);
});

app.post("/agent/jobs/:id/fail", agentAuthMiddleware, async (request, response) => {
  const agent = request.agentAuth!;
  const schema = z.object({
    error: z.string().min(1),
    retryable: z.boolean().default(true),
  });
  const payload = schema.parse(request.body);
  const job = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!job || !ensureAgentOwnsCompany(request, job.companyId)) {
    response.status(404).json({ error: "Job nao encontrado para este agent." });
    return;
  }

  const nextStatus = payload.retryable ? "PENDING" : "FAILED";
  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      status: nextStatus,
      lastError: payload.error,
    },
  });

  await appendLog({
    companyId: agent.companyId,
    agentId: agent.id,
    level: payload.retryable ? "WARN" : "ERROR",
    message: `Job ${job.id} falhou: ${payload.error}`,
  });

  response.json(updated);
});

app.post("/agent/jobs/:id/waiting-login", agentAuthMiddleware, async (request, response) => {
  const agent = request.agentAuth!;
  const job = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!job || !ensureAgentOwnsCompany(request, job.companyId)) {
    response.status(404).json({ error: "Job nao encontrado para este agent." });
    return;
  }

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "WAITING_LOGIN",
      lastError: "Aguardando login manual no navegador.",
    },
  });

  await appendLog({
    companyId: agent.companyId,
    agentId: agent.id,
    level: "WARN",
    message: `Job ${job.id} aguardando login manual.`,
  });

  response.json(updated);
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "Payload invalido.", details: error.flatten() });
    return;
  }

  console.error(error);
  response.status(500).json({ error: "Erro interno." });
});

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
