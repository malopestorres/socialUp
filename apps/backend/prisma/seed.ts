import { PrismaClient } from "@prisma/client";
import { createRandomToken, hashPassword } from "../src/security.js";

const prisma = new PrismaClient();
const ROOT_USERNAME = "root";
const ROOT_PASSWORD = "Root@SocialUp2026!";
const BILLING_SETTING_AUTO_TRIAL_ENABLED = "billing.autoTrialEnabled";
const BILLING_SETTING_AUTO_TRIAL_DAYS = "billing.autoTrialDays";
const DEFAULT_BILLING_PLANS = [
  {
    code: "FREE_TRIAL",
    name: "Free Trial",
    description: "Teste por 10 dias com limites reduzidos.",
    isTrial: true,
    maxProfiles: 1,
    maxConnections: 2,
    maxMonthlyPublications: 30,
    monthlyPriceCents: null,
    yearlyPriceCents: null,
  },
  {
    code: "START",
    name: "Start",
    description: "Plano inicial para operação pequena.",
    isTrial: false,
    maxProfiles: 5,
    maxConnections: 15,
    maxMonthlyPublications: 120,
    monthlyPriceCents: 7900,
    yearlyPriceCents: 79000,
  },
  {
    code: "BUSINESS",
    name: "Business",
    description: "Plano para operação com maior volume.",
    isTrial: false,
    maxProfiles: 10,
    maxConnections: 30,
    maxMonthlyPublications: 240,
    monthlyPriceCents: 24900,
    yearlyPriceCents: 249000,
  },
] as const;

async function main() {
  const passwordHash = hashPassword(ROOT_PASSWORD);

  const rootUser = await prisma.user.upsert({
    where: { username: ROOT_USERNAME },
    update: {
      name: "Root",
      passwordHash,
      role: "ROOT",
      sessionToken: null,
      sessionIssuedAt: null,
    },
    create: {
      name: "Root",
      username: ROOT_USERNAME,
      passwordHash,
      role: "ROOT",
    },
  });

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
        maxProfiles: plan.maxProfiles,
        maxConnections: plan.maxConnections,
        maxMonthlyPublications: plan.maxMonthlyPublications,
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

  console.log("Root user seeded.");
  console.log(`Username: ${ROOT_USERNAME}`);
  console.log(`Password: ${ROOT_PASSWORD}`);
  console.log(`Setup key: ${invite.inviteKey}`);
  console.log(`Setup URL: http://localhost:5173/?setupKey=${invite.inviteKey}`);
  console.log(`User ID: ${rootUser.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
