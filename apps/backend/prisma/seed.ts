import { PrismaClient } from "@prisma/client";
import { createRandomToken, hashPassword } from "../src/security.js";

const prisma = new PrismaClient();

const ROOT_USERNAME = "root";
const ROOT_EMAIL = "root@socialup.local";
const ROOT_PASSWORD = "Root@SocialUp2026!";
const BILLING_SETTING_AUTO_TRIAL_ENABLED = "billing.autoTrialEnabled";
const BILLING_SETTING_AUTO_TRIAL_DAYS = "billing.autoTrialDays";

const AGENCY_X_USERNAME = "agenciax";
const AGENCY_X_EMAIL = "agenciax@socialup.local";
const AGENCY_X_PASSWORD = "AgenciaX2026@";
const MARCUS_USERNAME = "marcus";
const MARCUS_EMAIL = "marcus@socialup.local";
const MARCUS_FALLBACK_PASSWORD = "Marcus@SocialUp2026!";

const DEFAULT_BILLING_PLANS = [
  {
    code: "FREE_TRIAL",
    name: "Free Trial",
    description: "Teste por 10 dias com limites reduzidos.",
    isTrial: true,
    maxProfiles: 1,
    workspaceLimit: 1,
    agencyBonusWorkspaceLimit: 0,
    isPublic: false,
    displayOrder: 0,
    maxConnections: 2,
    maxMonthlyPublications: 30,
    monthlyPriceCents: null,
    yearlyPriceCents: null,
  },
  {
    code: "SINGLE",
    name: "Single",
    description: "Plano para uma única operação.",
    isTrial: false,
    maxProfiles: 1,
    workspaceLimit: 1,
    agencyBonusWorkspaceLimit: 0,
    isPublic: true,
    displayOrder: 1,
    maxConnections: 15,
    maxMonthlyPublications: 120,
    monthlyPriceCents: 7900,
    yearlyPriceCents: 79000,
  },
  {
    code: "BUSINESS",
    name: "Business",
    description: "Plano para agência ou operação multi-workspace.",
    isTrial: false,
    maxProfiles: 10,
    workspaceLimit: 10,
    agencyBonusWorkspaceLimit: 1,
    isPublic: true,
    displayOrder: 2,
    maxConnections: 30,
    maxMonthlyPublications: 240,
    monthlyPriceCents: 24900,
    yearlyPriceCents: 249000,
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Plano para operação avançada com múltiplos workspaces.",
    isTrial: false,
    maxProfiles: 30,
    workspaceLimit: 30,
    agencyBonusWorkspaceLimit: 1,
    isPublic: true,
    displayOrder: 3,
    maxConnections: 120,
    maxMonthlyPublications: 1000,
    monthlyPriceCents: 49900,
    yearlyPriceCents: 499000,
  },
] as const;

type WorkspaceKind = "CLIENT" | "AGENCY_BONUS";
type WorkspaceMemberRole = "CENTRAL" | "CLIENT" | "AGENCY";
type SocialPlatform = "instagram" | "facebook" | "threads" | "whatsapp";
type JobStatus = "PENDING" | "WAITING_LOGIN" | "FAILED" | "CANCELED" | "COMPLETED" | "SENT_UNCONFIRMED";
type PublicationType =
  | "instagram_post"
  | "instagram_reel"
  | "facebook_post"
  | "threads_post"
  | "whatsapp_status_midia";

type SeedWorkspaceDefinition = {
  key: string;
  name: string;
  kind: WorkspaceKind;
  clientUsername?: string | null;
  invites?: Array<"CLIENT" | "AGENCY">;
};

type SeedConnectionDefinition = {
  key: string;
  workspaceKey: string;
  platform: SocialPlatform;
  displayName: string;
  loginIdentifier?: string | null;
  authStatus: "CONNECTED" | "AUTH_REQUIRED";
  agencyCanRefresh?: boolean;
};

type SeedJobDefinition = {
  workspaceKey: string;
  connectionKey?: string;
  title: string;
  caption: string;
  publicationType: PublicationType;
  publicationState: "PUBLISHED" | "DRAFT";
  status: JobStatus;
  filePath: string;
  scheduledAt: string;
  lastError?: string | null;
};

const AGENCY_X_WORKSPACES: SeedWorkspaceDefinition[] = [
  {
    key: "agency_bonus",
    name: "Agência X",
    kind: "AGENCY_BONUS",
    invites: ["AGENCY"],
  },
  {
    key: "clinica_plenum",
    name: "Clínica Plenum",
    kind: "CLIENT",
    clientUsername: MARCUS_USERNAME,
  },
  {
    key: "otica_aurora",
    name: "Ótica Aurora",
    kind: "CLIENT",
    invites: ["CLIENT"],
  },
  {
    key: "picanco_burgers",
    name: "Picanço Burgers",
    kind: "CLIENT",
    clientUsername: MARCUS_USERNAME,
    invites: ["AGENCY"],
  },
];

const AGENCY_X_CONNECTIONS: SeedConnectionDefinition[] = [
  {
    key: "agency_instagram",
    workspaceKey: "agency_bonus",
    platform: "instagram",
    displayName: "Agência X",
    loginIdentifier: "@agenciax.oficial",
    authStatus: "CONNECTED",
    agencyCanRefresh: true,
  },
  {
    key: "clinica_instagram",
    workspaceKey: "clinica_plenum",
    platform: "instagram",
    displayName: "Clínica Plenum",
    loginIdentifier: "@clinicaplenum",
    authStatus: "CONNECTED",
    agencyCanRefresh: true,
  },
  {
    key: "clinica_whatsapp",
    workspaceKey: "clinica_plenum",
    platform: "whatsapp",
    displayName: "Clínica Plenum WhatsApp",
    loginIdentifier: "5511999001122",
    authStatus: "CONNECTED",
    agencyCanRefresh: false,
  },
  {
    key: "otica_facebook",
    workspaceKey: "otica_aurora",
    platform: "facebook",
    displayName: "Ótica Aurora",
    loginIdentifier: "Ótica Aurora",
    authStatus: "AUTH_REQUIRED",
    agencyCanRefresh: false,
  },
  {
    key: "picanco_threads",
    workspaceKey: "picanco_burgers",
    platform: "threads",
    displayName: "Picanço Burgers",
    loginIdentifier: "@picancoburgers",
    authStatus: "AUTH_REQUIRED",
    agencyCanRefresh: false,
  },
];

const AGENCY_X_JOBS: SeedJobDefinition[] = [
  {
    workspaceKey: "agency_bonus",
    connectionKey: "agency_instagram",
    title: "Campanha institucional de abril",
    caption: "Rascunho da campanha institucional da Agência X com foco em bastidores e posicionamento.",
    publicationType: "instagram_post",
    publicationState: "DRAFT",
    status: "PENDING",
    filePath: "/uploads/seed-agency-cover.svg",
    scheduledAt: "2026-03-24T10:00:00-03:00",
  },
  {
    workspaceKey: "agency_bonus",
    connectionKey: "agency_instagram",
    title: "Reels dos bastidores do time",
    caption: "Agendado para publicar o dia a dia do time e humanizar a marca.",
    publicationType: "instagram_reel",
    publicationState: "PUBLISHED",
    status: "PENDING",
    filePath: "/uploads/seed-agency-reel.svg",
    scheduledAt: "2026-03-23T14:30:00-03:00",
  },
  {
    workspaceKey: "agency_bonus",
    connectionKey: "agency_instagram",
    title: "Case aprovado do mês",
    caption: "Publicação já entregue mostrando resultado de cliente e prova social.",
    publicationType: "instagram_post",
    publicationState: "PUBLISHED",
    status: "COMPLETED",
    filePath: "/uploads/seed-agency-cover.svg",
    scheduledAt: "2026-03-14T09:00:00-03:00",
  },
  {
    workspaceKey: "clinica_plenum",
    connectionKey: "clinica_instagram",
    title: "Semana da avaliação estética",
    caption: "Post agendado com foco em captação de leads para avaliação estética.",
    publicationType: "instagram_post",
    publicationState: "PUBLISHED",
    status: "PENDING",
    filePath: "/uploads/seed-clinic-soft.svg",
    scheduledAt: "2026-03-25T11:00:00-03:00",
  },
  {
    workspaceKey: "clinica_plenum",
    connectionKey: "clinica_instagram",
    title: "Depoimento da paciente Ana",
    caption: "Aguardando autenticação para retomar a publicação do reels de depoimento.",
    publicationType: "instagram_reel",
    publicationState: "PUBLISHED",
    status: "WAITING_LOGIN",
    filePath: "/uploads/seed-clinic-soft.svg",
    scheduledAt: "2026-03-21T16:00:00-03:00",
  },
  {
    workspaceKey: "clinica_plenum",
    connectionKey: "clinica_instagram",
    title: "Antes e depois laser",
    caption: "Tentativa de publicação que falhou e precisa de revisão de mídia.",
    publicationType: "instagram_post",
    publicationState: "PUBLISHED",
    status: "FAILED",
    filePath: "/uploads/seed-clinic-soft.svg",
    scheduledAt: "2026-03-18T15:00:00-03:00",
    lastError: "Falha ao processar a mídia do carrossel.",
  },
  {
    workspaceKey: "clinica_plenum",
    connectionKey: "clinica_whatsapp",
    title: "Lembrete da live odontológica",
    caption: "Status do WhatsApp já publicado para reforçar presença na live da clínica.",
    publicationType: "whatsapp_status_midia",
    publicationState: "PUBLISHED",
    status: "SENT_UNCONFIRMED",
    filePath: "/uploads/seed-clinic-soft.svg",
    scheduledAt: "2026-03-16T08:40:00-03:00",
  },
  {
    workspaceKey: "otica_aurora",
    connectionKey: "otica_facebook",
    title: "Coleção outono premium",
    caption: "Rascunho comercial com foco nas novas armações e lente blue.",
    publicationType: "facebook_post",
    publicationState: "DRAFT",
    status: "PENDING",
    filePath: "/uploads/seed-optic-clean.svg",
    scheduledAt: "2026-03-27T10:30:00-03:00",
  },
  {
    workspaceKey: "otica_aurora",
    connectionKey: "otica_facebook",
    title: "Oferta lente blue",
    caption: "Post já publicado com CTA para atendimento imediato na loja.",
    publicationType: "facebook_post",
    publicationState: "PUBLISHED",
    status: "COMPLETED",
    filePath: "/uploads/seed-optic-clean.svg",
    scheduledAt: "2026-03-12T13:20:00-03:00",
  },
  {
    workspaceKey: "otica_aurora",
    connectionKey: "otica_facebook",
    title: "Armação premium do mês",
    caption: "Campanha cancelada após troca de direção comercial do cliente.",
    publicationType: "facebook_post",
    publicationState: "PUBLISHED",
    status: "CANCELED",
    filePath: "/uploads/seed-optic-clean.svg",
    scheduledAt: "2026-03-19T17:45:00-03:00",
  },
  {
    workspaceKey: "picanco_burgers",
    connectionKey: "picanco_threads",
    title: "Rodízio especial do domingo",
    caption: "Publicação aguardando novo login para subir no Threads.",
    publicationType: "threads_post",
    publicationState: "PUBLISHED",
    status: "WAITING_LOGIN",
    filePath: "/uploads/seed-burger-warm.svg",
    scheduledAt: "2026-03-22T18:10:00-03:00",
  },
  {
    workspaceKey: "picanco_burgers",
    connectionKey: "picanco_threads",
    title: "Reels da cozinha aberta",
    caption: "Falhou depois de a mídia voltar inválida para o provider.",
    publicationType: "threads_post",
    publicationState: "PUBLISHED",
    status: "FAILED",
    filePath: "/uploads/seed-burger-warm.svg",
    scheduledAt: "2026-03-17T19:10:00-03:00",
    lastError: "A mídia foi rejeitada pelo provedor externo.",
  },
  {
    workspaceKey: "picanco_burgers",
    connectionKey: "picanco_threads",
    title: "Cupom da sexta da casa",
    caption: "Campanha cancelada após mudança de oferta do restaurante.",
    publicationType: "threads_post",
    publicationState: "PUBLISHED",
    status: "CANCELED",
    filePath: "/uploads/seed-burger-warm.svg",
    scheduledAt: "2026-03-13T18:50:00-03:00",
  },
];

async function ensureUser(input: {
  username: string;
  email: string;
  name: string;
  password: string;
  role?: string;
}) {
  const passwordHash = hashPassword(input.password);
  return prisma.user.upsert({
    where: { username: input.username },
    update: {
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role ?? "ADMIN",
    },
    create: {
      email: input.email,
      name: input.name,
      username: input.username,
      passwordHash,
      role: input.role ?? "ADMIN",
    },
  });
}

async function ensureBillingDefaults() {
  for (const plan of DEFAULT_BILLING_PLANS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {},
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        isTrial: plan.isTrial,
        isActive: true,
        isPublic: plan.isPublic,
        maxProfiles: plan.maxProfiles,
        workspaceLimit: plan.workspaceLimit,
        agencyBonusWorkspaceLimit: plan.agencyBonusWorkspaceLimit,
        maxConnections: plan.maxConnections,
        maxMonthlyPublications: plan.maxMonthlyPublications,
        displayOrder: plan.displayOrder,
        monthlyPriceCents: plan.monthlyPriceCents,
        yearlyPriceCents: plan.yearlyPriceCents,
      },
    });
  }

  await prisma.appSetting.upsert({
    where: { key: BILLING_SETTING_AUTO_TRIAL_ENABLED },
    update: {},
    create: {
      key: BILLING_SETTING_AUTO_TRIAL_ENABLED,
      value: "true",
    },
  });

  await prisma.appSetting.upsert({
    where: { key: BILLING_SETTING_AUTO_TRIAL_DAYS },
    update: {},
    create: {
      key: BILLING_SETTING_AUTO_TRIAL_DAYS,
      value: "10",
    },
  });
}

async function ensureOpenSetupInvite() {
  let invite = await prisma.setupInvite.findFirst({
    where: { usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!invite) {
    invite = await prisma.setupInvite.create({
      data: {
        inviteKey: createRandomToken(16),
      },
    });
  }

  return invite;
}

async function ensureAgencyXFixtures() {
  const [agencyUser, existingMarcus, enterprisePlan] = await Promise.all([
    ensureUser({
      username: AGENCY_X_USERNAME,
      email: AGENCY_X_EMAIL,
      name: "Agencia X",
      password: AGENCY_X_PASSWORD,
      role: "ADMIN",
    }),
    prisma.user.findUnique({
      where: { username: MARCUS_USERNAME },
    }),
    prisma.plan.findUnique({
      where: { code: "ENTERPRISE" },
    }),
  ]);

  const marcusWasCreated = !existingMarcus;
  const marcusUser =
    existingMarcus ??
    (await ensureUser({
      username: MARCUS_USERNAME,
      email: MARCUS_EMAIL,
      name: "Marcus Torres",
      password: MARCUS_FALLBACK_PASSWORD,
      role: "ADMIN",
    }));

  if (!enterprisePlan) {
    throw new Error("ENTERPRISE_PLAN_NOT_FOUND");
  }

  await prisma.userPlanSubscription.upsert({
    where: { userId: agencyUser.id },
    update: {
      planId: enterprisePlan.id,
      status: "ACTIVE",
      billingModel: "MANUAL",
      cycle: "MONTHLY",
      blockedReason: null,
      endsAt: null,
    },
    create: {
      userId: agencyUser.id,
      planId: enterprisePlan.id,
      status: "ACTIVE",
      billingModel: "MANUAL",
      cycle: "MONTHLY",
      blockedReason: null,
    },
  });

  const workspaceMap = new Map<string, { id: string; name: string; kind: WorkspaceKind }>();

  for (const definition of AGENCY_X_WORKSPACES) {
    const existingWorkspace = await prisma.company.findFirst({
      where: {
        name: definition.name,
        kind: definition.kind,
        createdByUserId: agencyUser.id,
      },
      orderBy: { createdAt: "asc" },
    });

    const workspace =
      existingWorkspace ??
      (await prisma.company.create({
        data: {
          name: definition.name,
          kind: definition.kind,
          status: "ACTIVE",
          createdByUserId: agencyUser.id,
        },
      }));

    await prisma.company.update({
      where: { id: workspace.id },
      data: {
        status: "ACTIVE",
        name: definition.name,
        kind: definition.kind,
      },
    });

    await prisma.companyMember.deleteMany({
      where: {
        companyId: workspace.id,
        role: {
          in: ["CLIENT", "AGENCY"],
        },
      },
    });

    await prisma.companyMember.upsert({
      where: {
        companyId_userId: {
          companyId: workspace.id,
          userId: agencyUser.id,
        },
      },
      update: {
        role: "CENTRAL",
      },
      create: {
        companyId: workspace.id,
        userId: agencyUser.id,
        role: "CENTRAL",
      },
    });

    if (definition.clientUsername === MARCUS_USERNAME) {
      await prisma.companyMember.upsert({
        where: {
          companyId_userId: {
            companyId: workspace.id,
            userId: marcusUser.id,
          },
        },
        update: {
          role: "CLIENT",
        },
        create: {
          companyId: workspace.id,
          userId: marcusUser.id,
          role: "CLIENT",
        },
      });
    }

    await prisma.companyInvite.deleteMany({
      where: {
        companyId: workspace.id,
      },
    });

    for (const role of definition.invites ?? []) {
      await prisma.companyInvite.create({
        data: {
          companyId: workspace.id,
          inviteKey: createRandomToken(24),
          role,
          invitedByUserId: agencyUser.id,
        },
      });
    }

    await prisma.job.deleteMany({
      where: {
        companyId: workspace.id,
      },
    });

    await prisma.socialConnection.deleteMany({
      where: {
        companyId: workspace.id,
      },
    });

    workspaceMap.set(definition.key, {
      id: workspace.id,
      name: definition.name,
      kind: definition.kind,
    });
  }

  const connectionMap = new Map<string, { id: string; platform: SocialPlatform }>();

  for (const definition of AGENCY_X_CONNECTIONS) {
    const workspace = workspaceMap.get(definition.workspaceKey);
    if (!workspace) {
      continue;
    }

    const connection = await prisma.socialConnection.create({
      data: {
        companyId: workspace.id,
        createdByUserId: agencyUser.id,
        platform: definition.platform,
        provider: definition.platform === "whatsapp" ? "NATIVE" : "POST_FOR_ME",
        providerAccountId: `seed-${definition.key}`,
        providerExternalId: `seed-${definition.key}`,
        providerStatus: definition.authStatus === "CONNECTED" ? "connected" : "needs_auth",
        providerMetadata:
          definition.platform === "whatsapp"
            ? {
                profileName: definition.displayName,
                ownerJid: definition.loginIdentifier ? `${definition.loginIdentifier}@s.whatsapp.net` : null,
                seedFixture: true,
              }
            : {
                seedFixture: true,
                label: definition.displayName,
              },
        displayName: definition.displayName,
        loginIdentifier: definition.loginIdentifier ?? null,
        authStatus: definition.authStatus,
        automationMode: "VISUAL",
        agencyCanRefresh: Boolean(definition.agencyCanRefresh),
        authLaunchUrl:
          definition.authStatus === "CONNECTED"
            ? null
            : `https://oauth.socialup.space/seed/${definition.platform}/${definition.key}`,
        tokenExpiresAt:
          definition.authStatus === "CONNECTED"
            ? new Date("2026-05-18T12:00:00-03:00")
            : null,
        lastAuthAt:
          definition.authStatus === "CONNECTED"
            ? new Date("2026-03-10T09:00:00-03:00")
            : null,
        lastSeenAt: new Date("2026-03-20T10:30:00-03:00"),
      },
    });

    connectionMap.set(definition.key, {
      id: connection.id,
      platform: definition.platform,
    });
  }

  for (const definition of AGENCY_X_JOBS) {
    const workspace = workspaceMap.get(definition.workspaceKey);
    if (!workspace) {
      continue;
    }

    const scheduledAt = new Date(definition.scheduledAt);
    const startedAt =
      definition.status === "COMPLETED" ||
      definition.status === "SENT_UNCONFIRMED" ||
      definition.status === "FAILED"
        ? new Date(scheduledAt.getTime() - 15 * 60 * 1000)
        : null;
    const completedAt =
      definition.status === "COMPLETED" || definition.status === "SENT_UNCONFIRMED"
        ? new Date(scheduledAt.getTime() + 8 * 60 * 1000)
        : null;
    const tentativas = definition.status === "FAILED" || definition.status === "WAITING_LOGIN" ? 1 : 0;

    await prisma.job.create({
      data: {
        companyId: workspace.id,
        createdByUserId: agencyUser.id,
        socialConnectionId: definition.connectionKey ? connectionMap.get(definition.connectionKey)?.id ?? null : null,
        filePath: definition.filePath,
        title: definition.title,
        caption: definition.caption,
        firstComment: null,
        hashtags: [],
        locationName: null,
        whatsappBackgroundColor: null,
        whatsappRelinkEnabled: false,
        whatsappRelinkConnectionIds: [],
        instagramPermalink:
          definition.status === "COMPLETED" || definition.status === "SENT_UNCONFIRMED"
            ? `https://socialup.space/post/${createRandomToken(8)}`
            : null,
        publicationType: definition.publicationType,
        postStory: false,
        postReel: definition.publicationType === "instagram_reel",
        postWhatsapp: definition.publicationType === "whatsapp_status_midia",
        modoWhatsapp: definition.publicationType === "whatsapp_status_midia" ? "midia" : "midia",
        dataPostagem: scheduledAt,
        publicationState: definition.publicationState,
        status: definition.status,
        tentativas,
        criadoEm: new Date(scheduledAt.getTime() - 2 * 60 * 60 * 1000),
        startedAt,
        completedAt,
        lastError: definition.lastError ?? null,
      },
    });
  }

  return {
    agencyUser,
    marcusUser,
    marcusWasCreated,
    workspaceCount: workspaceMap.size,
    jobCount: AGENCY_X_JOBS.length,
  };
}

async function main() {
  const passwordHash = hashPassword(ROOT_PASSWORD);

  const rootUser = await prisma.user.upsert({
    where: { username: ROOT_USERNAME },
    update: {
      email: ROOT_EMAIL,
      name: "Root",
      passwordHash,
      role: "ROOT",
      sessionToken: null,
      sessionIssuedAt: null,
    },
    create: {
      email: ROOT_EMAIL,
      name: "Root",
      username: ROOT_USERNAME,
      passwordHash,
      role: "ROOT",
    },
  });

  const invite = await ensureOpenSetupInvite();
  await ensureBillingDefaults();
  const agencyFixtures = await ensureAgencyXFixtures();

  console.log("Root user seeded.");
  console.log(`Username: ${ROOT_USERNAME}`);
  console.log(`Password: ${ROOT_PASSWORD}`);
  console.log(`Setup key: ${invite.inviteKey}`);
  console.log(`Setup URL: http://localhost:5173/?setupKey=${invite.inviteKey}`);
  console.log(`User ID: ${rootUser.id}`);
  console.log("");
  console.log("Agencia X fixture ready.");
  console.log(`Agency username: ${AGENCY_X_USERNAME}`);
  console.log(`Agency password: ${AGENCY_X_PASSWORD}`);
  console.log(`Marcus username: ${agencyFixtures.marcusUser.username}`);
  if (agencyFixtures.marcusWasCreated) {
    console.log(`Marcus fallback password (only if recreated by seed): ${MARCUS_FALLBACK_PASSWORD}`);
  }
  console.log(`Workspaces: ${agencyFixtures.workspaceCount}`);
  console.log(`Publications: ${agencyFixtures.jobCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
