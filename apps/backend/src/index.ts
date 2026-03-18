import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import sharp from "sharp";
import Stripe from "stripe";
import type { PublicationState, PublicationType, WhatsappMode } from "@socialup/shared";
import { z } from "zod";
import { adminAuthMiddleware, type AdminUserAuth } from "./admin-auth.js";
import { registerBeeUpRoutes } from "./bee-up.js";
import {
  consumeInstagramOAuthState,
  createInstagramOAuthLaunchUrl,
  exchangeInstagramOAuthCodeForConnection,
  executeInstagramCarouselJobWithGraphApi,
  executeInstagramJobWithGraphApi,
  fetchInstagramPublishedMediaPermalinkWithGraphApi,
  isInstagramLoginRequiredErrorMessage,
  listInstagramLocationCandidatesForConnection,
  publishInstagramMediaCommentWithGraphApi,
  resolveInstagramConnectionRuntimeMetadata,
  refreshInstagramAccessTokenForConnection,
  type InstagramLocationSuggestion,
  searchInstagramLocationsForConnection,
} from "./instagram-graph-api.js";
import {
  closeRabbitMqInfra,
  enqueueJobExecutionMessage,
  startJobExecutionConsumer,
  type JobExecutionPlatform,
  type JobExecutionQueueMessage,
} from "./infra-rabbitmq.js";
import { acquireDistributedLock, isDistributedLockHeld, closeRedisInfra } from "./infra-redis.js";
import { prisma } from "./prisma.js";
import { createRandomToken, verifyPassword, hashPassword } from "./security.js";
import {
  dismissWhatsappQr,
  disconnectWhatsappConnection as disconnectWhatsappConnectionSession,
  executeWhatsappJobWithEvolutionApi,
  getWhatsappConnectionOverlay,
  isWhatsappEvolutionHardcodedEnabled,
  resolveWhatsappConnectionRuntimeAuthStatus,
  resolveWhatsappConnectionRuntimeMetadata,
  requestWhatsappQr,
} from "./whatsapp-evolution-api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../uploads");
const INSTAGRAM_GRAPH_PUBLIC_BASE_URL = (process.env.INSTAGRAM_GRAPH_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const INSTAGRAM_IMAGE_MAX_SIZE_BYTES = 8 * 1024 * 1024;
const INSTAGRAM_POST_ASPECT_RATIO_MIN = 4 / 5;
const INSTAGRAM_POST_ASPECT_RATIO_MAX = 1.91;
const INSTAGRAM_LOCATION_STORAGE_PREFIX = "__IGLOC__";
const JOB_MEDIA_BUNDLE_STORAGE_PREFIX = "__JOB_MEDIA_BUNDLE__";
const INSTAGRAM_MULTI_MEDIA_MAX_FILES = 10;
const INSTAGRAM_FORCED_LOCATION_ID_RAW = (process.env.INSTAGRAM_FORCED_LOCATION_ID || "").trim();
const INSTAGRAM_FORCED_LOCATION_ID = /^\d+$/.test(INSTAGRAM_FORCED_LOCATION_ID_RAW)
  ? INSTAGRAM_FORCED_LOCATION_ID_RAW
  : null;
const INSTAGRAM_FORCED_LOCATION_NAME = (process.env.INSTAGRAM_FORCED_LOCATION_NAME || "Localização padrão").trim();
const INSTAGRAM_WORKER_AUTO_RETRY_MAX_ATTEMPTS = parseEnvPositiveInt(
  process.env.INSTAGRAM_WORKER_AUTO_RETRY_MAX_ATTEMPTS,
  3,
);
const INSTAGRAM_WORKER_AUTO_RETRY_DELAY_MS = parseEnvPositiveInt(
  process.env.INSTAGRAM_WORKER_AUTO_RETRY_DELAY_MS,
  20_000,
);
const INSTAGRAM_STORY_SEQUENCE_STEP_DELAY_MS = parseEnvPositiveInt(
  process.env.INSTAGRAM_STORY_SEQUENCE_STEP_DELAY_MS,
  1_500,
);
const INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_ATTEMPTS = parseEnvPositiveInt(
  process.env.INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_ATTEMPTS,
  3,
);
const INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_DELAY_MS = parseEnvPositiveInt(
  process.env.INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_DELAY_MS,
  4_000,
);
const FAILED_MEDIA_RESCHEDULE_DELAY_MS = parseEnvPositiveInt(
  process.env.FAILED_MEDIA_RESCHEDULE_DELAY_MS,
  20 * 60 * 1000,
);
const INSTAGRAM_OAUTH_FLOW_RUNTIME = (process.env.INSTAGRAM_OAUTH_FLOW || "instagram_login").trim().toLowerCase();
const INSTAGRAM_DEFAULT_PROACTIVE_TOKEN_REFRESH_COOLDOWN_MS =
  INSTAGRAM_OAUTH_FLOW_RUNTIME === "instagram_login" ? 26 * 60 * 60 * 1000 : 30 * 60 * 1000;
const INSTAGRAM_PROACTIVE_TOKEN_REFRESH_COOLDOWN_MS = parseEnvPositiveInt(
  process.env.INSTAGRAM_PROACTIVE_TOKEN_REFRESH_COOLDOWN_MS,
  INSTAGRAM_DEFAULT_PROACTIVE_TOKEN_REFRESH_COOLDOWN_MS,
);
const INSTAGRAM_TOKEN_KEEPALIVE_INTERVAL_MS = parseEnvPositiveInt(
  process.env.INSTAGRAM_TOKEN_KEEPALIVE_INTERVAL_MS,
  5 * 60 * 1000,
);
const INSTAGRAM_TOKEN_KEEPALIVE_BATCH_SIZE = parseEnvPositiveInt(
  process.env.INSTAGRAM_TOKEN_KEEPALIVE_BATCH_SIZE,
  25,
);
const INSTAGRAM_KEEPALIVE_FORCE_DISCONNECT_ON_LOGIN_REQUIRED = parseEnvBoolean(
  process.env.INSTAGRAM_KEEPALIVE_FORCE_DISCONNECT_ON_LOGIN_REQUIRED,
  false,
);
const DEFAULT_WHATSAPP_BACKGROUND_COLOR = "#202C33";
const WHATSAPP_RELINK_POST_CANVAS_WIDTH = 1080;
const WHATSAPP_RELINK_POST_CANVAS_HEIGHT = 1920;
const WHATSAPP_RELINK_POST_FOREGROUND_WIDTH = 972;
const WHATSAPP_RELINK_POST_FOREGROUND_HEIGHT = 1680;
const JOB_DISPATCH_INTERVAL_MS = parseEnvPositiveInt(process.env.JOB_DISPATCH_INTERVAL_MS, 10_000);
const JOB_DISPATCH_BATCH_SIZE = parseEnvPositiveInt(process.env.JOB_DISPATCH_BATCH_SIZE, 10);
const JOB_CONSUMER_CONNECTION_LOCK_MS = parseEnvPositiveInt(process.env.JOB_CONSUMER_CONNECTION_LOCK_MS, 15 * 60 * 1000);
const RABBITMQ_CONSUMER_RETRY_DELAY_MS = parseEnvPositiveInt(process.env.RABBITMQ_CONSUMER_RETRY_DELAY_MS, 10_000);
const DEFAULT_USER_TIME_ZONE = "America/Sao_Paulo";
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const STRIPE_WEBHOOK_PATH = "/billing/stripe/webhook";
const STRIPE_CHECKOUT_SUCCESS_URL = (process.env.STRIPE_CHECKOUT_SUCCESS_URL || "").trim();
const STRIPE_CHECKOUT_CANCEL_URL = (process.env.STRIPE_CHECKOUT_CANCEL_URL || "").trim();
const BILLING_SETTING_AUTO_TRIAL_ENABLED = "billing.autoTrialEnabled";
const BILLING_SETTING_AUTO_TRIAL_DAYS = "billing.autoTrialDays";
const BILLING_SETTING_ROOT_DISPLAY_PLAN_ID = "billing.rootDisplayPlanId";
const BILLING_TRIAL_PLAN_CODE = "FREE_TRIAL";
const BILLING_TRIAL_REFERENCE_DAYS = 30;
const DEFAULT_AUTO_TRIAL_ENABLED = true;
const DEFAULT_AUTO_TRIAL_DAYS = 10;

type DefaultPlanSeed = {
  code: string;
  name: string;
  description: string;
  isTrial: boolean;
  maxProfiles: number;
  maxConnections: number;
  maxMonthlyPublications: number;
  monthlyPriceCents: number | null;
  yearlyPriceCents: number | null;
};

const DEFAULT_BILLING_TRIAL_PLAN: DefaultPlanSeed = {
  code: "FREE_TRIAL",
  name: "Free Trial",
  description: "Teste por 10 dias com limites reduzidos.",
  isTrial: true,
  maxProfiles: 1,
  maxConnections: 2,
  maxMonthlyPublications: 30,
  monthlyPriceCents: null,
  yearlyPriceCents: null,
};

let stripeClientSingleton: Stripe | null = null;

type StripeWebhookRequest = Request & {
  rawBody?: Buffer;
};

function parseEnvPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function isValidIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeUserTimeZone(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  if (!normalized) {
    return DEFAULT_USER_TIME_ZONE;
  }

  return isValidIanaTimeZone(normalized) ? normalized : DEFAULT_USER_TIME_ZONE;
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const timeZoneName = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT+00:00";
  const match = timeZoneName.match(/^GMT([+-])(\d{2}):?(\d{2})$/);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2] || "0", 10);
  const minutes = Number.parseInt(match[3] || "0", 10);
  return sign * (hours * 60 + minutes);
}

function zonedDateTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
  timeZone: string;
}): Date {
  const hour = input.hour ?? 0;
  const minute = input.minute ?? 0;
  const second = input.second ?? 0;
  const utcGuess = new Date(Date.UTC(input.year, input.month - 1, input.day, hour, minute, second));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, input.timeZone);
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function shiftCalendarDate(input: { year: number; month: number; day: number }, deltaDays: number) {
  const cursor = new Date(Date.UTC(input.year, input.month - 1, input.day));
  cursor.setUTCDate(cursor.getUTCDate() + deltaDays);
  return {
    year: cursor.getUTCFullYear(),
    month: cursor.getUTCMonth() + 1,
    day: cursor.getUTCDate(),
  };
}

function getDaysInMonthForCalendar(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}

function formatAspectRatio(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "");
}

type ImageDimensions = {
  width: number;
  height: number;
};

type JobMediaBundle = {
  files: string[];
  sequential: boolean;
  captions: Array<string | null>;
};

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) {
    return null;
  }

  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1]!;
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 1 >= buffer.length) {
      return null;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    const isStartOfFrame =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;

    if (isStartOfFrame) {
      if (segmentLength < 7 || offset + 6 >= buffer.length) {
        return null;
      }
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width <= 0 || height <= 0) {
        return null;
      }
      return { width, height };
    }

    offset += segmentLength;
  }

  return null;
}

function readImageDimensionsFromFile(absolutePath: string, normalizedPath: string): ImageDimensions | null {
  const buffer = readFileSync(absolutePath);

  if (/\.png$/.test(normalizedPath)) {
    return readPngDimensions(buffer);
  }

  if (/\.(jpe?g)$/.test(normalizedPath)) {
    return readJpegDimensions(buffer);
  }

  return null;
}

function createFilePathValidationError(message: string): z.ZodError {
  return new z.ZodError([
    {
      code: "custom",
      path: ["filePath"],
      message,
    },
  ]);
}

function decodeJobMediaBundleStorage(filePath: string | null | undefined): JobMediaBundle {
  const raw = filePath?.trim() || "";
  if (!raw) {
    return {
      files: [],
      sequential: false,
      captions: [],
    };
  }

  if (!raw.startsWith(JOB_MEDIA_BUNDLE_STORAGE_PREFIX)) {
    return {
      files: [raw],
      sequential: false,
      captions: [],
    };
  }

  const encodedPayload = raw.slice(JOB_MEDIA_BUNDLE_STORAGE_PREFIX.length).trim();
  if (!encodedPayload) {
    return {
      files: [],
      sequential: false,
      captions: [],
    };
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64").toString("utf8")) as {
      files?: unknown;
      sequential?: unknown;
      captions?: unknown;
    };

    const files = Array.isArray(parsed.files)
      ? parsed.files
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0)
      : [];

    const rawCaptions = Array.isArray(parsed.captions) ? parsed.captions : [];
    const captions = files.map((_, index) => {
      const value = rawCaptions[index];
      if (typeof value !== "string") {
        return null;
      }
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    });

    return {
      files,
      sequential: parsed.sequential === true,
      captions,
    };
  } catch {
    return {
      files: [raw],
      sequential: false,
      captions: [],
    };
  }
}

function encodeJobMediaBundleStorage(input: JobMediaBundle): string {
  const files = input.files.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const sequential = input.sequential === true;
  const captions = files.map((_, index) => {
    const value = input.captions[index];
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  });
  const hasAnyCaption = captions.some((entry) => Boolean(entry));

  if (files.length === 0) {
    return "";
  }

  if (files.length === 1 && !sequential && !hasAnyCaption) {
    return files[0]!;
  }

  const payload = Buffer.from(
    JSON.stringify({
      files,
      sequential,
      ...(hasAnyCaption ? { captions } : {}),
    }),
    "utf8",
  ).toString("base64");

  return `${JOB_MEDIA_BUNDLE_STORAGE_PREFIX}${payload}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutCode: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutCode));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function encodeInstagramLocationStorage(locationName: string | null, locationId: string | null): string | null {
  const normalizedName = locationName?.trim() || "";
  if (!normalizedName) {
    return null;
  }

  const normalizedId = locationId?.trim() || "";
  if (!normalizedId) {
    return normalizedName;
  }

  return `${INSTAGRAM_LOCATION_STORAGE_PREFIX}${normalizedId}::${normalizedName}`;
}

function decodeInstagramLocationStorage(input: string | null | undefined): { locationName: string | null; locationId: string | null } {
  const raw = input?.trim() || "";
  if (!raw) {
    return {
      locationName: null,
      locationId: null,
    };
  }

  if (!raw.startsWith(INSTAGRAM_LOCATION_STORAGE_PREFIX)) {
    return {
      locationName: raw,
      locationId: null,
    };
  }

  const encoded = raw.slice(INSTAGRAM_LOCATION_STORAGE_PREFIX.length);
  const separatorIndex = encoded.indexOf("::");
  if (separatorIndex <= 0) {
    return {
      locationName: raw,
      locationId: null,
    };
  }

  const locationId = encoded.slice(0, separatorIndex).trim();
  const locationName = encoded.slice(separatorIndex + 2).trim();

  if (!/^\d+$/.test(locationId) || !locationName) {
    return {
      locationName: raw,
      locationId: null,
    };
  }

  return {
    locationName,
    locationId,
  };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sanitizeUploadedFilename(originalName: string): string {
  const trimmed = originalName.trim();
  const extension = path.extname(trimmed).toLowerCase();
  const basename = extension ? trimmed.slice(0, -extension.length) : trimmed;
  const asciiBase = basename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeBase = asciiBase || "media";
  const safeExtension = extension.replace(/[^a-z0-9.]/g, "") || "";
  return `${safeBase}${safeExtension}`;
}

function buildInstagramLocationQueryVariants(query: string): string[] {
  const base = query.trim().replace(/\s+/g, " ");
  if (base.length < 2) {
    return [];
  }

  const variants: string[] = [];
  const dedupe = new Set<string>();
  const attachedPrepositions = ["de", "do", "da", "dos", "das"];

  const pushVariant = (value: string) => {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length < 2) {
      return;
    }
    const key = normalizeSearchText(normalized);
    if (!key || dedupe.has(key)) {
      return;
    }
    dedupe.add(key);
    variants.push(normalized);
  };

  pushVariant(base);

  const punctuationNormalized = base.replace(/[.,;:/\\|_+\-]+/g, " ").replace(/\s+/g, " ").trim();
  pushVariant(punctuationNormalized);

  const detachedPrepositions = punctuationNormalized
    .split(" ")
    .map((token) => {
      const lowerToken = token.toLowerCase();
      for (const preposition of attachedPrepositions) {
        if (lowerToken.endsWith(preposition) && lowerToken.length > preposition.length + 2) {
          return `${token.slice(0, token.length - preposition.length)} ${token.slice(token.length - preposition.length)}`;
        }
      }
      return token;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  pushVariant(detachedPrepositions);

  return variants;
}

function dedupeInstagramLocationSuggestions(
  items: InstagramLocationSuggestion[],
  limit: number,
): InstagramLocationSuggestion[] {
  const dedupe = new Set<string>();
  const output: InstagramLocationSuggestion[] = [];

  for (const item of items) {
    const id = item.id.trim();
    const name = item.name.trim();
    if (!id || !name || dedupe.has(id)) {
      continue;
    }
    dedupe.add(id);
    output.push({ id, name });
    if (output.length >= limit) {
      break;
    }
  }

  return output;
}

function applyConnectionWorkerOverlay(connection: {
  id: string;
  companyId: string;
  platform?: string;
}): Partial<Record<string, unknown>> {
  if (connection.platform !== "whatsapp") {
    return {};
  }

  return getWhatsappConnectionOverlay(connection.id);
}

const app = express();
app.use(cors());
app.use(
  express.json({
    verify: (request, _response, buffer) => {
      const requestUrl = (request as { url?: string }).url || "";
      if (requestUrl.startsWith(STRIPE_WEBHOOK_PATH)) {
        (request as StripeWebhookRequest).rawBody = Buffer.from(buffer);
      }
    },
  }),
);
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_request, file, callback) => {
    const uniquePrefix = `${Date.now()}-${createRandomToken(4)}`;
    const safeFilename = sanitizeUploadedFilename(file.originalname);
    callback(null, `${uniquePrefix}-${safeFilename}`);
  },
});

const upload = multer({ storage });

const createCompanySchema = z.object({
  name: z.string().min(2),
});

const socialPlatformSchema = z.enum(["instagram", "whatsapp"]);

const createConnectionSchema = z.object({
  companyId: z.string().trim().min(1, "Perfil é obrigatório."),
  platform: socialPlatformSchema,
  displayName: z.string().min(2).max(80),
  loginIdentifier: z.string().trim().max(160).optional().nullable(),
  secret: z.string().trim().max(255).optional().nullable(),
});

const updateConnectionSchema = z.object({
  displayName: z.string().min(2).max(80),
  loginIdentifier: z.string().trim().max(160).optional().nullable(),
  secret: z.string().trim().max(255).optional().nullable(),
});

const openVisualAuthSchema = z.object({
  returnToUrl: z.string().trim().url().max(2000).optional().nullable(),
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
  timeZone: z.string().trim().min(1).max(80).optional().nullable(),
});

const publicationStateSchema = z.enum(["PUBLISHED", "DRAFT"]);

const createJobSchema = z.object({
  companyId: z.string().min(1),
  socialConnectionId: z.string().min(1),
  filePath: z.string().optional().nullable(),
  filePaths: z.array(z.string()).optional().nullable(),
  fileCaptions: z.array(z.string().max(2000).optional().nullable()).optional().nullable(),
  sequential: z.boolean().optional(),
  title: z.string().trim().max(120).optional().nullable(),
  caption: z.string().optional().nullable(),
  firstComment: z.string().max(2000).optional().nullable(),
  whatsappBackgroundColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  whatsappRelinkEnabled: z.boolean().optional().default(false),
  whatsappRelinkConnectionIds: z.array(z.string().trim().min(1)).optional().nullable(),
  locationName: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  publicationType: z.enum([
    "instagram_story",
    "instagram_reel",
    "instagram_post",
    "whatsapp_status_midia",
  ]),
  publicationState: publicationStateSchema.optional().default("PUBLISHED"),
  dataPostagem: z.string().datetime().optional().nullable(),
});

const updateJobSchema = z.object({
  companyId: z.string().min(1),
  socialConnectionId: z.string().min(1),
  filePath: z.string().optional().nullable(),
  filePaths: z.array(z.string()).optional().nullable(),
  fileCaptions: z.array(z.string().max(2000).optional().nullable()).optional().nullable(),
  sequential: z.boolean().optional(),
  title: z.string().trim().max(120).optional().nullable(),
  caption: z.string().optional().nullable(),
  firstComment: z.string().max(2000).optional().nullable(),
  whatsappBackgroundColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  whatsappRelinkEnabled: z.boolean().optional(),
  whatsappRelinkConnectionIds: z.array(z.string().trim().min(1)).optional().nullable(),
  locationName: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  publicationType: z.enum([
    "instagram_story",
    "instagram_reel",
    "instagram_post",
    "whatsapp_status_midia",
  ]),
  publicationState: publicationStateSchema.optional(),
  dataPostagem: z.string().datetime().optional().nullable(),
});

const deleteUploadQuerySchema = z.object({
  filePath: z.string().trim().min(1),
});

const jobsCalendarQuerySchema = z.object({
  companyId: z.string().trim().min(1).optional(),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(4).default(1),
  query: z.string().trim().max(120).optional(),
  timeZone: z.string().trim().min(1).max(80).optional().nullable(),
});

const avisoPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

const historyDraftsQuerySchema = z.object({
  companyId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(24).default(12),
  query: z.string().trim().max(120).optional(),
});

const avisoRecentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

const createBroadcastAvisoSchema = z.object({
  title: z.string().trim().min(2).max(120),
  message: z.string().trim().min(2).max(2000),
});

const createPlanSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).optional().nullable(),
  isActive: z.boolean().optional().default(true),
  isTrial: z.boolean().optional().default(false),
  maxProfiles: z.coerce.number().int().min(1).max(5000),
  maxConnections: z.coerce.number().int().min(1).max(20000),
  maxMonthlyPublications: z.coerce.number().int().min(1).max(2000000),
  stripeProductId: z.string().trim().max(120).optional().nullable(),
});

const updatePlanSchema = createPlanSchema.partial().refine((payload) => Object.keys(payload).length > 0, {
  message: "Informe ao menos um campo para atualização.",
});

const updateBillingSettingsSchema = z.object({
  autoTrialEnabled: z.boolean().optional(),
  autoTrialDays: z.coerce.number().int().min(0).max(60).optional(),
  rootDisplayPlanId: z.string().trim().min(1).optional().nullable(),
});

const assignUserPlanSchema = z.object({
  userId: z.string().trim().min(1),
  planId: z.string().trim().min(1),
  status: z.enum(["ACTIVE", "PAYMENT_REQUIRED", "BLOCKED"]).optional().default("ACTIVE"),
  billingModel: z.enum(["TRIAL", "STRIPE_SUBSCRIPTION", "PIX_MANUAL", "MANUAL"]).optional().default("MANUAL"),
  cycle: z.enum(["MONTHLY", "YEARLY"]).optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
});

const startStripeCheckoutSchema = z.object({
  planId: z.string().trim().min(1),
  billingModel: z.enum(["STRIPE_SUBSCRIPTION"]),
  cycle: z.enum(["MONTHLY", "YEARLY"]),
});

const confirmStripeCheckoutSchema = z.object({
  sessionId: z.string().trim().min(1),
});

const billingUserDiscountListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  query: z.string().trim().max(120).optional().default(""),
});

const updateBillingUserDiscountSchema = z.object({
  enabled: z.boolean(),
  percent: z.coerce.number().int().min(0).max(100),
});

const instagramLocationSuggestionsQuerySchema = z.object({
  connectionId: z.string().trim().min(1),
  query: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(8),
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

function normalizePublicationState(value?: string | null): PublicationState {
  return value === "DRAFT" ? "DRAFT" : "PUBLISHED";
}

function validateSingleFilePathForPublication(publicationType: PublicationType, filePath: string): string {
  const trimmedPath = filePath.trim();
  const normalizedPath = trimmedPath.toLowerCase();

  if (publicationType === "instagram_post" && !/\.(jpg|jpeg|png)$/.test(normalizedPath)) {
    throw createFilePathValidationError("Instagram Post aceita apenas imagens JPG ou PNG.");
  }

  if (publicationType === "instagram_reel" && !/\.mp4$/.test(normalizedPath)) {
    throw createFilePathValidationError("Instagram Reel aceita apenas vídeo MP4.");
  }

  if (publicationType === "instagram_story" && !/\.(jpg|jpeg|png|mp4|mov|m4v|webm)$/.test(normalizedPath)) {
    throw createFilePathValidationError("Instagram Story aceita imagem (JPG/PNG) ou vídeo (MP4/MOV/M4V/WEBM).");
  }

  const isInstagramImageUpload =
    publicationType === "instagram_post" ||
    (publicationType === "instagram_story" && /\.(jpg|jpeg|png)$/.test(normalizedPath));

  if (isInstagramImageUpload && !/^https?:\/\//i.test(trimmedPath)) {
    const absolutePath = resolveUploadFilePath(trimmedPath);
    try {
      const bytes = statSync(absolutePath).size;
      if (bytes > INSTAGRAM_IMAGE_MAX_SIZE_BYTES) {
        throw createFilePathValidationError(
          `Imagem acima do limite da API do Instagram (${formatMegabytes(INSTAGRAM_IMAGE_MAX_SIZE_BYTES)} MB). ` +
            `Arquivo atual: ${formatMegabytes(bytes)} MB.`,
        );
      }

      if (publicationType === "instagram_post") {
        const dimensions = readImageDimensionsFromFile(absolutePath, normalizedPath);
        if (!dimensions) {
          throw createFilePathValidationError(
            "Nao foi possivel validar a proporcao da imagem do Instagram Post. Use JPG/PNG sem corrupcao.",
          );
        }

        const aspectRatio = dimensions.width / dimensions.height;
        if (aspectRatio < INSTAGRAM_POST_ASPECT_RATIO_MIN || aspectRatio > INSTAGRAM_POST_ASPECT_RATIO_MAX) {
          throw createFilePathValidationError(
            `Proporcao de imagem nao suportada para Instagram Post. ` +
              `Use entre 4:5 (${formatAspectRatio(INSTAGRAM_POST_ASPECT_RATIO_MIN)}:1) e ` +
              `1.91:1. Atual: ${dimensions.width}x${dimensions.height} (${formatAspectRatio(aspectRatio)}:1).`,
          );
        }
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw createFilePathValidationError("Arquivo de mídia não encontrado para este agendamento.");
    }
  }

  return trimmedPath;
}

function ensureFilePathForPublication(
  publicationType: PublicationType,
  filePath?: string | null,
  filePaths?: string[] | null,
  fileCaptions?: Array<string | null | undefined> | null,
  sequential?: boolean,
): string {
  if (publicationType === "whatsapp_status_texto") {
    return filePath ?? "";
  }

  const sourceFiles = (Array.isArray(filePaths) && filePaths.length > 0
    ? filePaths
    : [filePath ?? ""])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const sourceCaptions = Array.isArray(fileCaptions) ? fileCaptions : [];
  const dedupedMedia: Array<{ file: string; caption: string | null }> = [];
  const seen = new Set<string>();

  sourceFiles.forEach((entry, index) => {
    if (seen.has(entry)) {
      return;
    }
    seen.add(entry);

    const rawCaption = sourceCaptions[index];
    const normalizedCaption = typeof rawCaption === "string" ? rawCaption.trim() : "";
    dedupedMedia.push({
      file: entry,
      caption: normalizedCaption.length > 0 ? normalizedCaption : null,
    });
  });

  const uniqueFiles = dedupedMedia.map((entry) => entry.file);

  if (uniqueFiles.length === 0) {
    throw createFilePathValidationError("Este tipo de publicacao exige uma midia.");
  }

  if (publicationType === "instagram_reel" && uniqueFiles.length > 1) {
    throw createFilePathValidationError("Instagram Reel aceita apenas uma mídia por agendamento.");
  }

  if ((publicationType === "instagram_post" || publicationType === "instagram_story") && uniqueFiles.length > INSTAGRAM_MULTI_MEDIA_MAX_FILES) {
    throw createFilePathValidationError(`Você pode enviar até ${INSTAGRAM_MULTI_MEDIA_MAX_FILES} mídias por agendamento.`);
  }

  const normalizedSequential = sequential === true;
  if ((publicationType === "instagram_post" || publicationType === "instagram_story") && uniqueFiles.length > 1 && !normalizedSequential) {
    throw createFilePathValidationError(
      publicationType === "instagram_post"
        ? "Marque a opção de publicação em sequência para criar carrossel com múltiplas mídias."
        : "Marque a opção de publicação em sequência para publicar stories em ordem.",
    );
  }

  const validatedFiles = uniqueFiles.map((entry) => validateSingleFilePathForPublication(publicationType, entry));
  const normalizedCaptions = validatedFiles.map((_, index) => dedupedMedia[index]?.caption ?? null);

  return encodeJobMediaBundleStorage({
    files: validatedFiles,
    sequential: normalizedSequential && validatedFiles.length > 1,
    captions: normalizedCaptions,
  });
}

function isInstagramPublication(publicationType: PublicationType): boolean {
  return (
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "instagram_story"
  );
}

function isInstagramLocationSupportedPublication(publicationType: PublicationType): boolean {
  return publicationType === "instagram_post" || publicationType === "instagram_reel";
}

function platformForPublication(publicationType: PublicationType): "instagram" | "whatsapp" {
  return isInstagramPublication(publicationType) ? "instagram" : "whatsapp";
}

function publicationExecutionPriority(publicationType: PublicationType): number {
  switch (publicationType) {
    case "instagram_story":
      return 1;
    case "instagram_post":
      return 2;
    case "instagram_reel":
      return 3;
    case "whatsapp_status_texto":
      return 4;
    case "whatsapp_status_midia":
      return 5;
  }
}

function publicationTypeDisplayLabel(publicationType: PublicationType): string {
  switch (publicationType) {
    case "instagram_story":
      return "Instagram Story";
    case "instagram_reel":
      return "Instagram Reel";
    case "instagram_post":
      return "Instagram Post";
    case "whatsapp_status_midia":
      return "WhatsApp Status (midia)";
    case "whatsapp_status_texto":
      return "WhatsApp Status (texto)";
  }
}

function compactAvisoText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeJobTitle(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeWhatsappBackgroundColor(
  value: string | null | undefined,
  enabled: boolean,
): string | null {
  if (!enabled) {
    return null;
  }

  const normalized = value?.trim().toUpperCase() || DEFAULT_WHATSAPP_BACKGROUND_COLOR;
  if (/^#[0-9A-F]{6}$/.test(normalized)) {
    return normalized;
  }

  return DEFAULT_WHATSAPP_BACKGROUND_COLOR;
}

function ensureInstagramMetadata(
  publicationType: PublicationType,
  caption?: string | null,
  fileCaptions?: Array<string | null | undefined> | null,
  locationName?: string | null,
  locationId?: string | null,
): { caption: string | null; locationName: string | null } {
  const normalizedCaption = caption?.trim() || null;
  const normalizedFileCaptions = (Array.isArray(fileCaptions) ? fileCaptions : [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  const fallbackCaption =
    normalizedFileCaptions.length === 0
      ? null
      : normalizedFileCaptions.length === 1
        ? normalizedFileCaptions[0]!
        : normalizedFileCaptions.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
  const effectiveCaption =
    publicationType !== "instagram_story" && !normalizedCaption ? fallbackCaption : normalizedCaption;
  const normalizedLocation = locationName?.trim() || null;
  const normalizedLocationId = locationId?.trim() || null;
  const isForcedInstagramLocation =
    isInstagramLocationSupportedPublication(publicationType) && !!INSTAGRAM_FORCED_LOCATION_ID;
  const effectiveLocationId = isForcedInstagramLocation ? INSTAGRAM_FORCED_LOCATION_ID : normalizedLocationId;
  const effectiveLocationName =
    isForcedInstagramLocation && effectiveLocationId
      ? normalizedLocation || INSTAGRAM_FORCED_LOCATION_NAME || `Local #${effectiveLocationId}`
      : normalizedLocation;

  if (isInstagramPublication(publicationType)) {
    if (effectiveLocationId && !/^\d+$/.test(effectiveLocationId)) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["locationId"],
          message: "ID de localização inválido.",
        },
      ]);
    }
  }

  return {
    caption: publicationType === "instagram_story" ? null : effectiveCaption,
    locationName: encodeInstagramLocationStorage(effectiveLocationName, effectiveLocationId),
  };
}

function normalizeFirstComment(publicationType: PublicationType, value?: string | null): string | null {
  if (publicationType !== "instagram_post" && publicationType !== "instagram_reel") {
    return null;
  }

  const normalized = value?.trim() || "";
  return normalized.length > 0 ? normalized : null;
}

function supportsInstagramWhatsappRelink(publicationType: PublicationType): boolean {
  return (
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "instagram_story"
  );
}

function supportsInstagramWhatsappRelinkForJobMedia(
  publicationType: PublicationType,
  encodedFilePath: string,
): boolean {
  if (!supportsInstagramWhatsappRelink(publicationType)) {
    return false;
  }

  if (publicationType !== "instagram_story") {
    return true;
  }

  const mediaBundle = decodeJobMediaBundleStorage(encodedFilePath);
  const mediaFiles = mediaBundle.files.length > 0
    ? mediaBundle.files
    : (encodedFilePath?.trim() ? [encodedFilePath.trim()] : []);

  return mediaFiles.length <= 1;
}

function normalizeWhatsappRelinkConnectionIds(value?: string[] | null): string[] {
  const source = Array.isArray(value) ? value : [];
  const unique = new Set<string>();
  const normalized: string[] = [];

  for (const entry of source) {
    const trimmed = entry.trim();
    if (!trimmed || unique.has(trimmed)) {
      continue;
    }
    unique.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function parseStoredWhatsappRelinkConnectionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const unique = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || unique.has(trimmed)) {
      continue;
    }
    unique.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

async function resolveWhatsappRelinkOptions(input: {
  request: Request & { adminUser?: AdminUserAuth };
  publicationType: PublicationType;
  encodedFilePath: string;
  enabledValue?: boolean | null;
  connectionIdsValue?: string[] | null;
}): Promise<{ enabled: boolean; connectionIds: string[] }> {
  if (!supportsInstagramWhatsappRelink(input.publicationType)) {
    return {
      enabled: false,
      connectionIds: [],
    };
  }

  const enabled = Boolean(input.enabledValue);
  if (!enabled) {
    return {
      enabled: false,
      connectionIds: [],
    };
  }

  if (!supportsInstagramWhatsappRelinkForJobMedia(input.publicationType, input.encodedFilePath)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["whatsappRelinkEnabled"],
        message: "Relink no WhatsApp para stories funciona apenas com 1 mídia por vez.",
      },
    ]);
  }

  const normalizedIds = normalizeWhatsappRelinkConnectionIds(input.connectionIdsValue);
  if (normalizedIds.length === 0) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["whatsappRelinkConnectionIds"],
        message: "Selecione ao menos uma conta de WhatsApp para relink.",
      },
    ]);
  }

  const allowedConnections = await prisma.socialConnection.findMany({
    where: {
      id: { in: normalizedIds },
      platform: "whatsapp",
      authStatus: "CONNECTED",
      createdByUserId: isRootUser(input.request) ? undefined : input.request.adminUser?.id,
    },
    select: {
      id: true,
    },
  });

  if (allowedConnections.length !== normalizedIds.length) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["whatsappRelinkConnectionIds"],
        message: "Selecione apenas contas de WhatsApp conectadas e permitidas para seu usuário.",
      },
    ]);
  }

  const allowedSet = new Set(allowedConnections.map((connection) => connection.id));
  return {
    enabled: true,
    connectionIds: normalizedIds.filter((id) => allowedSet.has(id)),
  };
}

async function ensureMatchingConnection(input: {
  request: Request & { adminUser?: AdminUserAuth };
  socialConnectionId: string;
  companyId: string;
  publicationType: PublicationType;
}): Promise<void> {
  const expectedPlatform = platformForPublication(input.publicationType);
  const connection = await prisma.socialConnection.findUnique({
    where: { id: input.socialConnectionId },
    select: {
      id: true,
      companyId: true,
      createdByUserId: true,
      platform: true,
      authStatus: true,
    },
  });

  if (!connection) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["socialConnectionId"],
        message: "Conta social selecionada nao encontrada.",
      },
    ]);
  }

  if (connection.companyId !== input.companyId) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["socialConnectionId"],
        message: "A conta social precisa pertencer ao mesmo perfil da postagem.",
      },
    ]);
  }

  if (!isRootUser(input.request) && connection.createdByUserId !== input.request.adminUser?.id) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["socialConnectionId"],
        message: "A conta social precisa pertencer ao usuário autenticado.",
      },
    ]);
  }

  if (connection.platform !== expectedPlatform) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["socialConnectionId"],
        message: "A conta social escolhida nao corresponde a rede exigida por esse tipo de publicacao.",
      },
    ]);
  }

  if (connection.authStatus !== "CONNECTED") {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["socialConnectionId"],
        message: "A conta social precisa estar conectada antes de agendar uma postagem.",
      },
    ]);
  }
}

async function resolveAutomaticInstagramLocation(input: {
  publicationType: PublicationType;
  socialConnectionId: string;
  locationName?: string | null;
  locationId?: string | null;
}): Promise<{ locationName: string | null; locationId: string | null }> {
  const normalizedLocationName = input.locationName?.trim() || null;
  const normalizedLocationId = input.locationId?.trim() || null;

  if (!isInstagramPublication(input.publicationType)) {
    return {
      locationName: normalizedLocationName,
      locationId: normalizedLocationId,
    };
  }

  if (!isInstagramLocationSupportedPublication(input.publicationType)) {
    return {
      locationName: null,
      locationId: null,
    };
  }

  if (INSTAGRAM_FORCED_LOCATION_ID || normalizedLocationId) {
    return {
      locationName: normalizedLocationName,
      locationId: normalizedLocationId,
    };
  }

  return {
    locationName: normalizedLocationName,
    locationId: null,
  };
}

function isRootUser(request: Request & { adminUser?: AdminUserAuth }): boolean {
  return request.adminUser?.username === "root";
}

function serializeJobForClient(job: Prisma.JobGetPayload<Record<string, never>>) {
  const locationMetadata = decodeInstagramLocationStorage(job.locationName);
  const mediaBundle = decodeJobMediaBundleStorage(job.filePath);

  return {
    id: job.id,
    companyId: job.companyId,
    socialConnectionId: job.socialConnectionId,
    filePath: mediaBundle.files[0] ?? job.filePath,
    filePaths: mediaBundle.files,
    fileCaptions: mediaBundle.captions,
    sequential: mediaBundle.sequential,
    title: job.title,
    caption: job.caption,
    firstComment: job.firstComment,
    whatsappBackgroundColor: job.whatsappBackgroundColor ?? null,
    whatsappRelinkEnabled: Boolean(job.whatsappRelinkEnabled),
    whatsappRelinkConnectionIds: parseStoredWhatsappRelinkConnectionIds(job.whatsappRelinkConnectionIds),
    instagramPermalink: job.instagramPermalink ?? null,
    locationName: locationMetadata.locationName,
    locationId: locationMetadata.locationId,
    publicationType: normalizePublicationType(job),
    publicationState: normalizePublicationState(job.publicationState),
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
  };
}

function companyVisibilityWhere(
  request: Request & { adminUser?: AdminUserAuth },
  companyId?: string,
) {
  return {
    id: companyId ?? undefined,
    createdByUserId: isRootUser(request) ? undefined : request.adminUser?.id,
  };
}

function connectionVisibilityWhere(
  request: Request & { adminUser?: AdminUserAuth },
  companyId?: string,
) {
  return {
    companyId: companyId ?? undefined,
    createdByUserId: isRootUser(request) ? undefined : request.adminUser?.id,
  };
}

function jobVisibilityWhere(
  request: Request & { adminUser?: AdminUserAuth },
  companyId?: string,
  status?: string,
) {
  return {
    companyId: companyId ?? undefined,
    status: status ?? undefined,
    createdByUserId: isRootUser(request) ? undefined : request.adminUser?.id,
    NOT: {
      publicationType: "whatsapp_status_texto",
    },
  };
}

function normalizePlanCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function trimNullable(value?: string | null): string | null {
  const normalized = (value || "").trim();
  return normalized ? normalized : null;
}

function ensureStripeClient(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("Integração Stripe não configurada. Defina STRIPE_SECRET_KEY no backend.");
  }

  if (!stripeClientSingleton) {
    stripeClientSingleton = new Stripe(STRIPE_SECRET_KEY);
  }

  return stripeClientSingleton;
}

async function createStripeCouponForUserDiscount(input: {
  stripe: Stripe;
  userId: string;
  username: string;
  percent: number;
}): Promise<string | null> {
  const normalizedPercent = Math.max(0, Math.min(100, Math.trunc(input.percent)));
  if (normalizedPercent <= 0) {
    return null;
  }

  const coupon = await input.stripe.coupons.create({
    duration: "forever",
    percent_off: normalizedPercent,
    name: `SocialUp ${normalizedPercent}% @${input.username}`,
    metadata: {
      socialupUserId: input.userId,
      socialupDiscountPercent: String(normalizedPercent),
    },
  });

  return coupon.id;
}

async function resolveStripeSubscriptionIdFromCustomer(input: {
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<string | null> {
  const list = await input.stripe.subscriptions.list({
    customer: input.stripeCustomerId,
    status: "all",
    limit: 20,
  });

  const activeOrPending = list.data.find((subscription) =>
    ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(subscription.status),
  );

  return activeOrPending?.id ?? null;
}

function appendQueryParam(rawUrl: string, key: string, value: string): string {
  if (!rawUrl.trim()) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    const separator = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

function buildStripeCheckoutSuccessUrl(): string {
  const fallbackUrl = "http://localhost:5173/meu-plano?stripeCheckout=success&session_id={CHECKOUT_SESSION_ID}";
  let url = STRIPE_CHECKOUT_SUCCESS_URL || fallbackUrl;

  if (!url.includes("{CHECKOUT_SESSION_ID}")) {
    url = appendQueryParam(url, "session_id", "{CHECKOUT_SESSION_ID}");
  }
  if (!/[?&]stripeCheckout=/.test(url)) {
    url = appendQueryParam(url, "stripeCheckout", "success");
  }
  return url;
}

function buildStripeCheckoutCancelUrl(): string {
  const fallbackUrl = "http://localhost:5173/meu-plano?stripeCheckout=cancel";
  let url = STRIPE_CHECKOUT_CANCEL_URL || fallbackUrl;
  if (!/[?&]stripeCheckout=/.test(url)) {
    url = appendQueryParam(url, "stripeCheckout", "cancel");
  }
  return url;
}

function addBillingCycleWindow(fromDate: Date, cycle: "MONTHLY" | "YEARLY"): Date {
  const next = new Date(fromDate.getTime());
  if (cycle === "YEARLY") {
    next.setFullYear(next.getFullYear() + 1);
    return next;
  }
  next.setMonth(next.getMonth() + 1);
  return next;
}

type StripeBillingModel = "STRIPE_SUBSCRIPTION" | "PIX_MANUAL";
type StripeBillingCycle = "MONTHLY" | "YEARLY";

function parseStripeBillingModel(value: string | null | undefined): StripeBillingModel | null {
  if (value === "STRIPE_SUBSCRIPTION" || value === "PIX_MANUAL") {
    return value;
  }
  return null;
}

function parseStripeBillingCycle(value: string | null | undefined): StripeBillingCycle | null {
  if (value === "MONTHLY" || value === "YEARLY") {
    return value;
  }
  return null;
}

async function applyStripeCheckoutSessionActivation(session: Stripe.Checkout.Session): Promise<{
  applied: boolean;
  userId: string | null;
  billingModel: StripeBillingModel | null;
  cycle: StripeBillingCycle | null;
  message: string;
}> {
  const metadataUserId = trimNullable(session.metadata?.socialupUserId);
  const sessionUserId = trimNullable(session.client_reference_id);
  const userId = metadataUserId || sessionUserId;
  const planId = trimNullable(session.metadata?.socialupPlanId);
  const billingModel = parseStripeBillingModel(trimNullable(session.metadata?.socialupBillingModel));
  const cycle = parseStripeBillingCycle(trimNullable(session.metadata?.socialupCycle));
  const stripePriceId = trimNullable(session.metadata?.socialupPriceId);

  if (!userId || !planId || !billingModel || !cycle) {
    return {
      applied: false,
      userId,
      billingModel,
      cycle,
      message: "Checkout sem metadados obrigatórios.",
    };
  }

  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: { id: true, isActive: true, isTrial: true },
  });
  if (!plan || !plan.isActive || plan.isTrial) {
    return {
      applied: false,
      userId,
      billingModel,
      cycle,
      message: "Plano inválido para ativação via Stripe.",
    };
  }

  if (billingModel === "PIX_MANUAL" && session.payment_status !== "paid") {
    return {
      applied: false,
      userId,
      billingModel,
      cycle,
      message: "Pagamento PIX ainda não confirmado.",
    };
  }

  const now = new Date();
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
  const stripeSubscriptionIdFromSession = (() => {
    if (typeof session.subscription === "string") {
      return session.subscription;
    }
    if (
      session.subscription &&
      typeof session.subscription === "object" &&
      "id" in session.subscription &&
      typeof session.subscription.id === "string"
    ) {
      return session.subscription.id;
    }
    return null;
  })();
  const stripeSubscriptionId =
    billingModel === "STRIPE_SUBSCRIPTION" ? stripeSubscriptionIdFromSession : null;
  const endsAt = billingModel === "PIX_MANUAL" ? addBillingCycleWindow(now, cycle) : null;

  await prisma.userPlanSubscription.upsert({
    where: { userId },
    update: {
      planId: plan.id,
      status: "ACTIVE",
      billingModel,
      cycle,
      startsAt: now,
      endsAt,
      trialEndsAt: null,
      blockedReason: null,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
    },
    create: {
      userId,
      planId: plan.id,
      status: "ACTIVE",
      billingModel,
      cycle,
      startsAt: now,
      endsAt,
      trialEndsAt: null,
      blockedReason: null,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
    },
  });

  return {
    applied: true,
    userId,
    billingModel,
    cycle,
    message: "Plano ativado com sucesso pelo Stripe.",
  };
}

async function updateSubscriptionStatusFromStripe(input: {
  userId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  status: "ACTIVE" | "PAYMENT_REQUIRED" | "EXPIRED" | "BLOCKED";
  blockedReason?: string | null;
  clearEndsAt?: boolean;
}): Promise<{
  updated: boolean;
  userId: string | null;
}> {
  const normalizedUserId = trimNullable(input.userId);
  const normalizedStripeSubscriptionId = trimNullable(input.stripeSubscriptionId);
  const normalizedStripeCustomerId = trimNullable(input.stripeCustomerId);

  let subscription:
    | {
        id: string;
        userId: string;
      }
    | null = null;

  if (normalizedUserId) {
    subscription = await prisma.userPlanSubscription.findUnique({
      where: { userId: normalizedUserId },
      select: { id: true, userId: true },
    });
  }

  if (!subscription && normalizedStripeSubscriptionId) {
    subscription = await prisma.userPlanSubscription.findFirst({
      where: { stripeSubscriptionId: normalizedStripeSubscriptionId },
      select: { id: true, userId: true },
    });
  }

  if (!subscription && normalizedStripeCustomerId) {
    subscription = await prisma.userPlanSubscription.findFirst({
      where: { stripeCustomerId: normalizedStripeCustomerId },
      select: { id: true, userId: true },
    });
  }

  if (!subscription) {
    return { updated: false, userId: null };
  }

  await prisma.userPlanSubscription.update({
    where: { id: subscription.id },
    data: {
      status: input.status,
      blockedReason: input.blockedReason ?? null,
      ...(input.clearEndsAt ? { endsAt: null } : {}),
    },
  });

  return { updated: true, userId: subscription.userId };
}

async function handleStripePixSessionUnpaid(session: Stripe.Checkout.Session, reason: string): Promise<void> {
  const billingModel = parseStripeBillingModel(trimNullable(session.metadata?.socialupBillingModel));
  if (billingModel !== "PIX_MANUAL") {
    return;
  }

  const metadataUserId = trimNullable(session.metadata?.socialupUserId);
  const sessionUserId = trimNullable(session.client_reference_id);
  const userId = metadataUserId || sessionUserId;
  if (!userId) {
    return;
  }

  const currentSubscription = await prisma.userPlanSubscription.findUnique({
    where: { userId },
    select: {
      status: true,
      billingModel: true,
      endsAt: true,
    },
  });

  if (!currentSubscription) {
    return;
  }

  const now = Date.now();
  const stillInsideActiveWindow =
    currentSubscription.status === "ACTIVE" &&
    currentSubscription.billingModel === "PIX_MANUAL" &&
    currentSubscription.endsAt !== null &&
    currentSubscription.endsAt.getTime() > now;
  if (stillInsideActiveWindow) {
    return;
  }

  const result = await updateSubscriptionStatusFromStripe({
    userId,
    status: "PAYMENT_REQUIRED",
    blockedReason: reason,
  });
  if (result.updated && result.userId) {
    await appendBillingAvisoSafely({
      userId: result.userId,
      title: "Pagamento pendente",
      message: reason,
      kind: "BILLING_PENDING",
    });
  }
}

async function handleStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const activation = await applyStripeCheckoutSessionActivation(session);
      if (activation.applied && activation.userId) {
        await appendBillingAvisoSafely({
          userId: activation.userId,
          title: "Pagamento confirmado",
          message:
            activation.billingModel === "PIX_MANUAL"
              ? "Pagamento PIX confirmado. Plano ativo."
              : "Assinatura ativa e confirmada pelo Stripe.",
          kind: "BILLING_PAID",
        });
      }
      return;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleStripePixSessionUnpaid(
        session,
        "Cobrança PIX expirada ou não paga no prazo. Sua conta foi bloqueada até a regularização.",
      );
      return;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const invoiceSubscriptionId = trimNullable((invoice as { subscription?: unknown }).subscription as string | null);
      const result = await updateSubscriptionStatusFromStripe({
        stripeSubscriptionId: invoiceSubscriptionId,
        stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
        status: "PAYMENT_REQUIRED",
        blockedReason: "Falha no pagamento recorrente. Regularize para continuar usando o painel.",
      });
      if (result.updated && result.userId) {
        await appendBillingAvisoSafely({
          userId: result.userId,
          title: "Pagamento pendente",
          message: "Falha no pagamento recorrente. A conta foi bloqueada até regularização.",
          kind: "BILLING_PENDING",
        });
      }
      return;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const invoiceSubscriptionId = trimNullable((invoice as { subscription?: unknown }).subscription as string | null);
      const result = await updateSubscriptionStatusFromStripe({
        stripeSubscriptionId: invoiceSubscriptionId,
        stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
        status: "ACTIVE",
        blockedReason: null,
        clearEndsAt: true,
      });
      if (result.updated && result.userId) {
        await appendBillingAvisoSafely({
          userId: result.userId,
          title: "Pagamento confirmado",
          message: "Pagamento recorrente confirmado. A conta está ativa.",
          kind: "BILLING_PAID",
        });
      }
      return;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const result = await updateSubscriptionStatusFromStripe({
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
        status: "EXPIRED",
        blockedReason: "Assinatura cancelada no Stripe. Renove para continuar usando o painel.",
      });
      if (result.updated && result.userId) {
        await appendBillingAvisoSafely({
          userId: result.userId,
          title: "Assinatura cancelada",
          message: "Assinatura cancelada no Stripe. Renove para recuperar acesso.",
          kind: "BILLING_EXPIRED",
        });
      }
      return;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const normalizedStatus = (subscription.status || "").toLowerCase();
      const isHealthy = normalizedStatus === "active" || normalizedStatus === "trialing";
      const result = await updateSubscriptionStatusFromStripe({
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
        status: isHealthy ? "ACTIVE" : "PAYMENT_REQUIRED",
        blockedReason: isHealthy
          ? null
          : "Assinatura com pendência no Stripe. Regularize para continuar usando o painel.",
        clearEndsAt: isHealthy,
      });
      if (result.updated && result.userId) {
        await appendBillingAvisoSafely({
          userId: result.userId,
          title: isHealthy ? "Assinatura ativa" : "Assinatura com pendência",
          message: isHealthy
            ? "Assinatura recorrente ativa no Stripe."
            : "Assinatura recorrente com pendência no Stripe. Conta bloqueada até regularização.",
          kind: isHealthy ? "BILLING_PAID" : "BILLING_PENDING",
        });
      }
      return;
    }
    default:
      return;
  }
}

type ResolvedStripePlanPriceIds = {
  stripeMonthlyPriceId: string | null;
  stripeYearlyPriceId: string | null;
  stripePixMonthlyPriceId: string | null;
  stripePixYearlyPriceId: string | null;
  stripeMonthlyPriceCents: number | null;
  stripeYearlyPriceCents: number | null;
  stripePixMonthlyPriceCents: number | null;
  stripePixYearlyPriceCents: number | null;
};

const EMPTY_STRIPE_PLAN_PRICE_IDS: ResolvedStripePlanPriceIds = {
  stripeMonthlyPriceId: null,
  stripeYearlyPriceId: null,
  stripePixMonthlyPriceId: null,
  stripePixYearlyPriceId: null,
  stripeMonthlyPriceCents: null,
  stripeYearlyPriceCents: null,
  stripePixMonthlyPriceCents: null,
  stripePixYearlyPriceCents: null,
};

let stripePixAvailabilityCache:
  | {
      value: boolean;
      expiresAtMs: number;
    }
  | null = null;

function normalizeStripeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function stripePriceContainsAnyTag(price: Stripe.Price, tags: string[]): boolean {
  const searchableParts: string[] = [];
  if (price.nickname) {
    searchableParts.push(price.nickname);
  }
  if (price.lookup_key) {
    searchableParts.push(price.lookup_key);
  }
  for (const metadataValue of Object.values(price.metadata || {})) {
    searchableParts.push(String(metadataValue || ""));
  }

  const searchable = normalizeStripeSearchText(searchableParts.join(" "));
  if (!searchable) {
    return false;
  }

  return tags.some((tag) => searchable.includes(normalizeStripeSearchText(tag)));
}

function resolveStripePlanPriceIdsFromPriceList(prices: Stripe.Price[]): ResolvedStripePlanPriceIds {
  const activePrices = prices.filter((price) => price.active);
  const recurringPrices = activePrices.filter((price) => price.type === "recurring");
  const oneTimePrices = activePrices.filter((price) => price.type === "one_time");

  const monthlyRecurring = recurringPrices.find(
    (price) => price.recurring?.interval === "month" && (price.recurring.interval_count ?? 1) === 1,
  );
  const yearlyRecurring = recurringPrices.find(
    (price) =>
      (price.recurring?.interval === "year" && (price.recurring.interval_count ?? 1) === 1) ||
      (price.recurring?.interval === "month" && (price.recurring.interval_count ?? 1) === 12),
  );

  const pixTaggedOneTimePrices = oneTimePrices.filter((price) => stripePriceContainsAnyTag(price, ["pix"]));
  const oneTimePool = pixTaggedOneTimePrices.length > 0 ? pixTaggedOneTimePrices : oneTimePrices;
  const oneTimePoolSortedByAmount = [...oneTimePool].sort((left, right) => {
    const leftAmount = left.unit_amount ?? Number.MAX_SAFE_INTEGER;
    const rightAmount = right.unit_amount ?? Number.MAX_SAFE_INTEGER;
    if (leftAmount !== rightAmount) {
      return leftAmount - rightAmount;
    }
    return left.id.localeCompare(right.id);
  });

  const monthlyRecurringPrice = monthlyRecurring?.unit_amount ?? null;
  const yearlyRecurringPrice = yearlyRecurring?.unit_amount ?? null;

  const findOneTimeByAmount = (amount: number | null, excludedIds: Set<string>): Stripe.Price | null => {
    if (amount === null) {
      return null;
    }
    return oneTimePoolSortedByAmount.find((price) => price.unit_amount === amount && !excludedIds.has(price.id)) ?? null;
  };

  const monthlyPix = oneTimePool.find((price) =>
    stripePriceContainsAnyTag(price, ["mensal", "monthly", "mes", "month"]),
  );
  const yearlyPix = oneTimePool.find((price) =>
    stripePriceContainsAnyTag(price, ["anual", "annual", "yearly", "ano", "year"]),
  );

  let stripePixMonthlyPriceId =
    monthlyPix?.id ??
    findOneTimeByAmount(monthlyRecurringPrice, new Set())?.id ??
    oneTimePoolSortedByAmount[0]?.id ??
    null;

  const usedOneTimeIds = new Set<string>();
  if (stripePixMonthlyPriceId) {
    usedOneTimeIds.add(stripePixMonthlyPriceId);
  }

  let stripePixYearlyPriceId =
    yearlyPix?.id ??
    findOneTimeByAmount(yearlyRecurringPrice, usedOneTimeIds)?.id ??
    oneTimePoolSortedByAmount.find((price) => !usedOneTimeIds.has(price.id))?.id ??
    oneTimePoolSortedByAmount[0]?.id ??
    null;

  const monthlyPixPrice =
    oneTimePoolSortedByAmount.find((price) => price.id === stripePixMonthlyPriceId)?.unit_amount ?? null;
  const yearlyPixPrice =
    oneTimePoolSortedByAmount.find((price) => price.id === stripePixYearlyPriceId)?.unit_amount ?? null;

  return {
    stripeMonthlyPriceId: monthlyRecurring?.id ?? null,
    stripeYearlyPriceId: yearlyRecurring?.id ?? null,
    stripePixMonthlyPriceId,
    stripePixYearlyPriceId,
    stripeMonthlyPriceCents: monthlyRecurringPrice,
    stripeYearlyPriceCents: yearlyRecurringPrice,
    stripePixMonthlyPriceCents: monthlyPixPrice,
    stripePixYearlyPriceCents: yearlyPixPrice,
  };
}

async function resolveStripePlanPriceIdsFromProduct(stripeProductId: string): Promise<ResolvedStripePlanPriceIds> {
  const stripe = ensureStripeClient();
  const pricesResponse = await stripe.prices.list({
    product: stripeProductId,
    active: true,
    limit: 100,
  });
  return resolveStripePlanPriceIdsFromPriceList(pricesResponse.data);
}

async function resolveStripePixAvailability(): Promise<boolean> {
  if (!STRIPE_SECRET_KEY) {
    return false;
  }

  const now = Date.now();
  if (stripePixAvailabilityCache && stripePixAvailabilityCache.expiresAtMs > now) {
    return stripePixAvailabilityCache.value;
  }

  const stripe = ensureStripeClient();
  const account = await stripe.accounts.retrieve();
  const pixCapability = account.capabilities?.pix_payments;
  const value = pixCapability === "active";
  stripePixAvailabilityCache = {
    value,
    expiresAtMs: now + 5 * 60 * 1000,
  };
  return value;
}

function listMissingRequiredStripePriceKinds(priceIds: ResolvedStripePlanPriceIds): string[] {
  const missing: string[] = [];
  if (!priceIds.stripeMonthlyPriceId) {
    missing.push("assinatura mensal");
  }
  if (!priceIds.stripeYearlyPriceId) {
    missing.push("assinatura anual");
  }
  return missing;
}

type BillingSettingsSnapshot = {
  autoTrialEnabled: boolean;
  autoTrialDays: number;
  rootDisplayPlanId: string | null;
};

type BillingAccessSnapshot = {
  status: string;
  billingModel: string;
  cycle: string | null;
  stripeSubscriptionId: string | null;
  stripeCancelAtPeriodEnd: boolean;
  plan: {
    id: string;
    code: string;
    name: string;
    isTrial: boolean;
    maxProfiles: number;
    maxConnections: number;
    maxMonthlyPublications: number;
  } | null;
  usage: {
    profilesUsed: number;
    connectionsUsed: number;
    postsUsedThisMonth: number;
  };
  isBlocked: boolean;
  blockMessage: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  trialEndsAt: Date | null;
};

async function getBillingSettingsSnapshot(): Promise<BillingSettingsSnapshot> {
  const [autoTrialEnabledSetting, autoTrialDaysSetting, rootDisplayPlanIdSetting] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: BILLING_SETTING_AUTO_TRIAL_ENABLED } }),
    prisma.appSetting.findUnique({ where: { key: BILLING_SETTING_AUTO_TRIAL_DAYS } }),
    prisma.appSetting.findUnique({ where: { key: BILLING_SETTING_ROOT_DISPLAY_PLAN_ID } }),
  ]);

  const autoTrialEnabled =
    autoTrialEnabledSetting?.value === undefined
      ? DEFAULT_AUTO_TRIAL_ENABLED
      : parseEnvBoolean(autoTrialEnabledSetting.value, DEFAULT_AUTO_TRIAL_ENABLED);
  const parsedTrialDays = Number.parseInt((autoTrialDaysSetting?.value || "").trim(), 10);
  const autoTrialDays =
    Number.isFinite(parsedTrialDays) && parsedTrialDays >= 0 && parsedTrialDays <= 60
      ? parsedTrialDays
      : DEFAULT_AUTO_TRIAL_DAYS;

  return {
    autoTrialEnabled,
    autoTrialDays,
    rootDisplayPlanId: trimNullable(rootDisplayPlanIdSetting?.value),
  };
}

async function upsertBillingSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function ensureBillingBootstrap(): Promise<void> {
  const trial = DEFAULT_BILLING_TRIAL_PLAN;
  await prisma.plan.upsert({
    where: { code: trial.code },
    update: {},
    create: {
      code: trial.code,
      name: trial.name,
      description: trial.description,
      isActive: true,
      isTrial: true,
      maxProfiles: trial.maxProfiles,
      maxConnections: trial.maxConnections,
      maxMonthlyPublications: trial.maxMonthlyPublications,
      monthlyPriceCents: null,
      yearlyPriceCents: null,
    },
  });

  await Promise.all([
    prisma.appSetting.upsert({
      where: { key: BILLING_SETTING_AUTO_TRIAL_ENABLED },
      update: {},
      create: {
        key: BILLING_SETTING_AUTO_TRIAL_ENABLED,
        value: DEFAULT_AUTO_TRIAL_ENABLED ? "true" : "false",
      },
    }),
    prisma.appSetting.upsert({
      where: { key: BILLING_SETTING_AUTO_TRIAL_DAYS },
      update: {},
      create: {
        key: BILLING_SETTING_AUTO_TRIAL_DAYS,
        value: String(DEFAULT_AUTO_TRIAL_DAYS),
      },
    }),
    prisma.appSetting.upsert({
      where: { key: BILLING_SETTING_ROOT_DISPLAY_PLAN_ID },
      update: {},
      create: {
        key: BILLING_SETTING_ROOT_DISPLAY_PLAN_ID,
        value: "",
      },
    }),
  ]);

  // Limpeza de planos pagos legados criados automaticamente (sem vínculo Stripe e sem assinaturas).
  await prisma.plan.deleteMany({
    where: {
      code: { in: ["START", "BUSINESS"] },
      isTrial: false,
      stripeProductId: null,
      subscriptions: {
        none: {},
      },
    },
  });

  const settings = await getBillingSettingsSnapshot();
  await syncTrialPlanLimitsFromSettings(settings.autoTrialDays);
}

async function getBestActivePlanForDisplay() {
  return prisma.plan.findFirst({
    where: { isActive: true },
    orderBy: [
      { maxMonthlyPublications: "desc" },
      { maxConnections: "desc" },
      { maxProfiles: "desc" },
      { yearlyPriceCents: "desc" },
      { monthlyPriceCents: "desc" },
      { createdAt: "asc" },
    ],
  });
}

async function getRootDisplayPlanForDisplay() {
  const settings = await getBillingSettingsSnapshot();
  if (settings.rootDisplayPlanId) {
    const selectedPlan = await prisma.plan.findUnique({
      where: { id: settings.rootDisplayPlanId },
    });
    if (selectedPlan) {
      return selectedPlan;
    }
  }

  return getBestActivePlanForDisplay();
}

function clampTrialDaysForLimits(days: number): number {
  return Math.max(1, Math.min(BILLING_TRIAL_REFERENCE_DAYS, days));
}

function scaleLimitByTrialDays(value: number, trialDays: number): number {
  const ratio = clampTrialDaysForLimits(trialDays) / BILLING_TRIAL_REFERENCE_DAYS;
  const scaled = Math.round(value * ratio);
  return Math.max(1, scaled);
}

async function syncTrialPlanLimitsFromSettings(trialDays: number): Promise<void> {
  const [trialPlan, startPlanByCode] = await Promise.all([
    prisma.plan.findUnique({
      where: { code: BILLING_TRIAL_PLAN_CODE },
      select: { id: true },
    }),
    prisma.plan.findUnique({
      where: { code: "START" },
      select: { maxProfiles: true, maxConnections: true, maxMonthlyPublications: true },
    }),
  ]);

  const trialReferencePlan =
    startPlanByCode ??
    (await prisma.plan.findFirst({
      where: {
        isActive: true,
        isTrial: false,
      },
      orderBy: [{ createdAt: "asc" }],
      select: { maxProfiles: true, maxConnections: true, maxMonthlyPublications: true },
    }));

  if (!trialPlan || !trialReferencePlan) {
    return;
  }

  const nextMaxProfiles = scaleLimitByTrialDays(trialReferencePlan.maxProfiles, trialDays);
  const nextMaxConnections = Math.max(
    nextMaxProfiles,
    scaleLimitByTrialDays(trialReferencePlan.maxConnections, trialDays),
  );
  const nextMaxMonthlyPublications = scaleLimitByTrialDays(trialReferencePlan.maxMonthlyPublications, trialDays);

  await prisma.plan.update({
    where: { id: trialPlan.id },
    data: {
      maxProfiles: nextMaxProfiles,
      maxConnections: nextMaxConnections,
      maxMonthlyPublications: nextMaxMonthlyPublications,
    },
  });
}

function currentMonthBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function computeBillingBlockMessage(
  status: string,
  planName: string | null,
  options?: {
    billingModel?: string | null;
    trialEndsAt?: Date | null;
    now?: Date;
  },
): string | null {
  const now = options?.now ?? new Date();
  const trialExpired =
    Boolean(options?.trialEndsAt) && (options?.trialEndsAt?.getTime() ?? 0) <= now.getTime();
  const cameFromTrial =
    options?.billingModel === "TRIAL" || (options?.billingModel === "NONE" && trialExpired);

  if (status === "ACTIVE" || status === "TRIALING") {
    return null;
  }
  if (cameFromTrial) {
    return "Seu período de teste expirou. Ative um plano para continuar usando o painel.";
  }
  if (status === "PAYMENT_REQUIRED") {
    return "Sua conta está sem plano ativo. Renove para continuar usando o painel.";
  }
  if (status === "EXPIRED") {
    return "Seu plano expirou. Renove para continuar usando o painel.";
  }
  if (status === "BLOCKED") {
    return "Sua conta está bloqueada por pagamento pendente. Renove para continuar.";
  }
  if (!planName) {
    return "Sua conta está sem plano ativo. Renove para continuar usando o painel.";
  }
  return `Seu acesso ao plano ${planName} está bloqueado.`;
}

async function resolveUserBillingAccess(userId: string): Promise<BillingAccessSnapshot> {
  const now = new Date();
  const monthBounds = currentMonthBounds(now);
  const [subscription, profilesUsed, connectionsUsed, postsUsedThisMonth] = await Promise.all([
    prisma.userPlanSubscription.findUnique({
      where: { userId },
      include: {
        plan: {
          select: {
            id: true,
            code: true,
            name: true,
            isTrial: true,
            maxProfiles: true,
            maxConnections: true,
            maxMonthlyPublications: true,
            isActive: true,
          },
        },
      },
    }),
    prisma.company.count({
      where: {
        createdByUserId: userId,
      },
    }),
    prisma.socialConnection.count({
      where: {
        createdByUserId: userId,
      },
    }),
    prisma.job.count({
      where: {
        createdByUserId: userId,
        publicationState: "PUBLISHED",
        criadoEm: {
          gte: monthBounds.start,
          lt: monthBounds.end,
        },
      },
    }),
  ]);

  if (!subscription) {
    return {
      status: "PAYMENT_REQUIRED",
      billingModel: "NONE",
      cycle: null,
      stripeSubscriptionId: null,
      stripeCancelAtPeriodEnd: false,
      plan: null,
      usage: {
        profilesUsed,
        connectionsUsed,
        postsUsedThisMonth,
      },
      isBlocked: true,
      blockMessage: computeBillingBlockMessage("PAYMENT_REQUIRED", null),
      startsAt: null,
      endsAt: null,
      trialEndsAt: null,
    };
  }

  let resolvedPlan = subscription.plan;
  const subscriptionStripePriceId = trimNullable(subscription.stripePriceId);
  if (!resolvedPlan && subscriptionStripePriceId) {
    const fallbackPlan = await prisma.plan.findFirst({
      where: {
        isActive: true,
        OR: [
          { stripeMonthlyPriceId: subscriptionStripePriceId },
          { stripeYearlyPriceId: subscriptionStripePriceId },
          { stripePixMonthlyPriceId: subscriptionStripePriceId },
          { stripePixYearlyPriceId: subscriptionStripePriceId },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        isTrial: true,
        maxProfiles: true,
        maxConnections: true,
        maxMonthlyPublications: true,
        isActive: true,
      },
    });

    if (fallbackPlan) {
      resolvedPlan = fallbackPlan;
      if (!subscription.planId) {
        await prisma.userPlanSubscription.update({
          where: { id: subscription.id },
          data: {
            planId: fallbackPlan.id,
          },
        });
      }
    }
  }

  let status = subscription.status;
  const trialExpired = subscription.trialEndsAt ? subscription.trialEndsAt.getTime() <= now.getTime() : false;
  const endsAtExpired = subscription.endsAt ? subscription.endsAt.getTime() <= now.getTime() : false;
  const planIsActive = resolvedPlan?.isActive ?? false;
  const effectivePlanId = subscription.planId ?? resolvedPlan?.id ?? null;

  if ((trialExpired && subscription.billingModel === "TRIAL") || endsAtExpired || !planIsActive || !effectivePlanId) {
    status = "EXPIRED";
    if (subscription.status !== "EXPIRED") {
      await prisma.userPlanSubscription.update({
        where: { id: subscription.id },
        data: {
          status: "EXPIRED",
          blockedReason: planIsActive ? "Plano expirado." : "Plano inativo ou removido.",
        },
      });
    }
  }

  const isBlocked = status !== "ACTIVE" && status !== "TRIALING";
  const exposedPlan = subscription.billingModel === "NONE" ? null : resolvedPlan;
  const planName = exposedPlan?.name ?? null;

  return {
    status,
    billingModel: subscription.billingModel,
    cycle: subscription.cycle,
    stripeSubscriptionId: trimNullable(subscription.stripeSubscriptionId),
    stripeCancelAtPeriodEnd: Boolean(subscription.endsAt && subscription.billingModel === "STRIPE_SUBSCRIPTION"),
    plan: exposedPlan
      ? {
          id: exposedPlan.id,
          code: exposedPlan.code,
          name: exposedPlan.name,
          isTrial: exposedPlan.isTrial,
          maxProfiles: exposedPlan.maxProfiles,
          maxConnections: exposedPlan.maxConnections,
          maxMonthlyPublications: exposedPlan.maxMonthlyPublications,
        }
      : null,
    usage: {
      profilesUsed,
      connectionsUsed,
      postsUsedThisMonth,
    },
    isBlocked,
    blockMessage: isBlocked
      ? computeBillingBlockMessage(status, planName, {
          billingModel: subscription.billingModel,
          trialEndsAt: subscription.trialEndsAt,
          now,
        })
      : null,
    startsAt: subscription.startsAt,
    endsAt: subscription.endsAt,
    trialEndsAt: subscription.trialEndsAt,
  };
}

async function ensureBillingWritableAccess(request: Request & { adminUser?: AdminUserAuth }): Promise<BillingAccessSnapshot | null> {
  if (isRootUser(request)) {
    return null;
  }

  const userId = request.adminUser?.id;
  if (!userId) {
    throw new Error("Sessão inválida para validar plano.");
  }

  const access = await resolveUserBillingAccess(userId);
  if (access.isBlocked) {
    throw new Error(access.blockMessage || "Sua conta está bloqueada para novas operações.");
  }
  return access;
}

async function resolveJobBillingBlockMessage(job: { createdByUserId: string | null }): Promise<string | null> {
  const userId = job.createdByUserId;
  if (!userId) {
    return null;
  }

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });
  if (!owner || owner.username === "root") {
    return null;
  }

  const billing = await resolveUserBillingAccess(userId);
  return billing.isBlocked
    ? billing.blockMessage || "Conta bloqueada por pagamento pendente. Renove para continuar."
    : null;
}

async function failJobDueToBillingBlocked(
  job: Parameters<typeof appendJobAvisoSafely>[0] & { companyId: string },
  message: string,
): Promise<void> {
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      lastError: message,
    },
  });

  await appendLog({
    companyId: job.companyId,
    level: "WARN",
    errorCode: "BILLING_BLOCKED",
    message: `Job ${job.id} bloqueado por billing: ${message}`,
  });

  await appendJobAvisoSafely(job, {
    title: "Conta bloqueada",
    kind: "JOB_FAILED",
    message,
  });
}

async function buildAuthUserPayload(user: {
  id: string;
  name: string;
  username: string;
  timeZone: string;
  role: string;
}): Promise<{
  id: string;
  name: string;
  username: string;
  timeZone: string;
  role: string;
  billingStatus: string;
  billingPlanName: string | null;
  billingPlanCode: string | null;
  billingIsBlocked: boolean;
  billingBlockMessage: string | null;
  billingEndsAt: Date | null;
  billingTrialEndsAt: Date | null;
}> {
  if (user.username === "root") {
    const bestPlan = await getRootDisplayPlanForDisplay();
    return {
      ...user,
      billingStatus: "ACTIVE",
      billingPlanName: bestPlan?.name ?? "Root",
      billingPlanCode: bestPlan?.code ?? "ROOT",
      billingIsBlocked: false,
      billingBlockMessage: null,
      billingEndsAt: null,
      billingTrialEndsAt: null,
    };
  }

  const billing = await resolveUserBillingAccess(user.id);
  return {
    ...user,
    billingStatus: billing.status,
    billingPlanName: billing.plan?.name ?? null,
    billingPlanCode: billing.plan?.code ?? null,
    billingIsBlocked: billing.isBlocked,
    billingBlockMessage: billing.blockMessage,
    billingEndsAt: billing.endsAt,
    billingTrialEndsAt: billing.trialEndsAt,
  };
}

function canCancelScheduledJob(status: string, scheduledAt: Date): boolean {
  if (status === "FAILED" && scheduledAt.getTime() <= Date.now()) {
    return false;
  }

  return status === "PENDING" || status === "WAITING_LOGIN" || status === "FAILED";
}

function defaultAuthLaunchUrlForPlatform(platform: "instagram" | "whatsapp"): string | null {
  return platform === "whatsapp" ? "https://web.whatsapp.com/" : null;
}

function encodeSecret(secret?: string | null): string | null {
  if (!secret) {
    return null;
  }

  return Buffer.from(secret, "utf8").toString("base64");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInstagramOAuthReturnUrl(input: {
  returnToUrl?: string | null;
  success: boolean;
  message: string;
  connectionId?: string | null;
}): string | null {
  const normalizedBaseUrl = (input.returnToUrl || "").trim();
  if (!normalizedBaseUrl) {
    return null;
  }

  try {
    const url = new URL(normalizedBaseUrl);
    url.searchParams.set("instagram_oauth", "1");
    url.searchParams.set("instagram_oauth_success", input.success ? "1" : "0");
    url.searchParams.set("instagram_oauth_message", input.message);
    if (input.connectionId) {
      url.searchParams.set("instagram_oauth_connection_id", input.connectionId);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function respondInstagramOAuthResult(
  response: Response,
  input: {
    statusCode: number;
    success: boolean;
    message: string;
    connectionId?: string | null;
    postMessage?: boolean;
    returnToUrl?: string | null;
  },
): void {
  const redirectUrl = buildInstagramOAuthReturnUrl({
    returnToUrl: input.returnToUrl,
    success: input.success,
    message: input.message,
    connectionId: input.connectionId ?? null,
  });

  if (redirectUrl) {
    response.redirect(302, redirectUrl);
    return;
  }

  response
    .status(input.statusCode)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .send(
      renderInstagramOAuthCallbackHtml({
        success: input.success,
        message: input.message,
        connectionId: input.connectionId,
        postMessage: input.postMessage,
        returnToUrl: input.returnToUrl,
      }),
    );
}

function renderInstagramOAuthCallbackHtml(input: {
  success: boolean;
  message: string;
  connectionId?: string | null;
  postMessage?: boolean;
  returnToUrl?: string | null;
}): string {
  const title = input.success ? "Instagram conectado" : "Falha na autorizacao do Instagram";
  const payload = JSON.stringify({
    type: "socialup-instagram-oauth",
    success: input.success,
    message: input.message,
    connectionId: input.connectionId ?? null,
  });
  const panelReturnUrl = buildInstagramOAuthReturnUrl({
    returnToUrl: input.returnToUrl,
    success: input.success,
    message: input.message,
    connectionId: input.connectionId ?? null,
  });
  const shouldPostMessage = input.postMessage !== false;
  const shouldAutoRedirectToPanel = Boolean(panelReturnUrl);
  const toneColor = input.success ? "#166534" : "#9f1239";
  const toneBackground = input.success ? "#ecfdf3" : "#fff1f2";
  const toneBorder = input.success ? "#86efac" : "#fecdd3";
  const actionLabel = shouldAutoRedirectToPanel ? "Voltar ao painel" : "Fechar janela";

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        font-family: "K2D", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
        margin: 0;
        padding: 24px;
        background: #ffffff;
        color: #111827;
        min-height: 100vh;
        display: grid;
        place-items: center;
        box-sizing: border-box;
      }
      .card {
        max-width: 620px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #dce3ee;
        border-radius: 20px;
        padding: 24px;
        box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0;
        font-size: 26px;
        line-height: 1.15;
        font-weight: 500;
        color: #111827;
      }
      .status {
        margin-top: 14px;
        border-radius: 14px;
        padding: 13px 14px;
        font-size: 15px;
        line-height: 1.45;
        font-weight: 400;
        color: ${toneColor};
        background: ${toneBackground};
        border: 1px solid ${toneBorder};
      }
      .actions {
        margin-top: 18px;
        display: flex;
        justify-content: flex-end;
      }
      .action-btn {
        font-family: "K2D", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
        appearance: none;
        border: 1px solid #dce3ee;
        background: #f8fafc;
        color: #334155;
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 14px;
        font-weight: 400;
        cursor: pointer;
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
      }
      .action-btn:hover {
        background: #f1f5f9;
        border-color: #cfd8e6;
        color: #1e293b;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${escapeHtml(title)}</h1>
      <div class="status">${escapeHtml(input.message)}</div>
      <div class="actions">
        <button type="button" class="action-btn" id="oauth-action-btn">${escapeHtml(actionLabel)}</button>
      </div>
    </main>
    <script>
      (function () {
        var shouldPostMessage = ${shouldPostMessage ? "true" : "false"};
        var panelReturnUrl = ${JSON.stringify(panelReturnUrl)};
        var shouldAutoRedirectToPanel = ${shouldAutoRedirectToPanel ? "true" : "false"};

        function goBackToPanel() {
          if (!panelReturnUrl) {
            return false;
          }
          try {
            window.location.replace(panelReturnUrl);
            return true;
          } catch (_) {
            return false;
          }
        }

        if (shouldPostMessage) {
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage(${payload}, "*");
            }
          } catch (_) {}
        }
        var actionButton = document.getElementById("oauth-action-btn");
        if (actionButton) {
          actionButton.addEventListener("click", function () {
            if (goBackToPanel()) {
              return;
            }
            try {
              if (window.opener && !window.opener.closed) {
                window.opener.focus();
              }
            } catch (_) {}

            try {
              window.close();
            } catch (_) {}

            if (!window.closed) {
              try {
                window.location.replace("about:blank");
              } catch (_) {}
            }
          });
        }

        if (shouldAutoRedirectToPanel) {
          window.setTimeout(function () {
            goBackToPanel();
          }, 350);
        }
      })();
    </script>
  </body>
</html>`;
}

function mapConnection(connection: {
  id: string;
  companyId: string;
  platform: string;
  displayName: string;
  loginIdentifier: string | null;
  secretCipher?: string | null;
  authStatus: string;
  automationMode: string;
  authLaunchUrl: string | null;
  lastAuthAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: connection.id,
    companyId: connection.companyId,
    platform: connection.platform,
    displayName: connection.displayName,
    loginIdentifier: connection.loginIdentifier,
    hasSecret: Boolean(connection.secretCipher),
    authStatus: connection.authStatus,
    automationMode: connection.automationMode,
    authLaunchUrl: connection.authLaunchUrl,
    lastAuthAt: connection.lastAuthAt,
    lastSeenAt: connection.lastSeenAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    ...applyConnectionWorkerOverlay(connection),
  };
}

type ConnectionRuntimeMetadata = {
  instagramUsername?: string | null;
  instagramUserId?: string | null;
  whatsappProfileName?: string | null;
  whatsappOwnerJid?: string | null;
};

async function resolveConnectionRuntimeMetadata(connection: {
  id: string;
  companyId: string;
  platform: string;
  displayName: string;
  loginIdentifier: string | null;
  secretCipher?: string | null;
  authStatus: string;
}): Promise<ConnectionRuntimeMetadata> {
  if (connection.authStatus !== "CONNECTED") {
    return {};
  }

  if (connection.platform === "instagram") {
    try {
      const metadata = await withTimeout(
        resolveInstagramConnectionRuntimeMetadata({
          loginIdentifier: connection.loginIdentifier,
          secretCipher: connection.secretCipher ?? null,
        }),
        3_000,
        "INSTAGRAM_CONNECTION_METADATA_TIMEOUT",
      );

      return {
        instagramUsername: metadata.instagramUsername,
        instagramUserId: metadata.instagramUserId,
      };
    } catch {
      return {};
    }
  }

  if (connection.platform === "whatsapp") {
    try {
      const metadata = await withTimeout(
        resolveWhatsappConnectionRuntimeMetadata({
          id: connection.id,
          companyId: connection.companyId,
          displayName: connection.displayName,
          platform: connection.platform,
          loginIdentifier: connection.loginIdentifier,
          secretCipher: connection.secretCipher ?? null,
        }),
        3_000,
        "WHATSAPP_CONNECTION_METADATA_TIMEOUT",
      );

      return {
        whatsappProfileName: metadata.profileName,
        whatsappOwnerJid: metadata.ownerJid,
      };
    } catch {
      return {};
    }
  }

  return {};
}

async function syncConnectionRuntimeState(connection: {
  id: string;
  companyId: string;
  platform: string;
  displayName: string;
  loginIdentifier: string | null;
  secretCipher?: string | null;
  authStatus: string;
  automationMode: string;
  authLaunchUrl: string | null;
  lastAuthAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Promise<typeof connection> {
  if (connection.platform !== "whatsapp") {
    return connection;
  }

  let runtimeAuthStatus: "CONNECTED" | "AUTH_IN_PROGRESS" | "AUTH_REQUIRED" | null = null;
  try {
    runtimeAuthStatus = await withTimeout(
      resolveWhatsappConnectionRuntimeAuthStatus({
        id: connection.id,
        companyId: connection.companyId,
        displayName: connection.displayName,
        platform: connection.platform,
        loginIdentifier: connection.loginIdentifier,
        secretCipher: connection.secretCipher ?? null,
      }),
      3_000,
      "WHATSAPP_CONNECTION_STATUS_TIMEOUT",
    );
  } catch {
    return connection;
  }

  if (!runtimeAuthStatus || runtimeAuthStatus === connection.authStatus) {
    return connection;
  }

  const now = new Date();
  const updatedConnection = await prisma.socialConnection.update({
    where: { id: connection.id },
    data: {
      authStatus: runtimeAuthStatus,
      authLaunchUrl: runtimeAuthStatus === "CONNECTED" ? null : connection.authLaunchUrl,
      lastAuthAt: runtimeAuthStatus === "CONNECTED" ? connection.lastAuthAt ?? now : connection.lastAuthAt,
      lastSeenAt: runtimeAuthStatus === "AUTH_REQUIRED" ? null : now,
    },
  });

  await appendLog({
    companyId: updatedConnection.companyId,
    level: runtimeAuthStatus === "AUTH_REQUIRED" ? "WARN" : "INFO",
    errorCode: "WHATSAPP_CONNECTION_STATE_SYNC",
    message:
      `Estado da conta ${updatedConnection.displayName} sincronizado ao abrir conexoes: ` +
      `${connection.authStatus} -> ${runtimeAuthStatus}.`,
  });

  return updatedConnection;
}

function mapAviso(aviso: {
  id: string;
  kind: string;
  title: string;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: aviso.id,
    kind: aviso.kind,
    title: aviso.title,
    message: aviso.message,
    readAt: aviso.readAt,
    createdAt: aviso.createdAt,
  };
}

async function appendLog(input: {
  companyId: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  errorCode?: string | null;
  screenshotPath?: string | null;
}): Promise<void> {
  await prisma.agentLog.create({
    data: {
      companyId: input.companyId,
      level: input.level,
      errorCode: input.errorCode,
      message: input.message,
      screenshotPath: input.screenshotPath,
    },
  });
}

async function appendAviso(input: {
  userId: string;
  title: string;
  message: string;
  kind?: string;
  createdByUserId?: string | null;
}): Promise<void> {
  await prisma.aviso.create({
    data: {
      userId: input.userId,
      title: input.title,
      message: input.message,
      kind: input.kind ?? "SYSTEM",
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

async function appendBillingAvisoSafely(input: {
  userId: string;
  title: string;
  message: string;
  kind?: string;
}): Promise<void> {
  try {
    await appendAviso({
      userId: input.userId,
      title: input.title,
      message: input.message,
      kind: input.kind ?? "BILLING",
    });
  } catch (error) {
    console.error("Failed to append billing aviso", error);
  }
}

async function appendJobAvisoSafely(
  job: {
    id: string;
    createdByUserId: string | null;
    title?: string | null;
    caption: string | null;
    publicationType?: string | null;
    postStory?: boolean;
    postReel?: boolean;
    postWhatsapp?: boolean;
    modoWhatsapp?: string | null;
  },
  input: {
    title: string;
    message: string;
    kind?: string;
  },
): Promise<void> {
  if (!job.createdByUserId) {
    return;
  }

  const publicationLabel = publicationTypeDisplayLabel(normalizePublicationType(job));
  const titleSnippet = compactAvisoText(job.title, 90);
  const captionSnippet = compactAvisoText(job.caption, 90);
  const subject = titleSnippet || captionSnippet ? `"${titleSnippet || captionSnippet}"` : `Job ${job.id}`;
  const composedMessage = `${publicationLabel} - ${subject}. ${input.message}`;

  try {
    await appendAviso({
      userId: job.createdByUserId,
      title: input.title,
      message: composedMessage,
      kind: input.kind,
    });
  } catch (error) {
    console.error("Failed to append job aviso", error);
  }
}

async function failJobDueToConnectionUnavailable(
  job: {
    id: string;
    companyId: string;
    createdByUserId: string | null;
    title?: string | null;
    caption: string | null;
    publicationType?: string | null;
    postStory?: boolean;
    postReel?: boolean;
    postWhatsapp?: boolean;
    modoWhatsapp?: string | null;
  },
  input: {
    message: string;
    errorCode: string;
  },
): Promise<void> {
  const update = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: {
        in: ["PENDING", "WAITING_LOGIN", "RUNNING"],
      },
    },
    data: {
      status: "FAILED",
      lastError: input.message,
      completedAt: new Date(),
    },
  });

  if (update.count === 0) {
    return;
  }

  await appendLog({
    companyId: job.companyId,
    level: "ERROR",
    errorCode: input.errorCode,
    message: `Job ${job.id} falhou: ${input.message}`,
  });

  await appendJobAvisoSafely(job, {
    title: "Falha no agendamento",
    kind: "JOB_FAILED",
    message: input.message,
  });
}

function normalizeAutomationErrorCode(message: string): string {
  if (/^[A-Z0-9_:-]+$/.test(message) && message.length <= 80) {
    return message;
  }

  const match = message.match(/[A-Z][A-Z0-9_]{3,}/);
  if (match) {
    return match[0];
  }

  return "AUTOMATION_RUNTIME_ERROR";
}

function summarizeFailureMessageForAviso(publicationType: PublicationType, rawMessage: string): string {
  const normalized = rawMessage.trim().toLowerCase();

  if (publicationType === "instagram_post" || publicationType === "instagram_reel" || publicationType === "instagram_story") {
    if (normalized.includes("story_sequence_step_failed")) {
      const partialMatch = rawMessage.match(/story_sequence_published_count=(\d+);step=(\d+);total=(\d+)/i);
      if (partialMatch) {
        const publishedCount = Number.parseInt(partialMatch[1] ?? "0", 10);
        const totalCount = Number.parseInt(partialMatch[3] ?? "0", 10);
        if (publishedCount > 0 && totalCount > 0) {
          return `Sequência interrompida após retentativas automáticas: ${publishedCount}/${totalCount} stories foram publicados. Use o botão para reagendar apenas o restante em 20 minutos.`;
        }
      }
      return "Sequência de stories interrompida após retentativas automáticas. Use o botão para reagendar a mídia em 20 minutos.";
    }

    if (normalized.includes("aspect ratio is not supported") || normalized.includes("aspect_ratio")) {
      return "A proporção da mídia não é suportada para este formato do Instagram.";
    }

    if (normalized.includes("only photo or video can be accepted as media type")) {
      return "A mídia não foi aceita pelo Instagram. Use imagem ou vídeo em formato compatível.";
    }

    if (normalized.includes("media id is not available")) {
      return "A mídia ainda não estava pronta no Instagram. Tente novamente.";
    }

    if (normalized.includes("media_fetch_invalid_type") || normalized.includes("media_url_invalid")) {
      return "Não foi possível validar a mídia no Instagram. Verifique o arquivo e tente novamente.";
    }

    if (normalized.includes("user is performing too many actions") || normalized.includes("too many actions")) {
      return "O Instagram limitou ações temporariamente. Aguarde alguns minutos e tente novamente.";
    }

    if (normalized.includes("story_sequence_duplicate_publish_id")) {
      return "A API retornou duplicação em sequência de stories. Tente novamente.";
    }

    if (normalized.includes("story_sequence_duplicate_creation_id")) {
      return "A API retornou criação duplicada em sequência de stories. Tente novamente.";
    }

    return "Falha ao publicar no Instagram. Revise a mídia e tente novamente.";
  }

  if (publicationType === "whatsapp_status_midia" || publicationType === "whatsapp_status_texto") {
    return "Falha ao publicar no WhatsApp Status. Tente novamente.";
  }

  return "Falha ao executar o agendamento. Tente novamente.";
}

function isInstagramTooManyActionsMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized.includes("user is performing too many actions") || normalized.includes("too many actions");
}

function isInstagramTransientExecutionError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.includes("fetch failed")) {
    return true;
  }

  if (normalized.includes("networkerror")) {
    return true;
  }

  if (normalized.includes("socket hang up")) {
    return true;
  }

  if (
    normalized.includes("too many actions") ||
    normalized.includes("rate limit") ||
    normalized.includes("application request limit reached")
  ) {
    return true;
  }

  if (
    normalized.includes("econnreset") ||
    normalized.includes("econnrefused") ||
    normalized.includes("etimedout") ||
    normalized.includes("timed out") ||
    normalized.includes("eai_again")
  ) {
    return true;
  }

  if (/^instagram_graph_api_http_5\d{2}:/i.test(message)) {
    return true;
  }

  return false;
}

const instagramLastProactiveTokenRefreshByConnection = new Map<string, number>();

function connectionExecutionLockKey(connectionId: string): string {
  return `job:connection:executing:${connectionId}`;
}

async function enqueueJobForExecution(input: {
  jobId: string;
  platform: JobExecutionPlatform;
}): Promise<void> {
  await enqueueJobExecutionMessage({
    jobId: input.jobId,
    platform: input.platform,
  });
}

async function isConnectionExecutionInProgress(connectionId: string): Promise<boolean> {
  return isDistributedLockHeld(connectionExecutionLockKey(connectionId));
}

function shouldAttemptProactiveInstagramTokenRefresh(connectionId: string, nowMs: number): boolean {
  const lastRefreshedAtMs = instagramLastProactiveTokenRefreshByConnection.get(connectionId) ?? 0;
  return nowMs - lastRefreshedAtMs >= INSTAGRAM_PROACTIVE_TOKEN_REFRESH_COOLDOWN_MS;
}

function markProactiveInstagramTokenRefreshAttempt(connectionId: string, nowMs: number): void {
  instagramLastProactiveTokenRefreshByConnection.set(connectionId, nowMs);
}

async function appendInstagramAuthRequiredAvisosForConnection(connectionId: string): Promise<void> {
  const recipients = await prisma.job.findMany({
    where: {
      socialConnectionId: connectionId,
      createdByUserId: {
        not: null,
      },
    },
    select: {
      createdByUserId: true,
    },
    distinct: ["createdByUserId"],
    take: 200,
  });

  await Promise.all(
    recipients
      .map((entry) => entry.createdByUserId)
      .filter((userId): userId is string => Boolean(userId))
      .map((userId) =>
        appendAviso({
          userId,
          title: "Aguardando autenticação",
          kind: "JOB_WAITING_LOGIN",
          message: "A conta do Instagram precisa ser autenticada para continuar.",
        }),
      ),
  );
}

function resolveUploadFilePath(filePath: string): string {
  return path.join(uploadsDir, path.basename(filePath));
}

function resolvePublicUploadUrl(filePath: string): string {
  const trimmed = filePath.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (!INSTAGRAM_GRAPH_PUBLIC_BASE_URL) {
    throw new Error("INSTAGRAM_GRAPH_PUBLIC_BASE_URL_MISSING");
  }

  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const encodedPath = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const baseUrl = new URL(INSTAGRAM_GRAPH_PUBLIC_BASE_URL);
  const basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname.replace(/\/+$/, "");
  baseUrl.pathname = `${basePath}${encodedPath}`;
  baseUrl.search = "";
  baseUrl.hash = "";
  return baseUrl.toString();
}

function buildInstagramRelinkShareUrl(jobId: string): string | null {
  const normalizedJobId = jobId.trim();
  if (!normalizedJobId || !INSTAGRAM_GRAPH_PUBLIC_BASE_URL) {
    return null;
  }

  const baseUrl = new URL(INSTAGRAM_GRAPH_PUBLIC_BASE_URL);
  const basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname.replace(/\/+$/, "");
  baseUrl.pathname = `${basePath}/share/instagram/${encodeURIComponent(normalizedJobId)}`;
  baseUrl.search = "";
  baseUrl.hash = "";
  return baseUrl.toString();
}

function buildInstagramSharePreviewCardUrl(jobId: string): string | null {
  const normalizedJobId = jobId.trim();
  if (!normalizedJobId || !INSTAGRAM_GRAPH_PUBLIC_BASE_URL) {
    return null;
  }

  const baseUrl = new URL(INSTAGRAM_GRAPH_PUBLIC_BASE_URL);
  const basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname.replace(/\/+$/, "");
  baseUrl.pathname = `${basePath}/share/instagram/${encodeURIComponent(normalizedJobId)}/preview.svg`;
  baseUrl.search = "";
  baseUrl.hash = "";
  return baseUrl.toString();
}

function isPreviewableImagePath(filePath: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(filePath.trim());
}

function resolveInstagramSharePreviewImageUrl(filePath: string | null | undefined): string | null {
  const mediaBundle = decodeJobMediaBundleStorage(filePath);
  const imagePath = mediaBundle.files.find((entry) => isPreviewableImagePath(entry));
  if (!imagePath) {
    return null;
  }

  try {
    return resolvePublicUploadUrl(imagePath);
  } catch {
    return null;
  }
}

async function ensureWhatsappRelinkMediaFileForPublication(input: {
  jobId: string;
  publicationType: PublicationType;
  sourceFilePath: string;
}): Promise<string> {
  const normalizedSourceFilePath = input.sourceFilePath.trim();
  if (!normalizedSourceFilePath) {
    return normalizedSourceFilePath;
  }

  if (input.publicationType !== "instagram_post" || !isPreviewableImagePath(normalizedSourceFilePath)) {
    return normalizedSourceFilePath;
  }

  const absoluteSourcePath = resolveUploadFilePath(normalizedSourceFilePath);
  const sourceStat = statSync(absoluteSourcePath);
  const cacheKey = createHash("sha1")
    .update(`${normalizedSourceFilePath}:${sourceStat.size}:${sourceStat.mtimeMs}`)
    .digest("hex")
    .slice(0, 16);
  const outputFileName = `${input.jobId}-wa-relink-${cacheKey}.jpg`;
  const absoluteOutputPath = path.join(uploadsDir, outputFileName);
  const relativeOutputPath = `/uploads/${outputFileName}`;

  try {
    statSync(absoluteOutputPath);
    return relativeOutputPath;
  } catch {
    // Arquivo ainda não foi gerado; segue para composição abaixo.
  }

  const foregroundBuffer = await sharp(absoluteSourcePath)
    .rotate()
    .resize(WHATSAPP_RELINK_POST_FOREGROUND_WIDTH, WHATSAPP_RELINK_POST_FOREGROUND_HEIGHT, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const darkOverlayBuffer = await sharp({
    create: {
      width: WHATSAPP_RELINK_POST_CANVAS_WIDTH,
      height: WHATSAPP_RELINK_POST_CANVAS_HEIGHT,
      channels: 4,
      background: { r: 8, g: 15, b: 32, alpha: 0.22 },
    },
  })
    .png()
    .toBuffer();

  await sharp(absoluteSourcePath)
    .rotate()
    .resize(WHATSAPP_RELINK_POST_CANVAS_WIDTH, WHATSAPP_RELINK_POST_CANVAS_HEIGHT, {
      fit: "cover",
      position: "centre",
    })
    .blur(42)
    .composite([
      {
        input: darkOverlayBuffer,
        blend: "over",
      },
      {
        input: foregroundBuffer,
        gravity: "center",
      },
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(absoluteOutputPath);

  return relativeOutputPath;
}

type SharePreviewFrameConfig = {
  label: string;
  frameWidth: number;
  frameHeight: number;
  accentStart: string;
  accentEnd: string;
};

function sharePreviewFrameConfigForPublicationType(publicationType: string | null | undefined): SharePreviewFrameConfig {
  switch ((publicationType || "").trim().toLowerCase()) {
    case "instagram_story":
      return {
        label: "Instagram Story",
        frameWidth: 292,
        frameHeight: 520,
        accentStart: "#8b5cf6",
        accentEnd: "#ec4899",
      };
    case "instagram_reel":
      return {
        label: "Instagram Reel",
        frameWidth: 292,
        frameHeight: 520,
        accentStart: "#fb7185",
        accentEnd: "#f59e0b",
      };
    case "tiktok_video":
      return {
        label: "TikTok Video",
        frameWidth: 292,
        frameHeight: 520,
        accentStart: "#0f172a",
        accentEnd: "#111827",
      };
    case "instagram_post":
    default:
      return {
        label: "Instagram Post",
        frameWidth: 360,
        frameHeight: 450,
        accentStart: "#f43f5e",
        accentEnd: "#8b5cf6",
      };
  }
}

function renderInstagramSharePreviewSvg(input: {
  publicationType: string | null | undefined;
  previewTitle: string;
  previewDescription: string;
  previewImageUrl: string | null;
}): string {
  const canvasWidth = 1200;
  const canvasHeight = 630;
  const frame = sharePreviewFrameConfigForPublicationType(input.publicationType);
  const frameX = 72;
  const frameY = Math.round((canvasHeight - frame.frameHeight) / 2);
  const infoX = frameX + frame.frameWidth + 64;
  const infoWidth = canvasWidth - infoX - 72;
  const previewTitle = escapeHtml(input.previewTitle);
  const previewDescription = escapeHtml(input.previewDescription);
  const label = escapeHtml(frame.label);
  const previewImageUrl = input.previewImageUrl ? escapeHtml(input.previewImageUrl) : null;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" fill="none">
  <defs>
    <linearGradient id="fallbackBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${frame.accentStart}" />
      <stop offset="100%" stop-color="${frame.accentEnd}" />
    </linearGradient>
    <linearGradient id="glassStroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.55)" />
      <stop offset="100%" stop-color="rgba(255,255,255,0.18)" />
    </linearGradient>
    <filter id="blurBg" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="32" />
    </filter>
    <clipPath id="mediaFrameClip">
      <rect x="${frameX}" y="${frameY}" width="${frame.frameWidth}" height="${frame.frameHeight}" rx="32" ry="32" />
    </clipPath>
  </defs>

  <rect width="${canvasWidth}" height="${canvasHeight}" fill="${previewImageUrl ? "#111827" : "url(#fallbackBg)"}" />
  ${previewImageUrl ? `<image href="${previewImageUrl}" x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" preserveAspectRatio="xMidYMid slice" filter="url(#blurBg)" />
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="rgba(15,23,42,0.34)" />` : ""}

  <g>
    <rect x="${frameX}" y="${frameY}" width="${frame.frameWidth}" height="${frame.frameHeight}" rx="32" ry="32" fill="rgba(255,255,255,0.14)" />
    ${previewImageUrl ? `<image href="${previewImageUrl}" x="${frameX}" y="${frameY}" width="${frame.frameWidth}" height="${frame.frameHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#mediaFrameClip)" />` : `
    <rect x="${frameX}" y="${frameY}" width="${frame.frameWidth}" height="${frame.frameHeight}" rx="32" ry="32" fill="url(#fallbackBg)" />
    <circle cx="${frameX + frame.frameWidth / 2}" cy="${frameY + frame.frameHeight / 2}" r="42" fill="rgba(255,255,255,0.18)" />
    <path d="M ${frameX + frame.frameWidth / 2 - 12} ${frameY + frame.frameHeight / 2 - 18} L ${frameX + frame.frameWidth / 2 - 12} ${frameY + frame.frameHeight / 2 + 18} L ${frameX + frame.frameWidth / 2 + 18} ${frameY + frame.frameHeight / 2} Z" fill="#ffffff" />`}
    <rect x="${frameX}" y="${frameY}" width="${frame.frameWidth}" height="${frame.frameHeight}" rx="32" ry="32" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2" />
  </g>

  <g>
    <rect x="${infoX}" y="118" width="170" height="40" rx="20" fill="rgba(255,255,255,0.16)" />
    <text x="${infoX + 20}" y="144" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="20" font-weight="600">${label}</text>
    <text x="${infoX}" y="236" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="56" font-weight="700">${previewTitle}</text>
    <foreignObject x="${infoX}" y="266" width="${infoWidth}" height="172">
      <div xmlns="http://www.w3.org/1999/xhtml" style="color: rgba(255,255,255,0.92); font: 400 28px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;">
        ${previewDescription}
      </div>
    </foreignObject>
    <rect x="${infoX}" y="484" width="236" height="54" rx="27" fill="rgba(255,255,255,0.94)" />
    <text x="${infoX + 26}" y="518" fill="#111827" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="24" font-weight="600">Abrir conteúdo</text>
  </g>
</svg>`;
}

function renderInstagramShareLandingPage(input: {
  shareUrl: string;
  redirectUrl: string;
  previewTitle: string;
  previewDescription: string;
  previewImageUrl: string | null;
}): string {
  const shareUrl = escapeHtml(input.shareUrl);
  const redirectUrl = escapeHtml(input.redirectUrl);
  const previewTitle = escapeHtml(input.previewTitle);
  const previewDescription = escapeHtml(input.previewDescription);
  const previewImageUrl = input.previewImageUrl ? escapeHtml(input.previewImageUrl) : null;

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${previewTitle}</title>
    <meta name="description" content="${previewDescription}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="pt_BR" />
    <meta property="og:title" content="${previewTitle}" />
    <meta property="og:description" content="${previewDescription}" />
    <meta property="og:url" content="${shareUrl}" />
    <meta property="og:site_name" content="Compartilhamento" />
    ${previewImageUrl ? `<meta property="og:image" content="${previewImageUrl}" />
    <meta property="og:image:secure_url" content="${previewImageUrl}" />
    <meta property="og:image:alt" content="${previewTitle}" />` : ""}
    <meta name="twitter:card" content="${previewImageUrl ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${previewTitle}" />
    <meta name="twitter:description" content="${previewDescription}" />
    ${previewImageUrl ? `<meta name="twitter:image" content="${previewImageUrl}" />` : ""}
    <meta http-equiv="refresh" content="0; url=${redirectUrl}" />
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: linear-gradient(180deg, #fafafa 0%, #f3f4f6 100%);
        color: #111827;
        font: 400 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(100%, 420px);
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid #e5e7eb;
        border-radius: 20px;
        padding: 28px 24px;
        text-align: center;
        box-shadow: 0 24px 48px rgba(15, 23, 42, 0.08);
      }

      h1 {
        margin: 0 0 8px;
        font-size: 1.05rem;
        font-weight: 600;
      }

      p {
        margin: 0;
        color: #4b5563;
      }

      a {
        color: #111827;
        font-weight: 600;
      }
    </style>
    <script>
      window.location.replace(${JSON.stringify(input.redirectUrl)});
    </script>
  </head>
  <body>
    <main>
      <h1>${previewTitle}</h1>
      <p>Abrindo a publicação do Instagram...</p>
      <p style="margin-top: 12px;">Se o redirecionamento não acontecer, <a href="${redirectUrl}">toque aqui</a>.</p>
    </main>
  </body>
</html>`;
}

function appendStorySequenceCacheBuster(mediaUrl: string, jobId: string, index: number, fileName: string): string {
  const targetUrl = new URL(mediaUrl);
  targetUrl.searchParams.set("_su_story_job", jobId);
  targetUrl.searchParams.set("_su_story_idx", String(index + 1));
  targetUrl.searchParams.set("_su_story_file", fileName);
  targetUrl.searchParams.set("_su_story_ts", String(Date.now()));
  return targetUrl.toString();
}

function appendInstagramMediaCacheBuster(
  mediaUrl: string,
  jobId: string,
  fileName: string,
  variant: string,
): string {
  const targetUrl = new URL(mediaUrl);
  targetUrl.searchParams.set("_su_job", jobId);
  targetUrl.searchParams.set("_su_media", fileName);
  targetUrl.searchParams.set("_su_variant", variant);
  targetUrl.searchParams.set("_su_ts", String(Date.now()));
  return targetUrl.toString();
}

function storySequenceFileAudit(filePath: string): { fileName: string; fingerprint: string } {
  const normalizedPath = filePath.trim();
  const fileName = path.basename(normalizedPath) || normalizedPath;

  if (/^https?:\/\//i.test(normalizedPath)) {
    return {
      fileName,
      fingerprint: `url:${normalizedPath}`,
    };
  }

  try {
    const absolutePath = resolveUploadFilePath(normalizedPath);
    const fileBuffer = readFileSync(absolutePath);
    const fingerprint = createHash("sha256").update(fileBuffer).digest("hex");
    return {
      fileName,
      fingerprint,
    };
  } catch {
    return {
      fileName,
      fingerprint: `path:${normalizedPath}`,
    };
  }
}

async function publishInstagramFirstCommentIfConfigured(input: {
  connection: {
    secretCipher: string | null;
  };
  job: {
    id: string;
    companyId?: string;
    publicationType?: string | null;
    postStory?: boolean;
    postReel?: boolean;
    postWhatsapp?: boolean;
    firstComment?: string | null;
  };
  publishedMediaId: string;
}): Promise<void> {
  const publicationType = normalizePublicationType(input.job);
  if (publicationType !== "instagram_post" && publicationType !== "instagram_reel") {
    return;
  }

  const comment = input.job.firstComment?.trim() || "";
  if (!comment) {
    return;
  }

  try {
    await publishInstagramMediaCommentWithGraphApi(
      {
        secretCipher: input.connection.secretCipher,
      },
      {
        mediaId: input.publishedMediaId,
        message: comment,
      },
    );

    if (input.job.companyId) {
      await appendLog({
        companyId: input.job.companyId,
        level: "INFO",
        message: `Primeiro comentário publicado automaticamente no job ${input.job.id}.`,
      });
    }
  } catch (error) {
    if (input.job.companyId) {
      await appendLog({
        companyId: input.job.companyId,
        level: "WARN",
        errorCode: "INSTAGRAM_FIRST_COMMENT_FAILED",
        message:
          `Postagem ${input.job.id} foi publicada, mas o primeiro comentário falhou: ` +
          `${error instanceof Error ? error.message : "erro desconhecido"}`,
      });
    }
  }
}

function buildWhatsappRelinkMediaCaption(input: {
  publicationType: PublicationType;
  caption: string | null;
  permalink: string;
}): string {
  const normalizedPermalink = input.permalink.trim();
  if (!normalizedPermalink) {
    return "";
  }

  if (input.publicationType === "instagram_story") {
    return normalizedPermalink;
  }

  const normalizedCaption = input.caption?.trim() || "";
  if (!normalizedCaption) {
    return normalizedPermalink;
  }

  const suffix = `\n\n${normalizedPermalink}`;
  const maxCaptionLength = 1024;
  const availableCaptionLength = maxCaptionLength - suffix.length;

  if (availableCaptionLength <= 0) {
    return normalizedPermalink;
  }

  const trimmedCaption =
    normalizedCaption.length <= availableCaptionLength
      ? normalizedCaption
      : `${normalizedCaption.slice(0, Math.max(0, availableCaptionLength - 3)).trimEnd()}...`;

  return `${trimmedCaption}${suffix}`;
}

async function dispatchWhatsappRelinkJobsForInstagramPublication(input: {
  job: {
    id: string;
    companyId: string;
    createdByUserId: string | null;
    filePath: string;
    title?: string | null;
    caption: string | null;
    whatsappBackgroundColor?: string | null;
    publicationType?: string | null;
    whatsappRelinkEnabled: boolean;
    whatsappRelinkConnectionIds: unknown;
    whatsappRelinkDispatchedAt: Date | null;
  };
  connection: {
    secretCipher: string | null;
  };
  publishedMediaId: string | null;
}): Promise<void> {
  const publicationType = normalizePublicationType(input.job);
  if (
    !supportsInstagramWhatsappRelink(publicationType) ||
    !supportsInstagramWhatsappRelinkForJobMedia(publicationType, input.job.filePath)
  ) {
    return;
  }

  if (!input.job.whatsappRelinkEnabled || input.job.whatsappRelinkDispatchedAt) {
    return;
  }

  const configuredConnectionIds = parseStoredWhatsappRelinkConnectionIds(input.job.whatsappRelinkConnectionIds);
  if (configuredConnectionIds.length === 0) {
    return;
  }

  const publishedMediaId = input.publishedMediaId?.trim() || "";
  if (!publishedMediaId) {
    await appendLog({
      companyId: input.job.companyId,
      level: "WARN",
      errorCode: "WHATSAPP_RELINK_MEDIA_ID_MISSING",
      message:
        `Job ${input.job.id} concluiu no Instagram, mas sem mediaId para gerar relink no WhatsApp.`,
    });
    return;
  }

  let permalink: string | null = null;
  try {
    permalink = await fetchInstagramPublishedMediaPermalinkWithGraphApi(
      {
        secretCipher: input.connection.secretCipher,
      },
      publishedMediaId,
    );
  } catch (error) {
    await appendLog({
      companyId: input.job.companyId,
      level: "WARN",
      errorCode: "WHATSAPP_RELINK_PERMALINK_FAILED",
      message:
        `Job ${input.job.id} não conseguiu buscar permalink para relink no WhatsApp: ` +
        `${error instanceof Error ? error.message : "erro desconhecido"}`,
    });
  }

  if (!permalink) {
    await appendLog({
      companyId: input.job.companyId,
      level: "WARN",
      errorCode: "WHATSAPP_RELINK_PERMALINK_MISSING",
      message: `Job ${input.job.id} não retornou permalink para relink no WhatsApp.`,
    });
    return;
  }

  const targetConnections = await prisma.socialConnection.findMany({
    where: {
      id: { in: configuredConnectionIds },
      platform: "whatsapp",
      authStatus: "CONNECTED",
    },
    select: {
      id: true,
      companyId: true,
    },
  });
  const targetConnectionMap = new Map(targetConnections.map((connection) => [connection.id, connection]));
  const targetConnectionsInOrder = configuredConnectionIds
    .map((id) => targetConnectionMap.get(id))
    .filter((connection): connection is { id: string; companyId: string } => Boolean(connection));
  if (targetConnectionsInOrder.length === 0) {
    await appendLog({
      companyId: input.job.companyId,
      level: "WARN",
      errorCode: "WHATSAPP_RELINK_CONNECTIONS_NOT_FOUND",
      message:
        `Job ${input.job.id} não encontrou contas de WhatsApp válidas para relink.`,
    });
    return;
  }

  const mediaBundle = decodeJobMediaBundleStorage(input.job.filePath);
  const firstMediaFilePath = mediaBundle.files[0] ?? input.job.filePath?.trim() ?? "";
  if (!firstMediaFilePath) {
    await appendLog({
      companyId: input.job.companyId,
      level: "WARN",
      errorCode: "WHATSAPP_RELINK_MEDIA_FILE_MISSING",
      message: `Job ${input.job.id} não encontrou mídia para criar o relink no WhatsApp.`,
    });
    return;
  }

  let relinkSourceFilePath = firstMediaFilePath;
  try {
    relinkSourceFilePath = await ensureWhatsappRelinkMediaFileForPublication({
      jobId: input.job.id,
      publicationType,
      sourceFilePath: firstMediaFilePath,
    });
  } catch (error) {
    relinkSourceFilePath = firstMediaFilePath;
    await appendLog({
      companyId: input.job.companyId,
      level: "WARN",
      errorCode: "WHATSAPP_RELINK_MEDIA_RENDER_FAILED",
      message:
        `Job ${input.job.id} não conseguiu preparar a mídia vertical do relink e seguirá com o arquivo original: ` +
        `${error instanceof Error ? error.message : "erro desconhecido"}`,
    });
  }

  const relinkText = buildWhatsappRelinkMediaCaption({
    publicationType,
    caption: input.job.caption,
    permalink,
  });
  const now = new Date();
  for (const whatsappConnection of targetConnectionsInOrder) {
    await prisma.job.create({
      data: {
        companyId: whatsappConnection.companyId,
        createdByUserId: input.job.createdByUserId,
        socialConnectionId: whatsappConnection.id,
        filePath: relinkSourceFilePath,
        title: input.job.title ? `${input.job.title} (Relink)` : "Relink Instagram",
        caption: relinkText,
        firstComment: null,
        locationName: null,
        whatsappBackgroundColor: null,
        publicationType: "whatsapp_status_midia",
        publicationState: "PUBLISHED",
        postStory: false,
        postReel: false,
        postWhatsapp: true,
        modoWhatsapp: "texto",
        dataPostagem: now,
      },
    });
  }

  await prisma.job.update({
    where: { id: input.job.id },
    data: {
      whatsappRelinkDispatchedAt: now,
      instagramPermalink: permalink,
    },
  });

  await appendLog({
    companyId: input.job.companyId,
    level: "INFO",
    message:
      `Job ${input.job.id} criou ${targetConnectionsInOrder.length} status de relink no WhatsApp ` +
      `com permalink ${permalink}.`,
  });
}

async function executeInstagramJobWithResolvedMediaBundle(
  connection: {
    id: string;
    loginIdentifier: string | null;
    secretCipher: string | null;
  },
  job: {
    id: string;
    companyId?: string;
    filePath: string;
    caption: string | null;
    firstComment: string | null;
    locationName: string | null;
    publicationType?: string | null;
    postStory?: boolean;
    postReel?: boolean;
    postWhatsapp?: boolean;
  },
): Promise<{ publishedMediaId: string | null }> {
  const normalizedPublicationType = normalizePublicationType(job);
  if (!isInstagramPublication(normalizedPublicationType)) {
    throw new Error(`UNSUPPORTED_SERVER_PUBLICATION_TYPE:${normalizedPublicationType}`);
  }

  const mediaBundle = decodeJobMediaBundleStorage(job.filePath);
  const mediaFiles = mediaBundle.files.length > 0
    ? mediaBundle.files
    : (job.filePath?.trim() ? [job.filePath.trim()] : []);

  if (mediaFiles.length === 0) {
    throw new Error("INSTAGRAM_GRAPH_MEDIA_URL_INVALID");
  }

  const locationMetadata = decodeInstagramLocationStorage(job.locationName);
  if (normalizedPublicationType === "instagram_post" && mediaFiles.length > 1) {
    if (!mediaBundle.sequential) {
      throw new Error("INSTAGRAM_CAROUSEL_REQUIRES_SEQUENTIAL_FLAG");
    }

    const mediaUrls = mediaFiles.map((filePath, index) =>
      appendInstagramMediaCacheBuster(
        resolvePublicUploadUrl(filePath),
        job.id,
        path.basename(filePath) || `carousel-${index + 1}`,
        `carousel-${index + 1}`,
      ),
    );
    const published = await executeInstagramCarouselJobWithGraphApi(
      {
        id: connection.id,
        loginIdentifier: connection.loginIdentifier,
        secretCipher: connection.secretCipher,
      },
      {
        id: job.id,
        caption: job.caption,
        locationName: locationMetadata.locationName,
        locationId: locationMetadata.locationId,
        fileAltTexts: mediaBundle.captions,
      },
      mediaUrls,
    );

    await publishInstagramFirstCommentIfConfigured({
      connection,
      job,
      publishedMediaId: published.publishedMediaId,
    });
    return {
      publishedMediaId: published.publishedMediaId,
    };
  }

  if (normalizedPublicationType === "instagram_story" && mediaFiles.length > 1) {
    if (!mediaBundle.sequential) {
      throw new Error("INSTAGRAM_STORY_SEQUENCE_REQUIRES_SEQUENTIAL_FLAG");
    }

    const createdStoryIds = new Set<string>();
    const publishedStoryIds = new Set<string>();
    for (const [index, filePath] of mediaFiles.entries()) {
      const audit = storySequenceFileAudit(filePath);
      const mediaUrl = appendStorySequenceCacheBuster(
        resolvePublicUploadUrl(filePath),
        job.id,
        index,
        audit.fileName,
      );
      try {
        const published = await executeInstagramStorySequenceStepWithRetry({
          connection: {
            id: connection.id,
            loginIdentifier: connection.loginIdentifier,
            secretCipher: connection.secretCipher,
          },
          job,
          locationMetadata,
          mediaUrl,
          altText: mediaBundle.captions[index] ?? null,
          index,
          total: mediaFiles.length,
          fileName: audit.fileName,
        });

        const creationId = published.creationId?.trim() || "";
        if (creationId) {
          if (createdStoryIds.has(creationId)) {
            throw new Error("INSTAGRAM_STORY_SEQUENCE_DUPLICATE_CREATION_ID");
          }
          createdStoryIds.add(creationId);
        }

        const publishedMediaId = published.publishedMediaId?.trim() || "";
        if (publishedMediaId) {
          if (publishedStoryIds.has(publishedMediaId)) {
            throw new Error("INSTAGRAM_STORY_SEQUENCE_DUPLICATE_PUBLISH_ID");
          }
          publishedStoryIds.add(publishedMediaId);
        }

        if (job.companyId) {
          await appendLog({
            companyId: job.companyId,
            level: "INFO",
            message:
              `Job ${job.id} story ${index + 1}/${mediaFiles.length} publicado em sequência. ` +
              `arquivo=${audit.fileName} mediaId=${publishedMediaId || "indisponivel"} ` +
              `hash=${audit.fingerprint.slice(0, 12)}.`,
          });
        }
      } catch (sequenceStepError) {
        const stepMessage = sequenceStepError instanceof Error
          ? sequenceStepError.message
          : "INSTAGRAM_STORY_SEQUENCE_STEP_FAILED";
        if (isInstagramLoginRequiredErrorMessage(stepMessage)) {
          throw new Error(
            `LOGIN_REQUIRED_INSTAGRAM:STORY_SEQUENCE_PUBLISHED_COUNT=${publishedStoryIds.size};` +
              `STEP=${index + 1};TOTAL=${mediaFiles.length};DETAIL=${stepMessage}`,
          );
        }
        throw new Error(
          `INSTAGRAM_STORY_SEQUENCE_STEP_FAILED:STORY_SEQUENCE_PUBLISHED_COUNT=${publishedStoryIds.size};` +
            `STEP=${index + 1};TOTAL=${mediaFiles.length};DETAIL=${stepMessage}`,
        );
      }

      if (index < mediaFiles.length - 1 && INSTAGRAM_STORY_SEQUENCE_STEP_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, INSTAGRAM_STORY_SEQUENCE_STEP_DELAY_MS));
      }
    }
    return {
      publishedMediaId: null,
    };
  }

  const firstMediaFilePath = mediaFiles[0]!;
  const mediaUrl = appendInstagramMediaCacheBuster(
    resolvePublicUploadUrl(firstMediaFilePath),
    job.id,
    path.basename(firstMediaFilePath) || "media",
    normalizedPublicationType,
  );
  const published = await executeInstagramJobWithGraphApi(
    {
      id: connection.id,
      loginIdentifier: connection.loginIdentifier,
      secretCipher: connection.secretCipher,
    },
    {
      id: job.id,
      publicationType: normalizedPublicationType,
      caption: job.caption,
      locationName: locationMetadata.locationName,
      locationId: locationMetadata.locationId,
      altText: mediaBundle.captions[0] ?? null,
    },
    mediaUrl,
  );

  await publishInstagramFirstCommentIfConfigured({
    connection,
    job,
    publishedMediaId: published.publishedMediaId,
  });

  return {
    publishedMediaId: published.publishedMediaId,
  };
}

function isSequentialStoryJob(input: {
  filePath: string;
  publicationType?: string | null;
  postStory?: boolean;
  postReel?: boolean;
  postWhatsapp?: boolean;
}): boolean {
  if (normalizePublicationType(input) !== "instagram_story") {
    return false;
  }

  const mediaBundle = decodeJobMediaBundleStorage(input.filePath);
  const mediaFiles = mediaBundle.files.length > 0
    ? mediaBundle.files
    : (input.filePath?.trim() ? [input.filePath.trim()] : []);

  return mediaBundle.sequential && mediaFiles.length > 1;
}

function parseSequentialStoryPublishedCountFromError(message: string): number | null {
  const match = message.match(/STORY_SEQUENCE_PUBLISHED_COUNT=(\d+)/);
  if (!match || !match[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseSequentialStoryFailureMetadata(message: string): {
  publishedCount: number;
  step: number;
  total: number;
} | null {
  const match = message.match(/STORY_SEQUENCE_PUBLISHED_COUNT=(\d+);STEP=(\d+);TOTAL=(\d+)/i);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null;
  }

  const publishedCount = Number.parseInt(match[1], 10);
  const step = Number.parseInt(match[2], 10);
  const total = Number.parseInt(match[3], 10);
  if (!Number.isFinite(publishedCount) || !Number.isFinite(step) || !Number.isFinite(total)) {
    return null;
  }

  return {
    publishedCount: Math.max(0, publishedCount),
    step: Math.max(1, step),
    total: Math.max(1, total),
  };
}

function isRetryableInstagramStoryStepError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.includes("/media_publish:")) {
    return false;
  }

  if (normalized.includes("media_fetch_invalid_type") || normalized.includes("media_url_invalid")) {
    return true;
  }

  return isInstagramTransientExecutionError(message);
}

async function executeInstagramStorySequenceStepWithRetry(input: {
  connection: {
    id: string;
    loginIdentifier: string | null;
    secretCipher: string | null;
  };
  job: {
    id: string;
    companyId?: string;
    caption: string | null;
    locationName: string | null;
    publicationType?: string | null;
  };
  locationMetadata: {
    locationName: string | null;
    locationId: string | null;
  };
  mediaUrl: string;
  altText: string | null;
  index: number;
  total: number;
  fileName: string;
}): Promise<{
  creationId: string;
  publishedMediaId: string;
}> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await executeInstagramJobWithGraphApi(
        {
          id: input.connection.id,
          loginIdentifier: input.connection.loginIdentifier,
          secretCipher: input.connection.secretCipher,
        },
        {
          id: input.job.id,
          publicationType: normalizePublicationType(input.job),
          caption: input.job.caption,
          locationName: input.locationMetadata.locationName,
          locationId: input.locationMetadata.locationId,
          altText: input.altText,
        },
        input.mediaUrl,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "INSTAGRAM_STORY_SEQUENCE_STEP_FAILED";
      lastError = error instanceof Error ? error : new Error(message);
      const retryable = isRetryableInstagramStoryStepError(message);
      const isLastAttempt = attempt >= INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_ATTEMPTS;

      if (!retryable || isLastAttempt) {
        throw lastError;
      }

      if (input.job.companyId) {
        await appendLog({
          companyId: input.job.companyId,
          level: "WARN",
          errorCode: "INSTAGRAM_STORY_STEP_AUTO_RETRY",
          message:
            `Job ${input.job.id} story ${input.index + 1}/${input.total} falhou na tentativa ${attempt}. ` +
            `Nova tentativa automática em ${INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_DELAY_MS}ms. ` +
            `arquivo=${input.fileName}. Erro: ${message}`,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_DELAY_MS));
    }
  }

  throw lastError ?? new Error("INSTAGRAM_STORY_SEQUENCE_STEP_FAILED");
}

function buildReschedulableMediaBundleForJob(job: {
  filePath: string;
  publicationType?: string | null;
  postStory?: boolean;
  postReel?: boolean;
  postWhatsapp?: boolean;
  lastError?: string | null;
}): {
  encodedFilePath: string;
  mediaCount: number;
  totalCount: number;
  remainingOnly: boolean;
} {
  const normalizedPublicationType = normalizePublicationType(job);
  const mediaBundle = decodeJobMediaBundleStorage(job.filePath);
  const mediaFiles = mediaBundle.files.length > 0
    ? mediaBundle.files
    : (job.filePath?.trim() ? [job.filePath.trim()] : []);

  if (mediaFiles.length === 0) {
    throw new Error("INSTAGRAM_GRAPH_MEDIA_URL_INVALID");
  }

  if (normalizedPublicationType === "instagram_story" && mediaBundle.sequential && mediaFiles.length > 1) {
    const failureMetadata = parseSequentialStoryFailureMetadata(job.lastError ?? "");
    const publishedCount = failureMetadata?.publishedCount ?? 0;

    if (publishedCount > 0 && publishedCount < mediaFiles.length) {
      const remainingFiles = mediaFiles.slice(publishedCount);
      const remainingCaptions = mediaBundle.captions.slice(publishedCount);
      return {
        encodedFilePath: encodeJobMediaBundleStorage({
          files: remainingFiles,
          sequential: remainingFiles.length > 1,
          captions: remainingCaptions,
        }),
        mediaCount: remainingFiles.length,
        totalCount: mediaFiles.length,
        remainingOnly: true,
      };
    }
  }

  return {
    encodedFilePath: job.filePath,
    mediaCount: mediaFiles.length,
    totalCount: mediaFiles.length,
    remainingOnly: false,
  };
}

async function executeInstagramRunningJob(job: {
  id: string;
  companyId: string;
  tentativas: number;
  filePath: string;
  caption: string | null;
  firstComment: string | null;
  locationName: string | null;
  publicationType: string;
  postStory: boolean;
  postReel: boolean;
  postWhatsapp: boolean;
  whatsappRelinkEnabled: boolean;
  whatsappRelinkConnectionIds: unknown;
  whatsappRelinkDispatchedAt: Date | null;
  instagramPermalink: string | null;
  createdByUserId: string | null;
}, connection: {
  id: string;
  displayName: string;
  loginIdentifier: string | null;
  secretCipher: string | null;
}): Promise<void> {
  const effectiveConnection = {
    id: connection.id,
    loginIdentifier: connection.loginIdentifier,
    secretCipher: connection.secretCipher,
  };

  try {
    await appendLog({
      companyId: job.companyId,
      level: "INFO",
      message: `Job ${job.id} iniciado pelo consumidor RabbitMQ do Instagram.`,
    });

    const refreshStartedAtMs = Date.now();
    if (shouldAttemptProactiveInstagramTokenRefresh(connection.id, refreshStartedAtMs)) {
      markProactiveInstagramTokenRefreshAttempt(connection.id, refreshStartedAtMs);

      try {
        const refreshed = await refreshInstagramAccessTokenForConnection({
          secretCipher: effectiveConnection.secretCipher,
        });
        const refreshedSecretCipher = encodeSecret(refreshed.accessToken);
        if (refreshedSecretCipher) {
          effectiveConnection.secretCipher = refreshedSecretCipher;
          const refreshedAt = new Date();

          await prisma.socialConnection.update({
            where: { id: connection.id },
            data: {
              secretCipher: refreshedSecretCipher,
              authStatus: "CONNECTED",
              lastSeenAt: refreshedAt,
            },
          });

          await appendLog({
            companyId: job.companyId,
            level: "INFO",
            message:
              `Token da conta ${connection.displayName} foi renovado automaticamente antes da execução do job ${job.id}.`,
          });
        }
      } catch (proactiveRefreshError) {
        const proactiveRefreshMessage = proactiveRefreshError instanceof Error
          ? proactiveRefreshError.message
          : "INSTAGRAM_GRAPH_TOKEN_REFRESH_FAILED";
        const proactiveRefreshRequiresLogin = isInstagramLoginRequiredErrorMessage(proactiveRefreshMessage);

        if (proactiveRefreshRequiresLogin) {
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "WAITING_LOGIN",
              lastError: "Aguardando autenticação do Instagram.",
            },
          });

          await prisma.socialConnection.update({
            where: { id: connection.id },
            data: {
              authStatus: "AUTH_REQUIRED",
              secretCipher: null,
              lastAuthAt: null,
              authLaunchUrl: null,
              lastSeenAt: null,
            },
          });

          await appendLog({
            companyId: job.companyId,
            level: "WARN",
            errorCode: "LOGIN_REQUIRED_INSTAGRAM",
            message: `Job ${job.id} aguardando novo login antes da execução: ${proactiveRefreshMessage}`,
          });

          await appendJobAvisoSafely(job, {
            title: "Aguardando autenticação",
            kind: "JOB_WAITING_LOGIN",
            message: "A conta do Instagram precisa ser autenticada para continuar.",
          });
          return;
        }

        await appendLog({
          companyId: job.companyId,
          level: "WARN",
          errorCode: "INSTAGRAM_TOKEN_REFRESH_PRECHECK_FAILED",
          message:
            `Falha ao renovar token antes do job ${job.id}. Continuando com o token atual. Erro: ${proactiveRefreshMessage}`,
        });
      }
    }

    const executionResult = await executeInstagramJobWithResolvedMediaBundle(effectiveConnection, job);

    await dispatchWhatsappRelinkJobsForInstagramPublication({
      job,
      connection: {
        secretCipher: effectiveConnection.secretCipher,
      },
      publishedMediaId: executionResult.publishedMediaId,
    });

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        lastError: null,
      },
    });

    await appendLog({
      companyId: job.companyId,
      level: "INFO",
      message: `Job ${job.id} concluído pelo consumidor RabbitMQ do Instagram.`,
    });

    await appendJobAvisoSafely(job, {
      title: "Postagem enviada",
      kind: "JOB_SENT",
      message: "Publicacao concluida com sucesso.",
    });
  } catch (error) {
    let message = error instanceof Error ? error.message : "Erro desconhecido no consumidor RabbitMQ do Instagram.";
    let waitingLogin = isInstagramLoginRequiredErrorMessage(message);
    const sequentialStoryJob = isSequentialStoryJob(job);
    const publishedCountBeforeFailure = sequentialStoryJob ? parseSequentialStoryPublishedCountFromError(message) : null;
    const canRetrySequentialStoryFromStart = sequentialStoryJob && publishedCountBeforeFailure === 0;

    if (waitingLogin && !sequentialStoryJob) {
      try {
        const refreshed = await refreshInstagramAccessTokenForConnection({
          secretCipher: effectiveConnection.secretCipher,
        });
        const refreshedSecretCipher = encodeSecret(refreshed.accessToken);
        const refreshedAt = new Date();
        effectiveConnection.secretCipher = refreshedSecretCipher;
        await prisma.socialConnection.update({
          where: { id: connection.id },
          data: {
            secretCipher: refreshedSecretCipher,
            authStatus: "CONNECTED",
            lastSeenAt: refreshedAt,
          },
        });

        await appendLog({
          companyId: job.companyId,
          level: "INFO",
          message:
            `Token da conta ${connection.displayName} foi renovado automaticamente. ` +
            "Retentando publicação sem exigir novo login.",
        });

        const executionResult = await executeInstagramJobWithResolvedMediaBundle(effectiveConnection, job);

        await dispatchWhatsappRelinkJobsForInstagramPublication({
          job,
          connection: {
            secretCipher: effectiveConnection.secretCipher,
          },
          publishedMediaId: executionResult.publishedMediaId,
        });

        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            lastError: null,
          },
        });

        await appendLog({
          companyId: job.companyId,
          level: "INFO",
          message: `Job ${job.id} concluido após renovacao automatica do token.`,
        });

        await appendJobAvisoSafely(job, {
          title: "Postagem enviada",
          kind: "JOB_SENT",
          message: "Publicacao concluida com sucesso.",
        });
        return;
      } catch (refreshError) {
        message = refreshError instanceof Error ? refreshError.message : message;
        waitingLogin = isInstagramLoginRequiredErrorMessage(message);
      }
    } else if (waitingLogin && sequentialStoryJob) {
      try {
        const refreshed = await refreshInstagramAccessTokenForConnection({
          secretCipher: effectiveConnection.secretCipher,
        });
        const refreshedSecretCipher = encodeSecret(refreshed.accessToken);
        const refreshedAt = new Date();
        effectiveConnection.secretCipher = refreshedSecretCipher;
        await prisma.socialConnection.update({
          where: { id: connection.id },
          data: {
            secretCipher: refreshedSecretCipher,
            authStatus: "CONNECTED",
            lastSeenAt: refreshedAt,
          },
        });

        if (canRetrySequentialStoryFromStart) {
          await appendLog({
            companyId: job.companyId,
            level: "INFO",
            message:
              `Token da conta ${connection.displayName} foi renovado automaticamente. ` +
              "Retentando stories em sequência sem exigir novo login.",
          });

          const executionResult = await executeInstagramJobWithResolvedMediaBundle(effectiveConnection, job);

          await dispatchWhatsappRelinkJobsForInstagramPublication({
            job,
            connection: {
              secretCipher: effectiveConnection.secretCipher,
            },
            publishedMediaId: executionResult.publishedMediaId,
          });

          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
              lastError: null,
            },
          });

          await appendLog({
            companyId: job.companyId,
            level: "INFO",
            message: `Job ${job.id} concluido após renovacao automatica do token.`,
          });

          await appendJobAvisoSafely(job, {
            title: "Postagem enviada",
            kind: "JOB_SENT",
            message: "Publicacao concluida com sucesso.",
          });
          return;
        }

        waitingLogin = false;
        message = "INSTAGRAM_STORY_SEQUENCE_INTERRUPTED_TOKEN_REFRESHED";

        await appendLog({
          companyId: job.companyId,
          level: "WARN",
          errorCode: "INSTAGRAM_STORY_SEQUENCE_INTERRUPTED",
          message:
            `Job ${job.id} (stories em sequência) foi interrompido para evitar duplicação. ` +
            "Token renovado automaticamente; reenfileire manualmente se quiser continuar.",
        });
      } catch (refreshError) {
        message = refreshError instanceof Error ? refreshError.message : message;
        waitingLogin = isInstagramLoginRequiredErrorMessage(message);

        await appendLog({
          companyId: job.companyId,
          level: "WARN",
          errorCode: "INSTAGRAM_STORY_SEQUENCE_WAITING_LOGIN",
          message:
            canRetrySequentialStoryFromStart
              ? `Job ${job.id} (stories em sequência) falhou antes do primeiro item, mas não foi possível renovar/reexecutar automaticamente. ` +
                "Será necessário autenticar e reenfileirar manualmente."
              : `Job ${job.id} (stories em sequência) não foi retentado automaticamente para evitar duplicação. ` +
                "Será necessário autenticar e reenfileirar manualmente.",
        });
      }
    }

    const errorCode = normalizeAutomationErrorCode(message);
    const attemptNumber = Math.max(job.tentativas, 1);
    const instagramRateLimited = isInstagramTooManyActionsMessage(message);
    const shouldAutoRetry =
      !sequentialStoryJob &&
      !waitingLogin &&
      isInstagramTransientExecutionError(message) &&
      attemptNumber < INSTAGRAM_WORKER_AUTO_RETRY_MAX_ATTEMPTS;

    if (shouldAutoRetry) {
      const retryAt = new Date(Date.now() + INSTAGRAM_WORKER_AUTO_RETRY_DELAY_MS);
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          dataPostagem: retryAt,
          startedAt: null,
          completedAt: null,
          lastError: null,
        },
      });

      await appendLog({
        companyId: job.companyId,
        level: "WARN",
        errorCode: "INSTAGRAM_AUTO_RETRY_SCHEDULED",
        message:
          `Job ${job.id} recebeu erro transitório e será retentado automaticamente ` +
          `(${attemptNumber}/${INSTAGRAM_WORKER_AUTO_RETRY_MAX_ATTEMPTS}) em ${retryAt.toISOString()}. ` +
          `Erro original: ${message}`,
      });

      if (instagramRateLimited && attemptNumber === 1) {
        await appendJobAvisoSafely(job, {
          title: "Bloqueio temporario do Instagram",
          kind: "JOB_RATE_LIMIT",
          message:
            "Muitas requisicoes em curto espaco de tempo. Aguarde ate 24 horas para liberacao de postagens e leia nosso FAQ para mais informacoes.",
        });
      }
      return;
    }

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: waitingLogin ? "WAITING_LOGIN" : "FAILED",
        lastError: waitingLogin
          ? "Aguardando autenticação do Instagram."
          : sequentialStoryJob
            ? `${message} (Sequência de stories interrompida; sem retentativa automática para evitar duplicação.)`
            : message,
      },
    });

    if (waitingLogin) {
      await prisma.socialConnection.update({
        where: { id: connection.id },
        data: {
          authStatus: "AUTH_REQUIRED",
          secretCipher: null,
          lastAuthAt: null,
          authLaunchUrl: null,
          lastSeenAt: null,
        },
      });
    }

    await appendLog({
      companyId: job.companyId,
      level: waitingLogin ? "WARN" : "ERROR",
      errorCode,
      message: `Job ${job.id} falhou no consumidor RabbitMQ do Instagram: ${message}`,
    });

    await appendJobAvisoSafely(
      job,
      waitingLogin
        ? {
            title: "Aguardando autenticação",
            kind: "JOB_WAITING_LOGIN",
            message: "A conta do Instagram precisa ser autenticada para continuar.",
          }
        : {
            title: "Falha no agendamento",
            kind: "JOB_FAILED",
            message: summarizeFailureMessageForAviso(normalizePublicationType(job), message),
          },
    );
  }
}

function startServerInstagramJobWorker(): void {
  const tick = async () => {
    try {
      const candidateJobs = await prisma.job.findMany({
        where: {
          publicationType: {
            in: ["instagram_post", "instagram_reel", "instagram_story"],
          },
          publicationState: "PUBLISHED",
          status: {
            in: ["PENDING", "WAITING_LOGIN"],
          },
          dataPostagem: {
            lte: new Date(),
          },
        },
        orderBy: [{ dataPostagem: "asc" }, { criadoEm: "asc" }],
        take: JOB_DISPATCH_BATCH_SIZE,
      });

      for (const job of candidateJobs) {
        const billingBlockedMessage = await resolveJobBillingBlockMessage(job);
        if (billingBlockedMessage) {
          await failJobDueToBillingBlocked(job, billingBlockedMessage);
          continue;
        }

        if (!job.socialConnectionId) {
          await failJobDueToConnectionUnavailable(job, {
            errorCode: "SOCIAL_CONNECTION_MISSING",
            message: "Conta social removida deste agendamento. Edite o agendamento e selecione uma conta conectada.",
          });
          continue;
        }

        const connection = await prisma.socialConnection.findFirst({
          where: {
            id: job.socialConnectionId,
            companyId: job.companyId,
            platform: "instagram",
          },
          select: {
            id: true,
            authStatus: true,
            secretCipher: true,
          },
        });

        if (!connection) {
          await failJobDueToConnectionUnavailable(job, {
            errorCode: "SOCIAL_CONNECTION_NOT_FOUND",
            message:
              "Conta social deste agendamento não está mais disponível. Edite o agendamento e selecione outra conta conectada.",
          });
          continue;
        }

        if (connection.authStatus !== "CONNECTED" || !connection.secretCipher) {
          if (job.status === "PENDING") {
            await prisma.job.update({
              where: { id: job.id },
              data: {
                status: "WAITING_LOGIN",
                startedAt: null,
                completedAt: null,
                lastError: "Aguardando autenticação do Instagram.",
              },
            });

            await appendJobAvisoSafely(job, {
              title: "Aguardando autenticação",
              kind: "JOB_WAITING_LOGIN",
              message: "A conta do Instagram precisa ser autenticada para continuar.",
            });
          }
          continue;
        }

        if (await isConnectionExecutionInProgress(connection.id)) {
          continue;
        }

        const lock = await prisma.job.updateMany({
          where: {
            id: job.id,
            status: {
              in: ["PENDING", "WAITING_LOGIN"],
            },
          },
          data: {
            status: "RUNNING",
            startedAt: new Date(),
            tentativas: { increment: 1 },
            lastError: null,
          },
        });

        if (lock.count === 0) {
          continue;
        }

        try {
          await enqueueJobForExecution({
            jobId: job.id,
            platform: "instagram",
          });
        } catch (error) {
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "PENDING",
              startedAt: null,
              completedAt: null,
              tentativas: { decrement: 1 },
              lastError: "Falha ao enfileirar job para processamento.",
            },
          });

          await appendLog({
            companyId: job.companyId,
            level: "ERROR",
            errorCode: "RABBITMQ_ENQUEUE_FAILED",
            message:
              `Falha ao enfileirar job ${job.id} do Instagram no RabbitMQ. ` +
              `Erro: ${error instanceof Error ? error.message : "desconhecido"}`,
          });
        }
      }
    } catch (error) {
      console.error("Server Instagram job dispatcher error", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, JOB_DISPATCH_INTERVAL_MS);
}

function startInstagramTokenKeepAliveWorker(): void {
  const tick = async () => {
    try {
      const nowMs = Date.now();
      const candidates = await prisma.socialConnection.findMany({
        where: {
          platform: "instagram",
          authStatus: "CONNECTED",
          secretCipher: {
            not: null,
          },
        },
        orderBy: {
          updatedAt: "asc",
        },
        take: INSTAGRAM_TOKEN_KEEPALIVE_BATCH_SIZE,
      });

      for (const connection of candidates) {
        if ((await isConnectionExecutionInProgress(connection.id)) || !shouldAttemptProactiveInstagramTokenRefresh(connection.id, nowMs)) {
          continue;
        }

        markProactiveInstagramTokenRefreshAttempt(connection.id, nowMs);

        try {
          const refreshed = await refreshInstagramAccessTokenForConnection({
            secretCipher: connection.secretCipher,
          });
          const refreshedSecretCipher = encodeSecret(refreshed.accessToken);
          if (!refreshedSecretCipher) {
            continue;
          }

          await prisma.socialConnection.update({
            where: { id: connection.id },
            data: {
              secretCipher: refreshedSecretCipher,
              authStatus: "CONNECTED",
              lastSeenAt: new Date(),
            },
          });
        } catch (refreshError) {
          const message = refreshError instanceof Error ? refreshError.message : "INSTAGRAM_GRAPH_TOKEN_REFRESH_FAILED";
          if (!isInstagramLoginRequiredErrorMessage(message)) {
            await appendLog({
              companyId: connection.companyId,
              level: "WARN",
              errorCode: "INSTAGRAM_TOKEN_KEEPALIVE_REFRESH_FAILED",
              message:
                `Keep-alive do token Instagram falhou para ${connection.displayName}. ` +
                `Tentará novamente no próximo ciclo. Erro: ${message}`,
            });
            continue;
          }

          if (!INSTAGRAM_KEEPALIVE_FORCE_DISCONNECT_ON_LOGIN_REQUIRED) {
            await appendLog({
              companyId: connection.companyId,
              level: "WARN",
              errorCode: "INSTAGRAM_TOKEN_KEEPALIVE_LOGIN_REQUIRED_DETECTED",
              message:
                `Keep-alive detectou login requerido para ${connection.displayName}, mas a conexão foi mantida. ` +
                "A desconexão automática ocorrerá apenas se uma publicação falhar por autenticação.",
            });
            continue;
          }

          await prisma.socialConnection.update({
            where: { id: connection.id },
            data: {
              authStatus: "AUTH_REQUIRED",
              secretCipher: null,
              lastAuthAt: null,
              authLaunchUrl: null,
              lastSeenAt: null,
            },
          });

          await appendLog({
            companyId: connection.companyId,
            level: "WARN",
            errorCode: "LOGIN_REQUIRED_INSTAGRAM",
            message:
              `Sessão Instagram da conta ${connection.displayName} foi invalidada pela Meta e a conexão foi desconectada automaticamente. ` +
              "Será necessário abrir login novamente.",
          });

          await appendInstagramAuthRequiredAvisosForConnection(connection.id);
        }
      }
    } catch (error) {
      console.error("Instagram token keep-alive worker error", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, INSTAGRAM_TOKEN_KEEPALIVE_INTERVAL_MS);
}

async function executeWhatsappRunningJob(job: {
  id: string;
  companyId: string;
  caption: string | null;
  publicationType: string;
  postStory: boolean;
  postReel: boolean;
  postWhatsapp: boolean;
  modoWhatsapp: string;
  createdByUserId: string | null;
}, connection: {
  id: string;
  authStatus: string;
  companyId: string;
  platform: string;
  displayName: string;
  loginIdentifier: string | null;
  secretCipher: string | null;
  automationMode: string;
  authLaunchUrl: string | null;
  lastAuthAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Promise<void> {
  try {
    await appendLog({
      companyId: job.companyId,
      level: "INFO",
      message: `Job ${job.id} iniciado pelo consumidor RabbitMQ do WhatsApp.`,
    });

    const delivery = await executeWhatsappJobWithEvolutionApi(connection, job, uploadsDir);

    if (delivery.confirmed) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          lastError: null,
        },
      });

      await appendLog({
        companyId: job.companyId,
        level: "INFO",
        errorCode: "WHATSAPP_STATUS_CONFIRMED",
        message:
          `Job ${job.id} confirmado no histórico da Evolution API. ` +
          `remoteJid=${delivery.remoteJid ?? "status@broadcast"} messageId=${delivery.messageId ?? "indisponivel"}`,
      });

      await appendJobAvisoSafely(job, {
        title: "Postagem enviada",
        kind: "JOB_SENT",
        message: "Publicacao concluida com sucesso.",
      });
      return;
    }

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "SENT_UNCONFIRMED",
        completedAt: new Date(),
        lastError: null,
      },
    });

    await appendLog({
      companyId: job.companyId,
      level: "WARN",
      errorCode: "WHATSAPP_SENT_UNCONFIRMED",
      message:
        `Job ${job.id} enviado pelo consumidor RabbitMQ do WhatsApp sem confirmacao de publicacao. ` +
        `remoteJid=${delivery.remoteJid ?? "status@broadcast"} messageId=${delivery.messageId ?? "indisponivel"}`,
    });

    await appendJobAvisoSafely(job, {
      title: "Postagem enviada sem confirmacao",
      kind: "JOB_SENT_UNCONFIRMED",
      message: "A API aceitou o envio, mas ainda sem confirmacao final do WhatsApp.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido no consumidor RabbitMQ do WhatsApp.";
    const waitingLogin = message === "LOGIN_REQUIRED_WHATSAPP";
    const errorCode = normalizeAutomationErrorCode(message);

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: waitingLogin ? "WAITING_LOGIN" : "FAILED",
        lastError: waitingLogin ? "Aguardando autenticação do WhatsApp." : message,
      },
    });

    if (waitingLogin) {
      await prisma.socialConnection.update({
        where: { id: connection.id },
        data: {
          authStatus: "AUTH_REQUIRED",
        },
      });
    }

    await appendLog({
      companyId: job.companyId,
      level: waitingLogin ? "WARN" : "ERROR",
      errorCode,
      message: `Job ${job.id} falhou no consumidor RabbitMQ do WhatsApp: ${message}`,
    });

    await appendJobAvisoSafely(
      job,
      waitingLogin
        ? {
            title: "Aguardando autenticação",
            kind: "JOB_WAITING_LOGIN",
            message: "A conta do WhatsApp precisa ser autenticada para continuar.",
          }
        : {
            title: "Falha no agendamento",
            kind: "JOB_FAILED",
            message: summarizeFailureMessageForAviso(normalizePublicationType(job), message),
          },
    );
  }
}

async function processQueuedJobMessage(
  queueMessage: JobExecutionQueueMessage,
): Promise<"ack" | "requeue"> {
  const job = await prisma.job.findUnique({
    where: { id: queueMessage.jobId },
  });

  if (!job) {
    return "ack";
  }

  if (normalizePublicationState(job.publicationState) !== "PUBLISHED") {
    return "ack";
  }

  if (job.status !== "RUNNING") {
    return "ack";
  }

  const billingBlockedMessage = await resolveJobBillingBlockMessage(job);
  if (billingBlockedMessage) {
    await failJobDueToBillingBlocked(job, billingBlockedMessage);
    return "ack";
  }

  const expectedPlatform = platformForPublication(normalizePublicationType(job));
  if (expectedPlatform !== queueMessage.platform) {
    return "ack";
  }

  if (!job.socialConnectionId) {
    await failJobDueToConnectionUnavailable(job, {
      errorCode: "SOCIAL_CONNECTION_MISSING",
      message: "Conta social removida deste agendamento. Edite o agendamento e selecione uma conta conectada.",
    });
    return "ack";
  }

  if (queueMessage.platform === "instagram") {
    const connection = await prisma.socialConnection.findFirst({
      where: {
        id: job.socialConnectionId,
        companyId: job.companyId,
        platform: "instagram",
      },
    });

    if (!connection) {
      await failJobDueToConnectionUnavailable(job, {
        errorCode: "SOCIAL_CONNECTION_NOT_FOUND",
        message:
          "Conta social deste agendamento não está mais disponível. Edite o agendamento e selecione outra conta conectada.",
      });
      return "ack";
    }

    const connectionLock = await acquireDistributedLock(
      connectionExecutionLockKey(connection.id),
      JOB_CONSUMER_CONNECTION_LOCK_MS,
    );
    if (!connectionLock) {
      return "requeue";
    }

    try {
      if (connection.authStatus !== "CONNECTED" || !connection.secretCipher) {
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: "WAITING_LOGIN",
            lastError: "Aguardando autenticação do Instagram.",
          },
        });

        await appendJobAvisoSafely(job, {
          title: "Aguardando autenticação",
          kind: "JOB_WAITING_LOGIN",
          message: "A conta do Instagram precisa ser autenticada para continuar.",
        });
        return "ack";
      }

      await executeInstagramRunningJob(job, connection);
      return "ack";
    } finally {
      await connectionLock.release();
    }
  }

  const connection = await prisma.socialConnection.findFirst({
    where: {
      id: job.socialConnectionId,
      companyId: job.companyId,
      platform: "whatsapp",
    },
  });

  if (!connection) {
    await failJobDueToConnectionUnavailable(job, {
      errorCode: "SOCIAL_CONNECTION_NOT_FOUND",
      message:
        "Conta social deste agendamento não está mais disponível. Edite o agendamento e selecione outra conta conectada.",
    });
    return "ack";
  }

  const connectionLock = await acquireDistributedLock(
    connectionExecutionLockKey(connection.id),
    JOB_CONSUMER_CONNECTION_LOCK_MS,
  );
  if (!connectionLock) {
    return "requeue";
  }

  try {
    if (connection.authStatus !== "CONNECTED") {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "WAITING_LOGIN",
          lastError: "Aguardando autenticação do WhatsApp.",
        },
      });

      await appendJobAvisoSafely(job, {
        title: "Aguardando autenticação",
        kind: "JOB_WAITING_LOGIN",
        message: "A conta do WhatsApp precisa ser autenticada para continuar.",
      });
      return "ack";
    }

    await executeWhatsappRunningJob(job, connection);
    return "ack";
  } finally {
    await connectionLock.release();
  }
}

async function startRabbitJobExecutionConsumer(): Promise<void> {
  while (true) {
    try {
      await startJobExecutionConsumer(async (queueMessage) => processQueuedJobMessage(queueMessage));
      console.log("RabbitMQ consumer online for job execution.");
      return;
    } catch (error) {
      console.error(
        `Failed to start RabbitMQ job consumer. Retrying in ${RABBITMQ_CONSUMER_RETRY_DELAY_MS}ms...`,
        error,
      );
      await new Promise((resolve) => setTimeout(resolve, RABBITMQ_CONSUMER_RETRY_DELAY_MS));
    }
  }
}

function startServerWhatsappJobWorker(): void {
  const tick = async () => {
    try {
      const candidateJobs = await prisma.job.findMany({
        where: {
          publicationType: {
            in: ["whatsapp_status_midia"],
          },
          publicationState: "PUBLISHED",
          status: {
            in: ["PENDING", "WAITING_LOGIN"],
          },
          dataPostagem: {
            lte: new Date(),
          },
        },
        orderBy: [{ dataPostagem: "asc" }, { criadoEm: "asc" }],
        take: JOB_DISPATCH_BATCH_SIZE,
      });

      for (const job of candidateJobs) {
        const billingBlockedMessage = await resolveJobBillingBlockMessage(job);
        if (billingBlockedMessage) {
          await failJobDueToBillingBlocked(job, billingBlockedMessage);
          continue;
        }

        if (!job.socialConnectionId) {
          await failJobDueToConnectionUnavailable(job, {
            errorCode: "SOCIAL_CONNECTION_MISSING",
            message: "Conta social removida deste agendamento. Edite o agendamento e selecione uma conta conectada.",
          });
          continue;
        }

        const connection = await prisma.socialConnection.findFirst({
          where: {
            id: job.socialConnectionId,
            companyId: job.companyId,
            platform: "whatsapp",
          },
          select: {
            id: true,
            authStatus: true,
          },
        });

        if (!connection) {
          await failJobDueToConnectionUnavailable(job, {
            errorCode: "SOCIAL_CONNECTION_NOT_FOUND",
            message:
              "Conta social deste agendamento não está mais disponível. Edite o agendamento e selecione outra conta conectada.",
          });
          continue;
        }

        if (connection.authStatus !== "CONNECTED") {
          if (job.status === "PENDING") {
            await prisma.job.update({
              where: { id: job.id },
              data: {
                status: "WAITING_LOGIN",
                startedAt: null,
                completedAt: null,
                lastError: "Aguardando autenticação do WhatsApp.",
              },
            });

            await appendJobAvisoSafely(job, {
              title: "Aguardando autenticação",
              kind: "JOB_WAITING_LOGIN",
              message: "A conta do WhatsApp precisa ser autenticada para continuar.",
            });
          }
          continue;
        }

        if (await isConnectionExecutionInProgress(connection.id)) {
          continue;
        }

        const lock = await prisma.job.updateMany({
          where: {
            id: job.id,
            status: {
              in: ["PENDING", "WAITING_LOGIN"],
            },
          },
          data: {
            status: "RUNNING",
            startedAt: new Date(),
            tentativas: { increment: 1 },
            lastError: null,
          },
        });

        if (lock.count === 0) {
          continue;
        }

        try {
          await enqueueJobForExecution({
            jobId: job.id,
            platform: "whatsapp",
          });
        } catch (error) {
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "PENDING",
              startedAt: null,
              completedAt: null,
              tentativas: { decrement: 1 },
              lastError: "Falha ao enfileirar job para processamento.",
            },
          });

          await appendLog({
            companyId: job.companyId,
            level: "ERROR",
            errorCode: "RABBITMQ_ENQUEUE_FAILED",
            message:
              `Falha ao enfileirar job ${job.id} do WhatsApp no RabbitMQ. ` +
              `Erro: ${error instanceof Error ? error.message : "desconhecido"}`,
          });
        }
      }
    } catch (error) {
      console.error("Server WhatsApp job dispatcher error", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, JOB_DISPATCH_INTERVAL_MS);
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
  const billingSettings = await getBillingSettingsSnapshot();

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
    const now = new Date();
    const trialPlan = billingSettings.autoTrialEnabled
      ? await transaction.plan.findFirst({
          where: {
            isActive: true,
            isTrial: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        })
      : null;
    const fallbackPaidPlan = !trialPlan
      ? await transaction.plan.findFirst({
          where: {
            isActive: true,
            isTrial: false,
          },
          orderBy: {
            createdAt: "asc",
          },
        })
      : null;

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
        timeZone: true,
        createdAt: true,
      },
    });

    const hasAutoTrial = billingSettings.autoTrialEnabled && billingSettings.autoTrialDays > 0 && trialPlan;
    const trialEndsAt = hasAutoTrial
      ? new Date(now.getTime() + billingSettings.autoTrialDays * 24 * 60 * 60 * 1000)
      : null;

    await transaction.userPlanSubscription.create({
      data: {
        userId: createdUser.id,
        planId: hasAutoTrial ? trialPlan.id : fallbackPaidPlan?.id ?? null,
        status: hasAutoTrial ? "TRIALING" : "PAYMENT_REQUIRED",
        billingModel: hasAutoTrial ? "TRIAL" : "NONE",
        startsAt: now,
        trialEndsAt,
        endsAt: trialEndsAt,
        blockedReason: hasAutoTrial ? null : "Aguardando pagamento inicial.",
      },
    });

    await transaction.setupInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });

    return createdUser;
  });

  const authUserPayload = await buildAuthUserPayload(user);
  response.status(201).json(authUserPayload);
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
      timeZone: true,
      role: true,
    },
  });

  const authUserPayload = await buildAuthUserPayload(authenticatedUser);

  response.json({
    sessionToken,
    user: authUserPayload,
  });
});

app.get("/auth/me", adminAuthMiddleware, async (request, response) => {
  const user = (
    request as Request & { adminUser?: { id: string; name: string; username: string; timeZone: string; role: string } }
  ).adminUser!;
  const authUserPayload = await buildAuthUserPayload(user);
  response.json({ user: authUserPayload });
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
      timeZone:
        payload.timeZone === undefined || payload.timeZone === null
          ? undefined
          : normalizeUserTimeZone(payload.timeZone),
    },
    select: {
      id: true,
      name: true,
      username: true,
      timeZone: true,
      role: true,
    },
  });

  const authUserPayload = await buildAuthUserPayload(updatedUser);
  response.json({ user: authUserPayload });
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

app.get("/oauth/instagram/callback", async (request, response) => {
  const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
  const code = typeof request.query.code === "string" ? request.query.code.trim() : "";
  const oauthError = typeof request.query.error === "string" ? request.query.error.trim() : "";
  const oauthErrorDescription =
    typeof request.query.error_description === "string" ? request.query.error_description.trim() : "";
  const consumedState = consumeInstagramOAuthState(state);

  if (!state || !consumedState) {
    const looksLikeProcessedRefresh = Boolean(code || oauthError || oauthErrorDescription);
    respondInstagramOAuthResult(response, {
      statusCode: looksLikeProcessedRefresh ? 200 : 400,
      success: looksLikeProcessedRefresh,
      postMessage: false,
      message: looksLikeProcessedRefresh
        ? "Autorização já processada nesta janela."
        : "A autorização expirou ou não é válida. Gere um novo login no painel.",
    });
    return;
  }

  const connection = await prisma.socialConnection.findUnique({
    where: { id: consumedState.connectionId },
  });

  if (!connection || connection.platform !== "instagram") {
    respondInstagramOAuthResult(response, {
      statusCode: 404,
      success: false,
      connectionId: consumedState.connectionId,
      returnToUrl: consumedState.returnToUrl,
      message: "Conta de Instagram não encontrada para concluir a autorização.",
    });
    return;
  }

  if (oauthError) {
    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        authStatus: "AUTH_REQUIRED",
        authLaunchUrl: null,
        lastSeenAt: null,
      },
    });

    const errorMessage = oauthErrorDescription || oauthError;
    await appendLog({
      companyId: connection.companyId,
      level: "WARN",
      errorCode: "INSTAGRAM_OAUTH_DENIED",
      message: `Autorização Instagram cancelada para ${connection.displayName}: ${errorMessage}`,
    });

    respondInstagramOAuthResult(response, {
      statusCode: 400,
      success: false,
      connectionId: connection.id,
      returnToUrl: consumedState.returnToUrl,
      message: `Autorização cancelada: ${errorMessage}`,
    });
    return;
  }

  if (!code) {
    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        authStatus: "AUTH_REQUIRED",
        authLaunchUrl: null,
        lastSeenAt: null,
      },
    });

    await appendLog({
      companyId: connection.companyId,
      level: "ERROR",
      errorCode: "INSTAGRAM_OAUTH_CODE_MISSING",
      message: `Falha ao concluir OAuth da conta ${connection.displayName}: código não retornado pela Meta.`,
    });

    respondInstagramOAuthResult(response, {
      statusCode: 400,
      success: false,
      connectionId: connection.id,
      returnToUrl: consumedState.returnToUrl,
      message: "Não foi possível concluir a autorização: código OAuth ausente.",
    });
    return;
  }

  try {
    const oauthResult = await exchangeInstagramOAuthCodeForConnection({
      authorizationCode: code,
      preferredInstagramIdentifier: connection.loginIdentifier,
    });
    const now = new Date();

    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        authStatus: "CONNECTED",
        loginIdentifier: oauthResult.instagramUserId,
        secretCipher: encodeSecret(oauthResult.accessToken),
        authLaunchUrl: null,
        lastAuthAt: now,
        lastSeenAt: now,
      },
    });

    await appendLog({
      companyId: connection.companyId,
      level: "INFO",
      message: `Conta ${connection.displayName} conectada via OAuth (Instagram @${oauthResult.instagramUsername || "sem-username"}).`,
    });

    respondInstagramOAuthResult(response, {
      statusCode: 200,
      success: true,
      connectionId: connection.id,
      returnToUrl: consumedState.returnToUrl,
      message: `Conta conectada com sucesso${oauthResult.instagramUsername ? ` (@${oauthResult.instagramUsername})` : ""}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INSTAGRAM_OAUTH_CALLBACK_UNKNOWN_ERROR";

    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        authStatus: "AUTH_REQUIRED",
        secretCipher: null,
        authLaunchUrl: null,
        lastSeenAt: null,
      },
    });

    await appendLog({
      companyId: connection.companyId,
      level: "ERROR",
      errorCode: normalizeAutomationErrorCode(message),
      message: `Falha ao conectar conta ${connection.displayName} via OAuth da Meta: ${message}`,
    });

    respondInstagramOAuthResult(response, {
      statusCode: 400,
      success: false,
      connectionId: connection.id,
      returnToUrl: consumedState.returnToUrl,
      message: `Falha ao concluir autorização: ${message}`,
    });
  }
});

app.get("/share/instagram/:jobId", async (request, response) => {
  const jobId = request.params.jobId?.trim() || "";
  if (!jobId) {
    response.status(404).type("html").send("Compartilhamento não encontrado.");
    return;
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      caption: true,
      filePath: true,
      instagramPermalink: true,
      publicationType: true,
      postStory: true,
      postReel: true,
      postWhatsapp: true,
      modoWhatsapp: true,
    },
  });

  if (!job || !job.instagramPermalink || !isInstagramPublication(normalizePublicationType(job))) {
    response.status(404).type("html").send("Compartilhamento não encontrado.");
    return;
  }

  const shareUrl =
    buildInstagramRelinkShareUrl(job.id) ||
    `${request.protocol}://${request.get("host") || "localhost:4000"}${request.originalUrl}`;
  const previewTitle = "Veja esta publicação no Instagram";
  const previewDescription =
    compactAvisoText(job.caption, 160) || "Abra o link para visualizar o conteúdo no Instagram.";
  const previewImageUrl = buildInstagramSharePreviewCardUrl(job.id);

  response.setHeader("Cache-Control", "public, max-age=300");
  response.type("html").send(
    renderInstagramShareLandingPage({
      shareUrl,
      redirectUrl: job.instagramPermalink,
      previewTitle,
      previewDescription,
      previewImageUrl,
    }),
  );
});

app.get("/share/instagram/:jobId/preview.svg", async (request, response) => {
  const jobId = request.params.jobId?.trim() || "";
  if (!jobId) {
    response.status(404).type("text/plain").send("Preview não encontrado.");
    return;
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      caption: true,
      filePath: true,
      publicationType: true,
    },
  });

  if (!job) {
    response.status(404).type("text/plain").send("Preview não encontrado.");
    return;
  }

  const previewTitle = "Veja esta publicação no Instagram";
  const previewDescription =
    compactAvisoText(job.caption, 160) || "Abra o link para visualizar o conteúdo no Instagram.";
  const previewImageUrl = resolveInstagramSharePreviewImageUrl(job.filePath);

  response.setHeader("Cache-Control", "public, max-age=300");
  response.type("image/svg+xml").send(
    renderInstagramSharePreviewSvg({
      publicationType: job.publicationType,
      previewTitle,
      previewDescription,
      previewImageUrl,
    }),
  );
});

app.post(STRIPE_WEBHOOK_PATH, async (request, response) => {
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    response.status(503).json({
      error: "Stripe webhook indisponível. Configure STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET no backend.",
    });
    return;
  }

  const webhookRequest = request as StripeWebhookRequest;
  const signatureHeader = request.headers["stripe-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!signature) {
    response.status(400).json({ error: "Cabeçalho stripe-signature ausente." });
    return;
  }
  if (!webhookRequest.rawBody) {
    response.status(400).json({ error: "Payload raw do webhook não disponível para validação." });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = ensureStripeClient();
    event = stripe.webhooks.constructEvent(webhookRequest.rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? `Assinatura inválida do webhook: ${error.message}` : "Assinatura inválida do webhook.",
    });
    return;
  }

  try {
    await handleStripeWebhookEvent(event);
    response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", error);
    response.status(500).json({ error: "Falha ao processar webhook Stripe." });
  }
});

app.use(
  ["/companies", "/connections", "/upload", "/jobs", "/dashboard", "/logs", "/avisos", "/billing", "/bee-up"],
  adminAuthMiddleware,
);

app.use(
  ["/companies", "/connections", "/upload", "/jobs"],
  async (request, response, next) => {
    const authRequest = request as Request & { adminUser?: AdminUserAuth };
    const writableMethod = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
    if (!writableMethod || isRootUser(authRequest)) {
      next();
      return;
    }

    try {
      await ensureBillingWritableAccess(authRequest);
      next();
    } catch (error) {
      response.status(402).json({
        error:
          error instanceof Error && error.message
            ? error.message
            : "Conta bloqueada por pagamento pendente. Renove para continuar.",
      });
    }
  },
);

registerBeeUpRoutes(app, {
  isRootUser,
  resolveUserBillingAccess,
  requestWhatsappQr,
  appendLog,
});

app.get("/connections", async (request, response) => {
  const companyId = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connections = await prisma.socialConnection.findMany({
    where: connectionVisibilityWhere(authRequest, companyId),
    orderBy: [{ companyId: "asc" }, { createdAt: "desc" }],
  });

  const mappedConnections = await Promise.all(
    connections.map(async (connection) => {
      const syncedConnection = await syncConnectionRuntimeState(connection);
      const runtimeMetadata = await resolveConnectionRuntimeMetadata(syncedConnection);
      return {
        ...mapConnection(syncedConnection),
        ...runtimeMetadata,
      };
    }),
  );

  response.json(mappedConnections);
});

app.get("/connections/:id/instagram-location-candidates", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
    select: {
      id: true,
      createdByUserId: true,
      platform: true,
      secretCipher: true,
    },
  });

  if (!connection || connection.platform !== "instagram") {
    response.status(404).json({ error: "Conta do Instagram não encontrada." });
    return;
  }

  if (!isRootUser(authRequest) && connection.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Você não pode consultar localizações desta conta." });
    return;
  }

  try {
    const items = await withTimeout(
      listInstagramLocationCandidatesForConnection({
        secretCipher: connection.secretCipher,
        limit: 200,
      }),
      10_000,
      "INSTAGRAM_GRAPH_LOCATION_CANDIDATES_TIMEOUT",
    );

    const firstWithLocation = items.find((item) => (item.city?.trim().length ?? 0) > 0) ?? null;
    response.json({
      items,
      recommendedLocationId: firstWithLocation?.pageId ?? null,
      recommendedLocationName: firstWithLocation?.city ?? firstWithLocation?.pageName ?? null,
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Falha ao listar localizações da conta.";
    if (isInstagramLoginRequiredErrorMessage(message)) {
      response.status(400).json({ error: "Conta do Instagram exige nova autenticação para listar location_id." });
      return;
    }
    if (message === "INSTAGRAM_GRAPH_LOCATION_CANDIDATES_TIMEOUT") {
      response.status(408).json({ error: "A listagem de localizações demorou demais. Tente novamente." });
      return;
    }
    response.status(400).json({ error: message });
  }
});

app.post("/connections", async (request, response) => {
  const payload = createConnectionSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const loginIdentifier = payload.loginIdentifier?.trim() || null;
  const secretCipher = encodeSecret(payload.secret);
  const company = await prisma.company.findUnique({
    where: { id: payload.companyId },
    select: { id: true, createdByUserId: true },
  });

  if (!company) {
    response.status(400).json({ error: "Perfil inválido. Selecione um perfil existente." });
    return;
  }

  if (!isRootUser(authRequest) && company.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Você não pode adicionar conta em um perfil de outro usuário." });
    return;
  }

  const billingAccess = await ensureBillingWritableAccess(authRequest);
  if (billingAccess && billingAccess.plan && billingAccess.usage.connectionsUsed >= billingAccess.plan.maxConnections) {
    response.status(409).json({
      error: `Seu plano atingiu o limite de ${billingAccess.plan.maxConnections} conta(s) conectada(s).`,
    });
    return;
  }

  if (
    payload.platform === "whatsapp" &&
    !isWhatsappEvolutionHardcodedEnabled() &&
    !loginIdentifier
  ) {
    response.status(400).json({
      error:
        "Para WhatsApp (Evolution API), informe o Nome da Instancia. A API Key pode ficar no backend (EVOLUTION_API_KEY) ou no campo segredo desta conta.",
    });
    return;
  }

  const launchUrl = defaultAuthLaunchUrlForPlatform(payload.platform);
  const connection = await prisma.socialConnection.create({
    data: {
      companyId: payload.companyId,
      createdByUserId: authRequest.adminUser!.id,
      platform: payload.platform,
      displayName: payload.displayName,
      loginIdentifier,
      secretCipher,
      authStatus: "AUTH_REQUIRED",
      automationMode: "VISUAL",
      authLaunchUrl: launchUrl,
    },
  });

  await appendLog({
    companyId: payload.companyId,
    level: "INFO",
    message: `Conta ${payload.displayName} (${payload.platform}) criada e pronta para autenticação.`,
  });

  response.status(201).json(mapConnection(connection));
});

app.put("/connections/:id", async (request, response) => {
  const payload = updateConnectionSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingConnection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!existingConnection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  if (!isRootUser(authRequest) && existingConnection.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Você não pode editar uma conta de outro usuário." });
    return;
  }

  const nextLoginIdentifier =
    payload.loginIdentifier !== undefined ? payload.loginIdentifier?.trim() || null : existingConnection.loginIdentifier;
  const nextSecretCipher =
    payload.secret !== undefined ? encodeSecret(payload.secret) : existingConnection.secretCipher;

  if (
    existingConnection.platform === "whatsapp" &&
    !isWhatsappEvolutionHardcodedEnabled() &&
    !nextLoginIdentifier
  ) {
    response.status(400).json({
      error:
        "Para WhatsApp (Evolution API), mantenha preenchido o Nome da Instancia. A API Key pode ficar no backend (EVOLUTION_API_KEY) ou no campo segredo desta conta.",
    });
    return;
  }

  const connection = await prisma.socialConnection.update({
    where: { id: request.params.id },
    data: {
      displayName: payload.displayName,
      loginIdentifier: nextLoginIdentifier,
      secretCipher: nextSecretCipher,
    },
  });

  response.json(mapConnection(connection));
});

app.post("/connections/:id/open-visual-auth", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const payload = openVisualAuthSchema.parse(request.body ?? {});
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  if (!isRootUser(authRequest) && connection.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Você não pode autenticar uma conta de outro usuário." });
    return;
  }

  if (connection.platform === "whatsapp") {
    const updatedConnection = await prisma.socialConnection.update({
      where: { id: request.params.id },
      data: {
        authStatus: "AUTH_IN_PROGRESS",
        authLaunchUrl: defaultAuthLaunchUrlForPlatform("whatsapp"),
        lastSeenAt: new Date(),
      },
    });

    await appendLog({
      companyId: updatedConnection.companyId,
      level: "INFO",
      message: `Fluxo de QR iniciado para ${updatedConnection.displayName}.`,
    });

    void requestWhatsappQr(updatedConnection.id, false).catch(async (error) => {
      await appendLog({
        companyId: updatedConnection.companyId,
        level: "ERROR",
        errorCode: "WHATSAPP_QR_REQUEST_FAILED",
        message:
          error instanceof Error && error.message ? error.message : "Falha ao iniciar a geracao do QR do WhatsApp.",
      });
    });

    response.json({
      connection: mapConnection(updatedConnection),
      launchUrl: updatedConnection.authLaunchUrl,
    });
    return;
  }

  let launchUrl: string;
  try {
    launchUrl = createInstagramOAuthLaunchUrl(connection.id, {
      returnToUrl: payload.returnToUrl ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INSTAGRAM_GRAPH_CONFIG_MISSING";
    response.status(400).json({
      error:
        message.startsWith("INSTAGRAM_GRAPH_CONFIG_MISSING:")
          ? `Instagram Graph API não configurada no backend: ${message.replace("INSTAGRAM_GRAPH_CONFIG_MISSING:", "")}.`
          : message,
    });
    return;
  }

  const updatedConnection = await prisma.socialConnection.update({
    where: { id: request.params.id },
    data: {
      authStatus: "AUTH_IN_PROGRESS",
      authLaunchUrl: launchUrl,
      lastSeenAt: new Date(),
    },
  });

  await appendLog({
    companyId: updatedConnection.companyId,
    level: "INFO",
    message: `Fluxo OAuth da Meta iniciado para ${updatedConnection.displayName}.`,
  });

  response.json({
    connection: mapConnection(updatedConnection),
    launchUrl: updatedConnection.authLaunchUrl,
  });
});

app.post("/connections/:id/regenerate-qr", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  if (!isRootUser(authRequest) && connection.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Você não pode gerar QR para uma conta de outro usuário." });
    return;
  }

  if (connection.platform !== "whatsapp") {
    response.status(400).json({ error: "Geracao de QR disponivel apenas para contas de WhatsApp." });
    return;
  }

  const updatedConnection = await prisma.socialConnection.update({
    where: { id: request.params.id },
    data: {
      authStatus: "AUTH_IN_PROGRESS",
      lastSeenAt: new Date(),
    },
  });

  void requestWhatsappQr(updatedConnection.id, true).catch(async (error) => {
    await appendLog({
      companyId: updatedConnection.companyId,
      level: "ERROR",
      errorCode: "WHATSAPP_QR_REQUEST_FAILED",
      message:
        error instanceof Error && error.message ? error.message : "Falha ao gerar um novo QR do WhatsApp.",
    });
  });

  await appendLog({
    companyId: updatedConnection.companyId,
    level: "WARN",
    message: `Novo QR solicitado para a conta ${updatedConnection.displayName}.`,
  });

  response.json(mapConnection(updatedConnection));
});

app.post("/connections/:id/dismiss-qr", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  if (!isRootUser(authRequest) && connection.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Você não pode encerrar QR de uma conta de outro usuário." });
    return;
  }

  if (connection.platform !== "whatsapp") {
    response.status(400).json({ error: "Fechamento de QR disponivel apenas para contas de WhatsApp." });
    return;
  }

  const updatedConnection = await prisma.socialConnection.update({
    where: { id: request.params.id },
    data: {
      authStatus: "AUTH_REQUIRED",
      lastSeenAt: null,
    },
  });

  await dismissWhatsappQr(updatedConnection.id);

  await appendLog({
    companyId: updatedConnection.companyId,
    level: "WARN",
    message: `Fluxo de QR fechado para a conta ${updatedConnection.displayName}.`,
  });

  response.json(mapConnection(updatedConnection));
});

app.post("/connections/:id/disconnect", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  if (!isRootUser(authRequest) && connection.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Você não pode desconectar conta de outro usuário." });
    return;
  }

  const updatedConnection = await prisma.socialConnection.update({
    where: { id: request.params.id },
    data: {
      authStatus: "AUTH_REQUIRED",
      secretCipher: connection.platform === "instagram" ? null : connection.secretCipher,
      lastAuthAt: connection.platform === "instagram" ? null : connection.lastAuthAt,
      authLaunchUrl: connection.platform === "instagram" ? null : connection.authLaunchUrl,
      lastSeenAt: null,
    },
  });

  await appendLog({
    companyId: updatedConnection.companyId,
    level: "WARN",
    message: `Conta ${updatedConnection.displayName} foi desconectada.`,
  });

  if (updatedConnection.platform === "whatsapp") {
    await disconnectWhatsappConnectionSession(updatedConnection.id);
  }

  response.json(mapConnection(updatedConnection));
});

app.delete("/connections/:id", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  if (!isRootUser(authRequest) && connection.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Você não pode excluir conta de outro usuário." });
    return;
  }

  if (connection.platform === "whatsapp") {
    try {
      await disconnectWhatsappConnectionSession(connection.id);
    } catch (error) {
      await appendLog({
        companyId: connection.companyId,
        level: "WARN",
        errorCode: "WHATSAPP_LOGOUT_ON_DELETE_FAILED",
        message:
          error instanceof Error && error.message
            ? `Falha ao desconectar instancia WhatsApp antes da exclusao da conta: ${error.message}`
            : "Falha ao desconectar instancia WhatsApp antes da exclusao da conta.",
      });
    }
  }

  await prisma.socialConnection.delete({
    where: { id: request.params.id },
  });

  await appendLog({
    companyId: connection.companyId,
    level: "WARN",
    message: `Conta ${connection.displayName} removida do painel.`,
  });

  response.status(204).send();
});

app.get("/companies", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const companies = await prisma.company.findMany({
    where: companyVisibilityWhere(authRequest),
    orderBy: { createdAt: "desc" },
  });
  response.json(companies);
});

app.post("/companies", async (request, response) => {
  const payload = createCompanySchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const billingAccess = await ensureBillingWritableAccess(authRequest);
  if (billingAccess && billingAccess.plan && billingAccess.usage.profilesUsed >= billingAccess.plan.maxProfiles) {
    response.status(409).json({
      error: `Seu plano atingiu o limite de ${billingAccess.plan.maxProfiles} perfil(is).`,
    });
    return;
  }

  const company = await prisma.company.create({
    data: {
      ...payload,
      createdByUserId: authRequest.adminUser!.id,
    },
  });
  response.status(201).json(company);
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

app.delete("/upload", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const query = deleteUploadQuerySchema.parse(request.query);

  const normalizedFileName = path.basename(query.filePath);
  const normalizedFilePath = `/uploads/${normalizedFileName}`;

  if (!query.filePath.startsWith("/uploads/") || normalizedFileName.length === 0) {
    response.status(400).json({ error: "filePath invalido. Use o caminho retornado pelo upload (/uploads/arquivo)." });
    return;
  }

  const candidateJobs = await prisma.job.findMany({
    select: {
      id: true,
      companyId: true,
      createdByUserId: true,
      status: true,
      filePath: true,
    },
  });

  const referencedJobs = candidateJobs.filter((job) => {
    const mediaBundle = decodeJobMediaBundleStorage(job.filePath);
    const mediaFiles = mediaBundle.files.length > 0
      ? mediaBundle.files
      : (job.filePath?.trim() ? [job.filePath.trim()] : []);
    return mediaFiles.includes(normalizedFilePath);
  });

  if (referencedJobs.length === 0) {
    response.status(404).json({ error: "Midia nao encontrada para exclusao." });
    return;
  }

  if (
    !isRootUser(authRequest) &&
    referencedJobs.some((job) => job.createdByUserId !== authRequest.adminUser?.id)
  ) {
    response.status(403).json({ error: "Voce nao pode excluir uma midia vinculada a postagens de outro usuario." });
    return;
  }

  const hasActiveSchedules = referencedJobs.some((job) =>
    job.status === "PENDING" || job.status === "WAITING_LOGIN" || job.status === "RUNNING",
  );

  if (hasActiveSchedules) {
    response.status(409).json({
      error: "Esta midia possui agendamentos ativos. Cancele ou conclua os agendamentos antes de excluir.",
    });
    return;
  }

  try {
    await unlink(resolveUploadFilePath(normalizedFilePath));
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  await Promise.all(
    referencedJobs.map(async (job) => {
      const mediaBundle = decodeJobMediaBundleStorage(job.filePath);
      const currentFiles = mediaBundle.files.length > 0
        ? mediaBundle.files
        : (job.filePath?.trim() ? [job.filePath.trim()] : []);
      const nextFiles = currentFiles.filter((entry) => entry !== normalizedFilePath);
      const nextCaptions = currentFiles.map((_, index) => mediaBundle.captions[index] ?? null)
        .filter((_, index) => currentFiles[index] !== normalizedFilePath);
      const nextFilePath = nextFiles.length > 0
        ? encodeJobMediaBundleStorage({
            files: nextFiles,
            sequential: mediaBundle.sequential && nextFiles.length > 1,
            captions: nextCaptions,
          })
        : "";

      await prisma.job.update({
        where: { id: job.id },
        data: {
          filePath: nextFilePath,
        },
      });
    }),
  );

  const companyIds = Array.from(new Set(referencedJobs.map((job) => job.companyId)));
  await Promise.all(
    companyIds.map((companyId) =>
      appendLog({
        companyId,
        level: "WARN",
        message: `Midia ${normalizedFileName} removida manualmente da pasta uploads.`,
      }),
    ),
  );

  response.status(204).send();
});

app.get("/jobs/instagram-location-suggestions", async (request, response) => {
  const payload = instagramLocationSuggestionsQuerySchema.parse(request.query);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  if (!isRootUser(authRequest) && !authRequest.adminUser?.id) {
    response.status(403).json({ error: "Sessão inválida para buscar localizações." });
    return;
  }

  const connection = await prisma.socialConnection.findUnique({
    where: { id: payload.connectionId },
    select: {
      id: true,
      companyId: true,
      createdByUserId: true,
      platform: true,
      authStatus: true,
      secretCipher: true,
    },
  });

  if (!connection || connection.platform !== "instagram") {
    response.status(404).json({ error: "Conta do Instagram não encontrada." });
    return;
  }

  if (!isRootUser(authRequest) && connection.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Você não pode buscar sugestões para conta de outro usuário." });
    return;
  }

  const queryVariants = buildInstagramLocationQueryVariants(payload.query);
  const pushUniqueError = (bucket: string[], error: unknown, fallbackCode: string) => {
    const message = error instanceof Error && error.message ? error.message : fallbackCode;
    if (!bucket.includes(message)) {
      bucket.push(message);
    }
  };

  const metaErrors: string[] = [];
  let metaItems: InstagramLocationSuggestion[] = [];

  for (const queryVariant of queryVariants) {
    try {
      const items = await withTimeout(
        searchInstagramLocationsForConnection({
          secretCipher: connection.secretCipher,
          query: queryVariant,
          limit: payload.limit,
        }),
        6_000,
        "INSTAGRAM_GRAPH_LOCATION_SEARCH_TIMEOUT",
      );
      metaItems = dedupeInstagramLocationSuggestions([...metaItems, ...items], payload.limit);
      if (metaItems.length > 0) {
        break;
      }
    } catch (error) {
      pushUniqueError(metaErrors, error, "INSTAGRAM_GRAPH_LOCATION_SEARCH_FAILED");
    }
  }

  const mergedItems = dedupeInstagramLocationSuggestions(metaItems, payload.limit);

  let warning: string | undefined;
  if (mergedItems.length === 0 && metaErrors.length > 0) {
    warning = "Não foi possível carregar sugestões agora. Você pode publicar sem localização.";
  }

  response.json({
    items: mergedItems,
    ...(warning ? { warning } : {}),
  });
});

app.get("/jobs/calendar", async (request, response) => {
  const payload = jobsCalendarQuerySchema.parse(request.query);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const timeZone = normalizeUserTimeZone(payload.timeZone ?? authRequest.adminUser?.timeZone ?? DEFAULT_USER_TIME_ZONE);
  const totalDays = getDaysInMonthForCalendar(payload.year, payload.month);
  const totalPages = Math.max(1, Math.ceil(totalDays / (payload.pageSize * 7)));
  const page = Math.min(payload.page, totalPages);
  const weekStartDay = (page - 1) * payload.pageSize * 7 + 1;
  const weekEndDay = Math.min(totalDays, weekStartDay + payload.pageSize * 7 - 1);
  const monthRangeStart = zonedDateTimeToUtc({
    year: payload.year,
    month: payload.month,
    day: 1,
    timeZone,
  });
  const monthRangeEnd = zonedDateTimeToUtc({
    ...shiftCalendarDate({ year: payload.year, month: payload.month, day: totalDays }, 1),
    timeZone,
  });
  const pageRangeStart = zonedDateTimeToUtc({
    year: payload.year,
    month: payload.month,
    day: weekStartDay,
    timeZone,
  });
  const pageRangeEnd = zonedDateTimeToUtc({
    ...shiftCalendarDate({ year: payload.year, month: payload.month, day: weekEndDay }, 1),
    timeZone,
  });
  const normalizedQuery = (payload.query || "").trim();
  const baseWhere = {
    ...jobVisibilityWhere(authRequest, payload.companyId),
    publicationState: "PUBLISHED",
  } satisfies Prisma.JobWhereInput;
  const searchWhere = normalizedQuery
    ? ({
        OR: [
          { title: { contains: normalizedQuery, mode: "insensitive" } },
          { caption: { contains: normalizedQuery, mode: "insensitive" } },
        ],
      } satisfies Prisma.JobWhereInput)
    : {};
  const monthWhere = {
    ...baseWhere,
    ...searchWhere,
    dataPostagem: {
      gte: monthRangeStart,
      lt: monthRangeEnd,
    },
  } satisfies Prisma.JobWhereInput;
  const pageWhere = {
    ...baseWhere,
    ...searchWhere,
    dataPostagem: {
      gte: pageRangeStart,
      lt: pageRangeEnd,
    },
  } satisfies Prisma.JobWhereInput;

  const [jobs, totalJobs] = await Promise.all([
    prisma.job.findMany({
      where: pageWhere,
      orderBy: [{ dataPostagem: "asc" }, { criadoEm: "asc" }],
    }),
    prisma.job.count({
      where: monthWhere,
    }),
  ]);

  response.json({
    year: payload.year,
    month: payload.month,
    page,
    pageSize: payload.pageSize,
    totalPages,
    totalDays,
    totalJobs,
    items: jobs.map(serializeJobForClient),
  });
});

app.get("/jobs/history-drafts", async (request, response) => {
  const payload = historyDraftsQuerySchema.parse(request.query);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const normalizedQuery = (payload.query || "").trim();
  const baseWhere = {
    ...jobVisibilityWhere(authRequest, payload.companyId),
    publicationState: "DRAFT",
  } satisfies Prisma.JobWhereInput;
  const searchWhere = normalizedQuery
    ? ({
        OR: [
          { title: { contains: normalizedQuery, mode: "insensitive" } },
          { caption: { contains: normalizedQuery, mode: "insensitive" } },
        ],
      } satisfies Prisma.JobWhereInput)
    : {};
  const where = {
    ...baseWhere,
    ...searchWhere,
  } satisfies Prisma.JobWhereInput;

  const total = await prisma.job.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / payload.pageSize));
  const page = Math.min(payload.page, totalPages);
  const items = await prisma.job.findMany({
    where,
    orderBy: [{ criadoEm: "desc" }],
    skip: (page - 1) * payload.pageSize,
    take: payload.pageSize,
  });

  response.json({
    page,
    pageSize: payload.pageSize,
    total,
    totalPages,
    items: items.map(serializeJobForClient),
  });
});

app.get("/jobs", async (request, response) => {
  const companyId = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  const jobs = await prisma.job.findMany({
    where: jobVisibilityWhere(authRequest, companyId, status),
    orderBy: { criadoEm: "desc" },
  });

  response.json(
    jobs.map(serializeJobForClient),
  );
});

app.post("/jobs", async (request, response) => {
  const payload = createJobSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const normalizedPublicationState = normalizePublicationState(payload.publicationState);
  await ensureMatchingConnection({
    request: authRequest,
    ...payload,
  });
  const billingAccess = await ensureBillingWritableAccess(authRequest);
  if (
    billingAccess &&
    normalizedPublicationState === "PUBLISHED" &&
    billingAccess.plan &&
    billingAccess.usage.postsUsedThisMonth >= billingAccess.plan.maxMonthlyPublications
  ) {
    response.status(409).json({
      error: `Seu plano atingiu o limite mensal de ${billingAccess.plan.maxMonthlyPublications} publicação(ões).`,
    });
    return;
  }
  const legacyFields = deriveLegacyJobFields(payload.publicationType);
  const filePath = ensureFilePathForPublication(
    payload.publicationType,
    payload.filePath,
    payload.filePaths,
    payload.fileCaptions,
    payload.sequential,
  );
  const resolvedLocation = await resolveAutomaticInstagramLocation({
    publicationType: payload.publicationType,
    socialConnectionId: payload.socialConnectionId,
    locationName: payload.locationName,
    locationId: payload.locationId,
  });
  const metadata = ensureInstagramMetadata(
    payload.publicationType,
    payload.caption,
    payload.fileCaptions,
    resolvedLocation.locationName,
    resolvedLocation.locationId,
  );
  const firstComment = normalizeFirstComment(payload.publicationType, payload.firstComment);
  const relinkOptions = await resolveWhatsappRelinkOptions({
    request: authRequest,
    publicationType: payload.publicationType,
    encodedFilePath: filePath,
    enabledValue: payload.whatsappRelinkEnabled,
    connectionIdsValue: payload.whatsappRelinkConnectionIds,
  });
  const whatsappBackgroundColor = normalizeWhatsappBackgroundColor(
    payload.whatsappBackgroundColor,
    payload.publicationType === "whatsapp_status_midia" || relinkOptions.enabled,
  );
  const normalizedTitle = normalizeJobTitle(payload.title);
  let scheduledAt = new Date();

  if (normalizedPublicationState === "PUBLISHED") {
    if (!payload.dataPostagem) {
      response.status(400).json({ error: "Data e horário são obrigatórios para publicação." });
      return;
    }
    scheduledAt = new Date(payload.dataPostagem);
    if (Number.isNaN(scheduledAt.getTime())) {
      response.status(400).json({ error: "Data/hora inválida." });
      return;
    }
  }

  const job = await prisma.job.create({
    data: {
      companyId: payload.companyId,
      createdByUserId: authRequest.adminUser!.id,
      socialConnectionId: payload.socialConnectionId,
      filePath,
      title: normalizedTitle,
      caption: metadata.caption,
      firstComment,
      whatsappBackgroundColor,
      whatsappRelinkEnabled: relinkOptions.enabled,
      whatsappRelinkConnectionIds: relinkOptions.enabled ? relinkOptions.connectionIds : Prisma.DbNull,
      whatsappRelinkDispatchedAt: null,
      instagramPermalink: null,
      locationName: metadata.locationName,
      publicationType: payload.publicationType,
      publicationState: normalizedPublicationState,
      postStory: legacyFields.postStory,
      postReel: legacyFields.postReel,
      postWhatsapp: legacyFields.postWhatsapp,
      modoWhatsapp: legacyFields.modoWhatsapp,
      dataPostagem: scheduledAt,
    },
  });

  await appendLog({
    companyId: payload.companyId,
    level: "INFO",
    message:
      normalizedPublicationState === "DRAFT"
        ? `Job ${job.id} salvo como rascunho com data e hora indefinida.`
        : `Job ${job.id} agendado para ${job.dataPostagem.toISOString()}.`,
  });
  response.status(201).json(job);
});

app.put("/jobs/:id", async (request, response) => {
  const payload = updateJobSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  await ensureMatchingConnection({
    request: authRequest,
    ...payload,
  });
  const legacyFields = deriveLegacyJobFields(payload.publicationType);
  const filePath = ensureFilePathForPublication(
    payload.publicationType,
    payload.filePath,
    payload.filePaths,
    payload.fileCaptions,
    payload.sequential,
  );
  const resolvedLocation = await resolveAutomaticInstagramLocation({
    publicationType: payload.publicationType,
    socialConnectionId: payload.socialConnectionId,
    locationName: payload.locationName,
    locationId: payload.locationId,
  });
  const metadata = ensureInstagramMetadata(
    payload.publicationType,
    payload.caption,
    payload.fileCaptions,
    resolvedLocation.locationName,
    resolvedLocation.locationId,
  );
  const firstComment = normalizeFirstComment(payload.publicationType, payload.firstComment);
  const normalizedTitle = normalizeJobTitle(payload.title);
  const existingJob = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!isRootUser(authRequest) && existingJob.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Voce nao pode editar esta postagem." });
    return;
  }

  const existingRelinkConnectionIds = parseStoredWhatsappRelinkConnectionIds(existingJob.whatsappRelinkConnectionIds);
  const relinkOptions = await resolveWhatsappRelinkOptions({
    request: authRequest,
    publicationType: payload.publicationType,
    encodedFilePath: filePath,
    enabledValue: payload.whatsappRelinkEnabled ?? existingJob.whatsappRelinkEnabled,
    connectionIdsValue: payload.whatsappRelinkConnectionIds ?? existingRelinkConnectionIds,
  });
  const whatsappBackgroundColor = normalizeWhatsappBackgroundColor(
    payload.whatsappBackgroundColor ?? existingJob.whatsappBackgroundColor,
    payload.publicationType === "whatsapp_status_midia" || relinkOptions.enabled,
  );

  const nextPublicationState = normalizePublicationState(payload.publicationState ?? existingJob.publicationState);
  const previousPublicationState = normalizePublicationState(existingJob.publicationState);
  const willConsumeMonthlyQuota = previousPublicationState !== "PUBLISHED" && nextPublicationState === "PUBLISHED";

  if (!isRootUser(authRequest) && willConsumeMonthlyQuota) {
    const billingAccess = await ensureBillingWritableAccess(authRequest);
    if (
      billingAccess &&
      billingAccess.plan &&
      billingAccess.usage.postsUsedThisMonth >= billingAccess.plan.maxMonthlyPublications
    ) {
      response.status(409).json({
        error: `Seu plano atingiu o limite mensal de ${billingAccess.plan.maxMonthlyPublications} publicação(ões).`,
      });
      return;
    }
  }

  let scheduledAt = new Date();
  if (nextPublicationState === "PUBLISHED") {
    if (!payload.dataPostagem) {
      response.status(400).json({ error: "Data e horário são obrigatórios para publicação." });
      return;
    }
    scheduledAt = new Date(payload.dataPostagem);
    if (Number.isNaN(scheduledAt.getTime())) {
      response.status(400).json({ error: "Data/hora inválida." });
      return;
    }
  }

  const job = await prisma.job.update({
    where: { id: request.params.id },
    data: {
      companyId: payload.companyId,
      socialConnectionId: payload.socialConnectionId,
      filePath,
      title: normalizedTitle,
      caption: metadata.caption,
      firstComment,
      whatsappBackgroundColor,
      whatsappRelinkEnabled: relinkOptions.enabled,
      whatsappRelinkConnectionIds: relinkOptions.enabled ? relinkOptions.connectionIds : Prisma.DbNull,
      whatsappRelinkDispatchedAt: null,
      instagramPermalink: null,
      locationName: metadata.locationName,
      publicationType: payload.publicationType,
      publicationState: nextPublicationState,
      postStory: legacyFields.postStory,
      postReel: legacyFields.postReel,
      postWhatsapp: legacyFields.postWhatsapp,
      modoWhatsapp: legacyFields.modoWhatsapp,
      dataPostagem: scheduledAt,
      status: "PENDING",
      tentativas: 0,
      startedAt: null,
      completedAt: null,
      lastError: null,
    },
  });

  await appendLog({
    companyId: payload.companyId,
    level: "INFO",
    message:
      nextPublicationState === "DRAFT"
        ? `Job ${job.id} foi editado e salvo como rascunho com data e hora indefinida.`
        : `Job ${job.id} foi editado e reagendado para ${job.dataPostagem.toISOString()}.`,
  });

  response.json(job);
});

app.post("/jobs/:id/retry", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!isRootUser(authRequest) && existingJob.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Voce nao pode reenfileirar esta postagem." });
    return;
  }

  if (normalizePublicationState(existingJob.publicationState) === "DRAFT") {
    response.status(409).json({ error: "Rascunhos não podem ser reenfileirados. Use 'Publicar'." });
    return;
  }

  const job = await prisma.job.update({
    where: { id: request.params.id },
    data: {
      status: "PENDING",
      tentativas: 0,
      startedAt: null,
      completedAt: null,
      lastError: null,
      dataPostagem: new Date(),
    },
  });

  await appendLog({
    companyId: existingJob.companyId,
    level: "INFO",
    message: `Job ${job.id} foi reenfileirado manualmente para tentativa imediata.`,
  });

  response.json(job);
});

app.post("/jobs/:id/reschedule-failed-media", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!isRootUser(authRequest) && existingJob.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Voce nao pode reagendar esta postagem." });
    return;
  }

  if (normalizePublicationState(existingJob.publicationState) === "DRAFT") {
    response.status(409).json({ error: "Rascunhos não podem ser reagendados por esta ação." });
    return;
  }

  if (existingJob.status !== "FAILED") {
    response.status(409).json({ error: "Apenas postagens com falha podem usar este reagendamento." });
    return;
  }

  if (!isInstagramPublication(normalizePublicationType(existingJob))) {
    response.status(409).json({ error: "Este reagendamento rápido está disponível apenas para falhas do Instagram." });
    return;
  }

  const mediaRetryBundle = buildReschedulableMediaBundleForJob(existingJob);
  const retryAt = new Date(Date.now() + FAILED_MEDIA_RESCHEDULE_DELAY_MS);

  const job = await prisma.job.create({
    data: {
      companyId: existingJob.companyId,
      createdByUserId: existingJob.createdByUserId,
      socialConnectionId: existingJob.socialConnectionId,
      filePath: mediaRetryBundle.encodedFilePath,
      title: existingJob.title,
      caption: existingJob.caption,
      firstComment: existingJob.firstComment,
      whatsappBackgroundColor: existingJob.whatsappBackgroundColor,
      whatsappRelinkEnabled: existingJob.whatsappRelinkEnabled,
      whatsappRelinkConnectionIds: existingJob.whatsappRelinkConnectionIds ?? Prisma.DbNull,
      whatsappRelinkDispatchedAt: null,
      instagramPermalink: null,
      locationName: existingJob.locationName,
      publicationType: existingJob.publicationType,
      publicationState: existingJob.publicationState,
      postStory: existingJob.postStory,
      postReel: existingJob.postReel,
      postWhatsapp: existingJob.postWhatsapp,
      modoWhatsapp: existingJob.modoWhatsapp,
      dataPostagem: retryAt,
      status: "PENDING",
      tentativas: 0,
      startedAt: null,
      completedAt: null,
      lastError: null,
    },
  });

  await appendLog({
    companyId: existingJob.companyId,
    level: "INFO",
    message:
      mediaRetryBundle.remainingOnly
        ? `Job ${existingJob.id} gerou novo job ${job.id} com ${mediaRetryBundle.mediaCount} mídia(s) restante(s), reagendado para ${retryAt.toISOString()}.`
        : `Job ${existingJob.id} gerou novo job ${job.id} reagendado para ${retryAt.toISOString()} com ${mediaRetryBundle.mediaCount} mídia(s).`,
  });

  response.json({
    job,
    scheduledAt: retryAt.toISOString(),
    mediaCount: mediaRetryBundle.mediaCount,
    totalCount: mediaRetryBundle.totalCount,
    remainingOnly: mediaRetryBundle.remainingOnly,
  });
});

app.post("/jobs/:id/cancel", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!isRootUser(authRequest) && existingJob.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Voce nao pode cancelar este agendamento." });
    return;
  }

  if (normalizePublicationState(existingJob.publicationState) === "DRAFT") {
    response.status(409).json({ error: "Rascunhos não possuem cancelamento de agendamento." });
    return;
  }

  if (existingJob.status === "CANCELED") {
    response.json(existingJob);
    return;
  }

  if (!canCancelScheduledJob(existingJob.status, existingJob.dataPostagem)) {
    response.status(409).json({
      error:
        existingJob.status === "FAILED" && existingJob.dataPostagem.getTime() <= Date.now()
          ? "Agendamento falhado com horario ja passado deve usar 'Tentar de novo'."
          : "Apenas agendamentos pendentes, aguardando login ou falhados podem ser cancelados.",
    });
    return;
  }

  const job = await prisma.job.update({
    where: { id: request.params.id },
    data: {
      status: "CANCELED",
      startedAt: null,
      completedAt: null,
      lastError: "Agendamento cancelado manualmente.",
    },
  });

  await appendLog({
    companyId: existingJob.companyId,
    level: "WARN",
    message: `Job ${job.id} foi cancelado manualmente.`,
  });

  response.json(job);
});

app.post("/jobs/:id/publish", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!isRootUser(authRequest) && existingJob.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Voce nao pode publicar este rascunho." });
    return;
  }

  if (normalizePublicationState(existingJob.publicationState) !== "DRAFT") {
    response.status(409).json({ error: "Apenas rascunhos podem ser publicados por esta ação." });
    return;
  }

  if (!isRootUser(authRequest)) {
    const billingAccess = await ensureBillingWritableAccess(authRequest);
    if (
      billingAccess &&
      billingAccess.plan &&
      billingAccess.usage.postsUsedThisMonth >= billingAccess.plan.maxMonthlyPublications
    ) {
      response.status(409).json({
        error: `Seu plano atingiu o limite mensal de ${billingAccess.plan.maxMonthlyPublications} publicação(ões).`,
      });
      return;
    }
  }

  const willRunImmediately = existingJob.dataPostagem.getTime() <= Date.now();
  const job = await prisma.job.update({
    where: { id: request.params.id },
    data: {
      publicationState: "PUBLISHED",
      status: "PENDING",
      startedAt: null,
      completedAt: null,
      lastError: null,
    },
  });

  await appendLog({
    companyId: existingJob.companyId,
    level: "INFO",
    message: willRunImmediately
      ? `Rascunho ${job.id} foi publicado e está com data no passado; será executado imediatamente.`
      : `Rascunho ${job.id} foi publicado para execução em ${job.dataPostagem.toISOString()}.`,
  });

  response.json({
    ...job,
    willRunImmediately,
  });
});

app.post("/jobs/:id/activate", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!isRootUser(authRequest) && existingJob.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Voce nao pode ativar este agendamento." });
    return;
  }

  if (existingJob.status !== "CANCELED") {
    response.status(409).json({
      error: "Somente agendamentos cancelados podem ser reativados.",
    });
    return;
  }

  const willRunImmediately = existingJob.dataPostagem.getTime() <= Date.now();
  const job = await prisma.job.update({
    where: { id: request.params.id },
    data: {
      status: "PENDING",
      startedAt: null,
      completedAt: null,
      lastError: null,
    },
  });

  await appendLog({
    companyId: existingJob.companyId,
    level: "INFO",
    message: willRunImmediately
      ? `Job ${job.id} foi reativado e esta com data no passado; sera executado imediatamente.`
      : `Job ${job.id} foi reativado para execucao em ${job.dataPostagem.toISOString()}.`,
  });

  response.json(job);
});

app.delete("/jobs/:id", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await prisma.job.findUnique({ where: { id: request.params.id } });

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!isRootUser(authRequest) && existingJob.createdByUserId !== authRequest.adminUser?.id) {
    response.status(403).json({ error: "Voce nao pode excluir esta postagem." });
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
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const where = jobVisibilityWhere(authRequest, companyId);

  const [jobs, connectedAccounts] = await Promise.all([
    prisma.job.findMany({ where, select: { status: true, publicationState: true } }),
    prisma.socialConnection.count({
      where: {
        ...connectionVisibilityWhere(authRequest, companyId),
        authStatus: {
          in: ["CONNECTED", "AUTH_IN_PROGRESS"],
        },
      },
    }),
  ]);

  const totals = {
    PENDING: 0,
    RUNNING: 0,
    SENT_UNCONFIRMED: 0,
    COMPLETED: 0,
    FAILED: 0,
    WAITING_LOGIN: 0,
    CANCELED: 0,
  };

  for (const job of jobs) {
    if (normalizePublicationState(job.publicationState) !== "PUBLISHED") {
      continue;
    }
    if (job.status in totals) {
      totals[job.status as keyof typeof totals] += 1;
    }
  }

  response.json({
    companyId: companyId ?? null,
    totals,
    agentsOnline: connectedAccounts,
    pendingJobs: totals.PENDING,
    failedJobs: totals.FAILED,
    completedJobs: totals.COMPLETED,
    canceledJobs: totals.CANCELED,
    instagramForcedLocationId: INSTAGRAM_FORCED_LOCATION_ID,
    instagramForcedLocationName: INSTAGRAM_FORCED_LOCATION_ID ? INSTAGRAM_FORCED_LOCATION_NAME : null,
  });
});

app.get("/billing/me", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const userId = authRequest.adminUser!.id;
  const monthBounds = currentMonthBounds(new Date());
  const stripePixAvailable = await resolveStripePixAvailability().catch(() => false);

  if (isRootUser(authRequest)) {
    const bestPlan = await getRootDisplayPlanForDisplay();
    response.json({
      status: "ACTIVE",
      billingModel: "MANUAL",
      cycle: null,
      isBlocked: false,
      blockMessage: null,
      startsAt: null,
      endsAt: null,
      trialEndsAt: null,
      plan: {
        id: bestPlan?.id ?? "root",
        code: bestPlan?.code ?? "ROOT",
        name: bestPlan?.name ?? "Root",
        isTrial: bestPlan?.isTrial ?? false,
        maxProfiles: bestPlan?.maxProfiles ?? 999999,
        maxConnections: bestPlan?.maxConnections ?? 999999,
        maxMonthlyPublications: bestPlan?.maxMonthlyPublications ?? 999999999,
      },
      usage: {
        profilesUsed: await prisma.company.count(),
        connectionsUsed: await prisma.socialConnection.count(),
        postsUsedThisMonth: await prisma.job.count({
          where: {
            publicationState: "PUBLISHED",
            criadoEm: {
              gte: monthBounds.start,
              lt: monthBounds.end,
            },
          },
        }),
      },
      canCancelStripeSubscription: false,
      stripeCancelAtPeriodEnd: false,
      stripePixAvailable,
    });
    return;
  }

  const billing = await resolveUserBillingAccess(userId);
  response.json({
    status: billing.status,
    billingModel: billing.billingModel,
    cycle: billing.cycle,
    isBlocked: billing.isBlocked,
    blockMessage: billing.blockMessage,
    startsAt: billing.startsAt,
    endsAt: billing.endsAt,
    trialEndsAt: billing.trialEndsAt,
    plan: billing.plan,
    usage: billing.usage,
    canCancelStripeSubscription:
      billing.billingModel === "STRIPE_SUBSCRIPTION" && !billing.stripeCancelAtPeriodEnd,
    stripeCancelAtPeriodEnd: billing.stripeCancelAtPeriodEnd,
    stripePixAvailable,
  });
});

app.get("/billing/plans", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const plans = await prisma.plan.findMany({
    where: isRootUser(authRequest) ? undefined : { isActive: true },
    orderBy: [{ isTrial: "desc" }, { createdAt: "asc" }],
  });

  const stripeProductIds = Array.from(
    new Set(
      plans
        .map((plan) => trimNullable(plan.stripeProductId))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const resolvedStripeByProductId = new Map<string, ResolvedStripePlanPriceIds>();
  if (stripeProductIds.length > 0 && STRIPE_SECRET_KEY) {
    try {
      const stripe = ensureStripeClient();
      const pricesResponse = await stripe.prices.list({
        active: true,
        limit: 100,
      });

      const pricesByProductId = new Map<string, Stripe.Price[]>();
      for (const price of pricesResponse.data) {
        if (typeof price.product !== "string") {
          continue;
        }
        if (!stripeProductIds.includes(price.product)) {
          continue;
        }
        const current = pricesByProductId.get(price.product) ?? [];
        current.push(price);
        pricesByProductId.set(price.product, current);
      }

      for (const stripeProductId of stripeProductIds) {
        const productPrices = pricesByProductId.get(stripeProductId) ?? [];
        resolvedStripeByProductId.set(stripeProductId, resolveStripePlanPriceIdsFromPriceList(productPrices));
      }
    } catch {
      // Se Stripe estiver indisponível, mantém os valores persistidos localmente.
    }
  }

  response.json(
    plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      isActive: plan.isActive,
      isTrial: plan.isTrial,
      maxProfiles: plan.maxProfiles,
      maxConnections: plan.maxConnections,
      maxMonthlyPublications: plan.maxMonthlyPublications,
      monthlyPriceCents: plan.monthlyPriceCents,
      yearlyPriceCents: plan.yearlyPriceCents,
      stripeProductId: plan.stripeProductId,
      stripeMonthlyPriceId: plan.stripeMonthlyPriceId,
      stripeYearlyPriceId: plan.stripeYearlyPriceId,
      stripePixMonthlyPriceId: plan.stripePixMonthlyPriceId,
      stripePixYearlyPriceId: plan.stripePixYearlyPriceId,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      ...(function resolveRuntimeStripeBinding() {
        const stripeProductId = trimNullable(plan.stripeProductId);
        if (!stripeProductId) {
          return {};
        }
        const resolved = resolvedStripeByProductId.get(stripeProductId);
        if (!resolved) {
          return {};
        }
        return {
          monthlyPriceCents: resolved.stripeMonthlyPriceCents,
          yearlyPriceCents: resolved.stripeYearlyPriceCents,
          stripeMonthlyPriceId: resolved.stripeMonthlyPriceId,
          stripeYearlyPriceId: resolved.stripeYearlyPriceId,
          stripePixMonthlyPriceId: resolved.stripePixMonthlyPriceId,
          stripePixYearlyPriceId: resolved.stripePixYearlyPriceId,
        };
      })(),
    })),
  );
});

app.get("/billing/stripe/catalog", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode listar catálogo Stripe." });
    return;
  }

  try {
    const stripe = ensureStripeClient();
    const [products, prices] = await Promise.all([
      stripe.products.list({ active: true, limit: 100 }),
      stripe.prices.list({ active: true, limit: 100 }),
    ]);

    const pricesByProductId = new Map<string, Stripe.Price[]>();
    for (const price of prices.data) {
      if (typeof price.product !== "string") {
        continue;
      }
      const current = pricesByProductId.get(price.product) ?? [];
      current.push(price);
      pricesByProductId.set(price.product, current);
    }

    const resolvedByProduct: Record<string, ResolvedStripePlanPriceIds> = {};
    for (const product of products.data) {
      const productPrices = pricesByProductId.get(product.id) ?? [];
      resolvedByProduct[product.id] = resolveStripePlanPriceIdsFromPriceList(productPrices);
    }

    response.json({
      products: products.data.map((item) => ({
        id: item.id,
        name: item.name,
        active: item.active,
        defaultPriceId: typeof item.default_price === "string" ? item.default_price : null,
      })),
      resolvedByProduct,
      pixAvailable: await resolveStripePixAvailability().catch(() => false),
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Falha ao carregar catálogo Stripe.",
    });
  }
});

app.post("/billing/checkout/start", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (isRootUser(authRequest)) {
    response.status(409).json({ error: "Conta root não usa checkout de cobrança." });
    return;
  }

  const payload = startStripeCheckoutSchema.parse(request.body);
  const user = authRequest.adminUser;
  if (!user) {
    response.status(401).json({ error: "Sessão inválida." });
    return;
  }

  const stripe = ensureStripeClient();
  const [currentBilling, plan, currentSubscription, userBillingSettings] = await Promise.all([
    resolveUserBillingAccess(user.id),
    prisma.plan.findUnique({
      where: { id: payload.planId },
      select: {
        id: true,
        name: true,
        isTrial: true,
        isActive: true,
        stripeProductId: true,
        stripeMonthlyPriceId: true,
        stripeYearlyPriceId: true,
        stripePixMonthlyPriceId: true,
        stripePixYearlyPriceId: true,
      },
    }),
    prisma.userPlanSubscription.findUnique({
      where: { userId: user.id },
      select: { id: true, stripeCustomerId: true },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        billingDiscountEnabled: true,
        billingDiscountPercent: true,
      },
    }),
  ]);

  const hasBlockedPlanToRecover =
    currentBilling.isBlocked &&
    currentBilling.plan &&
    currentBilling.billingModel === "STRIPE_SUBSCRIPTION" &&
    (currentBilling.cycle === "MONTHLY" || currentBilling.cycle === "YEARLY");

  const blockedCurrentPlan = hasBlockedPlanToRecover ? currentBilling.plan : null;

  if (
    blockedCurrentPlan &&
    (payload.planId !== blockedCurrentPlan.id ||
      payload.billingModel !== currentBilling.billingModel ||
      payload.cycle !== currentBilling.cycle)
  ) {
    response.status(409).json({
      error: `Quite primeiro o plano atual (${blockedCurrentPlan.name}) antes de trocar de plano ou cobrança.`,
    });
    return;
  }

  if (!plan) {
    response.status(404).json({ error: "Plano não encontrado." });
    return;
  }
  if (!plan.isActive) {
    response.status(409).json({ error: "Plano inativo no momento." });
    return;
  }
  if (plan.isTrial) {
    response.status(409).json({ error: "Plano trial não usa checkout Stripe." });
    return;
  }

  let resolvedPlanStripePrices: ResolvedStripePlanPriceIds = {
    stripeMonthlyPriceId: plan.stripeMonthlyPriceId,
    stripeYearlyPriceId: plan.stripeYearlyPriceId,
    stripePixMonthlyPriceId: plan.stripePixMonthlyPriceId,
    stripePixYearlyPriceId: plan.stripePixYearlyPriceId,
    stripeMonthlyPriceCents: null,
    stripeYearlyPriceCents: null,
    stripePixMonthlyPriceCents: null,
    stripePixYearlyPriceCents: null,
  };

  if (plan.stripeProductId) {
    try {
      resolvedPlanStripePrices = await resolveStripePlanPriceIdsFromProduct(plan.stripeProductId);
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error
            ? `Falha ao consultar preços do produto Stripe: ${error.message}`
            : "Falha ao consultar preços do produto Stripe.",
      });
      return;
    }

    const missingPriceKinds = listMissingRequiredStripePriceKinds(resolvedPlanStripePrices);
    if (missingPriceKinds.length > 0) {
      response.status(409).json({
        error: `Produto Stripe sem preços obrigatórios: ${missingPriceKinds.join(", ")}.`,
      });
      return;
    }
  }

  const selectedPriceId =
    payload.cycle === "MONTHLY"
      ? trimNullable(resolvedPlanStripePrices.stripeMonthlyPriceId)
      : trimNullable(resolvedPlanStripePrices.stripeYearlyPriceId);

  if (!selectedPriceId) {
    response.status(409).json({
      error: "Este plano ainda não possui Price ID de assinatura para o ciclo selecionado.",
    });
    return;
  }

  let stripeCustomerId = trimNullable(currentSubscription?.stripeCustomerId);
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      name: user.name || user.username,
      metadata: {
        socialupUserId: user.id,
        socialupUsername: user.username,
      },
    });
    stripeCustomerId = customer.id;

    if (currentSubscription) {
      await prisma.userPlanSubscription.update({
        where: { id: currentSubscription.id },
        data: { stripeCustomerId },
      });
    } else {
      await prisma.userPlanSubscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: "PAYMENT_REQUIRED",
          billingModel: "NONE",
          cycle: null,
          startsAt: new Date(),
          stripeCustomerId,
        },
      });
    }
  }

  const metadata = {
    socialupUserId: user.id,
    socialupPlanId: plan.id,
    socialupBillingModel: payload.billingModel,
    socialupCycle: payload.cycle,
    socialupPriceId: selectedPriceId,
    socialupDiscountPercent:
      userBillingSettings?.billingDiscountEnabled && userBillingSettings.billingDiscountPercent > 0
        ? String(userBillingSettings.billingDiscountPercent)
        : "0",
  };

  const effectiveDiscountPercent =
    userBillingSettings?.billingDiscountEnabled && userBillingSettings.billingDiscountPercent > 0
      ? userBillingSettings.billingDiscountPercent
      : 0;
  const discountCouponId =
    effectiveDiscountPercent > 0
      ? await createStripeCouponForUserDiscount({
          stripe,
          userId: user.id,
          username: user.username,
          percent: effectiveDiscountPercent,
        })
      : null;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    success_url: buildStripeCheckoutSuccessUrl(),
    cancel_url: buildStripeCheckoutCancelUrl(),
    line_items: [{ price: selectedPriceId, quantity: 1 }],
    allow_promotion_codes: true,
    metadata,
    subscription_data: { metadata },
    discounts: discountCouponId ? [{ coupon: discountCouponId }] : undefined,
    client_reference_id: user.id,
  });

  response.json({
    sessionId: session.id,
    url: session.url,
  });
});

app.post("/billing/checkout/confirm", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (isRootUser(authRequest)) {
    response.status(409).json({ error: "Conta root não usa checkout de cobrança." });
    return;
  }

  const payload = confirmStripeCheckoutSchema.parse(request.body);
  const user = authRequest.adminUser;
  if (!user) {
    response.status(401).json({ error: "Sessão inválida." });
    return;
  }

  const stripe = ensureStripeClient();
  const session = await stripe.checkout.sessions.retrieve(payload.sessionId, {
    expand: ["subscription", "payment_intent"],
  });

  const metadataUserId = trimNullable(session.metadata?.socialupUserId);
  const sessionUserId = trimNullable(session.client_reference_id);
  const resolvedUserId = metadataUserId || sessionUserId;

  if (!resolvedUserId || resolvedUserId !== user.id) {
    response.status(403).json({ error: "Sessão de checkout não pertence ao usuário autenticado." });
    return;
  }

  if (session.status !== "complete") {
    response.json({
      applied: false,
      status: session.status,
      message: "Checkout ainda não concluído. Aguarde a confirmação do Stripe.",
    });
    return;
  }

  const activation = await applyStripeCheckoutSessionActivation(session);
  if (!activation.applied) {
    response.status(409).json({ error: activation.message });
    return;
  }
  if (activation.userId !== user.id) {
    response.status(403).json({ error: "Sessão de checkout não pertence ao usuário autenticado." });
    return;
  }

  response.json({
    applied: true,
    status: "ACTIVE",
    billingModel: activation.billingModel,
    cycle: activation.cycle,
    message: activation.message,
  });
});

app.post("/billing/subscription/cancel", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (isRootUser(authRequest)) {
    response.status(409).json({ error: "Conta root não possui assinatura para cancelar." });
    return;
  }

  const user = authRequest.adminUser;
  if (!user) {
    response.status(401).json({ error: "Sessão inválida." });
    return;
  }

  const currentSubscription = await prisma.userPlanSubscription.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      status: true,
      billingModel: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
    },
  });

  if (!currentSubscription || currentSubscription.billingModel !== "STRIPE_SUBSCRIPTION") {
    response.status(409).json({ error: "Nenhuma assinatura recorrente ativa para cancelar." });
    return;
  }

  let stripeSubscriptionId = trimNullable(currentSubscription.stripeSubscriptionId);
  const stripeCustomerId = trimNullable(currentSubscription.stripeCustomerId);
  const stripe = ensureStripeClient();
  if (!stripeSubscriptionId && stripeCustomerId) {
    const resolvedSubscriptionId = await resolveStripeSubscriptionIdFromCustomer({
      stripe,
      stripeCustomerId,
    });

    if (resolvedSubscriptionId) {
      stripeSubscriptionId = resolvedSubscriptionId;
      await prisma.userPlanSubscription.update({
        where: { id: currentSubscription.id },
        data: { stripeSubscriptionId },
      });
    }
  }

  if (!stripeSubscriptionId) {
    response.status(409).json({ error: "Assinatura recorrente não encontrada no Stripe para cancelar." });
    return;
  }

  const stripeSubscriptionResponse = await stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
  const stripeSubscription = stripeSubscriptionResponse as unknown as Stripe.Subscription;

  const currentPeriodEndSeconds = (stripeSubscription.items?.data ?? []).reduce((maxValue, item) => {
    if (typeof item.current_period_end !== "number") {
      return maxValue;
    }
    return Math.max(maxValue, item.current_period_end);
  }, 0);
  const periodEnd = currentPeriodEndSeconds > 0 ? new Date(currentPeriodEndSeconds * 1000) : null;

  await prisma.userPlanSubscription.update({
    where: { id: currentSubscription.id },
    data: {
      endsAt: periodEnd ?? undefined,
      blockedReason: null,
      status: stripeSubscription.status === "active" ? "ACTIVE" : currentSubscription.status,
    },
  });

  await appendBillingAvisoSafely({
    userId: user.id,
    title: "Assinatura em cancelamento",
    kind: "PLAN_UPDATED",
    message: "Assinatura marcada para cancelamento no fim do ciclo atual.",
  });

  response.json({
    ok: true,
    endsAt: periodEnd?.toISOString() ?? null,
    message: "Assinatura marcada para cancelamento no fim do ciclo atual.",
  });
});

app.post("/billing/plans", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode cadastrar planos." });
    return;
  }

  const payload = createPlanSchema.parse(request.body);
  const normalizedCode = normalizePlanCode(payload.code);
  const normalizedDescription = trimNullable(payload.description);
  const normalizedStripeProductId = trimNullable(payload.stripeProductId);

  if (payload.isTrial) {
    if (normalizedStripeProductId) {
      response.status(400).json({
        error: "Plano trial não deve ter produto Stripe vinculado.",
      });
      return;
    }

    const existingTrial = await prisma.plan.findFirst({
      where: { isTrial: true },
      select: { id: true, name: true },
    });
    if (existingTrial) {
      response.status(409).json({
        error: `Já existe um plano trial (${existingTrial.name}). Deixe apenas um trial ativo no sistema.`,
      });
      return;
    }
  }

  if (!payload.isTrial && !normalizedStripeProductId) {
    response.status(400).json({
      error: "Plano pago exige produto Stripe vinculado.",
    });
    return;
  }

  let resolvedStripePriceIds: ResolvedStripePlanPriceIds = EMPTY_STRIPE_PLAN_PRICE_IDS;
  if (!payload.isTrial && normalizedStripeProductId) {
    try {
      resolvedStripePriceIds = await resolveStripePlanPriceIdsFromProduct(normalizedStripeProductId);
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error
            ? `Falha ao consultar preços do produto Stripe: ${error.message}`
            : "Falha ao consultar preços do produto Stripe.",
      });
      return;
    }

    const missingPriceKinds = listMissingRequiredStripePriceKinds(resolvedStripePriceIds);
    if (missingPriceKinds.length > 0) {
      response.status(409).json({
        error: `Produto Stripe sem preços obrigatórios: ${missingPriceKinds.join(", ")}.`,
      });
      return;
    }
  }

  const plan = await prisma.plan.create({
    data: {
      code: normalizedCode,
      name: payload.name.trim(),
      description: normalizedDescription,
      isActive: payload.isActive,
      isTrial: payload.isTrial,
      maxProfiles: payload.maxProfiles,
      maxConnections: payload.maxConnections,
      maxMonthlyPublications: payload.maxMonthlyPublications,
      monthlyPriceCents: payload.isTrial ? null : resolvedStripePriceIds.stripeMonthlyPriceCents,
      yearlyPriceCents: payload.isTrial ? null : resolvedStripePriceIds.stripeYearlyPriceCents,
      stripeProductId: normalizedStripeProductId,
      stripeMonthlyPriceId: resolvedStripePriceIds.stripeMonthlyPriceId,
      stripeYearlyPriceId: resolvedStripePriceIds.stripeYearlyPriceId,
      stripePixMonthlyPriceId: resolvedStripePriceIds.stripePixMonthlyPriceId,
      stripePixYearlyPriceId: resolvedStripePriceIds.stripePixYearlyPriceId,
    },
  });

  const billingSettings = await getBillingSettingsSnapshot();
  await syncTrialPlanLimitsFromSettings(billingSettings.autoTrialDays);

  response.status(201).json(plan);
});

app.put("/billing/plans/:id", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode editar planos." });
    return;
  }

  const payload = updatePlanSchema.parse(request.body);
  const existingPlan = await prisma.plan.findUnique({
    where: { id: request.params.id },
  });
  if (!existingPlan) {
    response.status(404).json({ error: "Plano não encontrado." });
    return;
  }

  const isTrial = payload.isTrial ?? existingPlan.isTrial;

  if (isTrial) {
    const existingTrial = await prisma.plan.findFirst({
      where: {
        isTrial: true,
        id: { not: existingPlan.id },
      },
      select: { id: true, name: true },
    });
    if (existingTrial) {
      response.status(409).json({
        error: `Já existe um plano trial (${existingTrial.name}). Deixe apenas um trial ativo no sistema.`,
      });
      return;
    }
  }

  const nextStripeProductId = isTrial
    ? null
    : payload.stripeProductId !== undefined
      ? trimNullable(payload.stripeProductId)
      : existingPlan.stripeProductId;

  if (!isTrial && !nextStripeProductId) {
    response.status(400).json({
      error: "Plano pago exige produto Stripe vinculado.",
    });
    return;
  }

  let nextStripePriceIds: ResolvedStripePlanPriceIds = isTrial
    ? EMPTY_STRIPE_PLAN_PRICE_IDS
    : {
        stripeMonthlyPriceId: existingPlan.stripeMonthlyPriceId,
        stripeYearlyPriceId: existingPlan.stripeYearlyPriceId,
        stripePixMonthlyPriceId: existingPlan.stripePixMonthlyPriceId,
        stripePixYearlyPriceId: existingPlan.stripePixYearlyPriceId,
        stripeMonthlyPriceCents: existingPlan.monthlyPriceCents,
        stripeYearlyPriceCents: existingPlan.yearlyPriceCents,
        stripePixMonthlyPriceCents: existingPlan.monthlyPriceCents,
        stripePixYearlyPriceCents: existingPlan.yearlyPriceCents,
      };

  if (!isTrial && nextStripeProductId) {
    try {
      nextStripePriceIds = await resolveStripePlanPriceIdsFromProduct(nextStripeProductId);
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error
            ? `Falha ao consultar preços do produto Stripe: ${error.message}`
            : "Falha ao consultar preços do produto Stripe.",
      });
      return;
    }

    const missingPriceKinds = listMissingRequiredStripePriceKinds(nextStripePriceIds);
    if (missingPriceKinds.length > 0) {
      response.status(409).json({
        error: `Produto Stripe sem preços obrigatórios: ${missingPriceKinds.join(", ")}.`,
      });
      return;
    }
  }

  if (!isTrial && !nextStripeProductId) {
    nextStripePriceIds = EMPTY_STRIPE_PLAN_PRICE_IDS;
  }

  const plan = await prisma.plan.update({
    where: { id: request.params.id },
    data: {
      code: payload.code ? normalizePlanCode(payload.code) : undefined,
      name: payload.name?.trim(),
      description: payload.description !== undefined ? trimNullable(payload.description) : undefined,
      isActive: payload.isActive,
      isTrial: payload.isTrial,
      maxProfiles: payload.maxProfiles,
      maxConnections: payload.maxConnections,
      maxMonthlyPublications: payload.maxMonthlyPublications,
      monthlyPriceCents: isTrial ? null : nextStripePriceIds.stripeMonthlyPriceCents,
      yearlyPriceCents: isTrial ? null : nextStripePriceIds.stripeYearlyPriceCents,
      stripeProductId: nextStripeProductId,
      stripeMonthlyPriceId: nextStripePriceIds.stripeMonthlyPriceId,
      stripeYearlyPriceId: nextStripePriceIds.stripeYearlyPriceId,
      stripePixMonthlyPriceId: nextStripePriceIds.stripePixMonthlyPriceId,
      stripePixYearlyPriceId: nextStripePriceIds.stripePixYearlyPriceId,
    },
  });

  const billingSettings = await getBillingSettingsSnapshot();
  await syncTrialPlanLimitsFromSettings(billingSettings.autoTrialDays);

  response.json(plan);
});

app.delete("/billing/plans/:id", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode excluir planos." });
    return;
  }

  const plan = await prisma.plan.findUnique({
    where: { id: request.params.id },
    select: {
      id: true,
      code: true,
      name: true,
    },
  });

  if (!plan) {
    response.status(404).json({ error: "Plano não encontrado." });
    return;
  }

  const linkedSubscriptions = await prisma.userPlanSubscription.count({
    where: {
      planId: plan.id,
    },
  });

  if (linkedSubscriptions > 0) {
    response.status(409).json({
      error: "Este plano possui usuários vinculados. Realoque os usuários antes de excluir.",
    });
    return;
  }

  await prisma.plan.delete({
    where: { id: plan.id },
  });

  response.status(204).send();
});

app.get("/billing/settings", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode visualizar configurações globais de billing." });
    return;
  }

  const settings = await getBillingSettingsSnapshot();
  response.json(settings);
});

app.put("/billing/settings", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode editar configurações globais de billing." });
    return;
  }

  const payload = updateBillingSettingsSchema.parse(request.body);
  const currentSettings = await getBillingSettingsSnapshot();
  const nextAutoTrialEnabled = payload.autoTrialEnabled ?? currentSettings.autoTrialEnabled;
  const nextAutoTrialDays = payload.autoTrialDays ?? currentSettings.autoTrialDays;
  const nextRootDisplayPlanId =
    payload.rootDisplayPlanId !== undefined
      ? trimNullable(payload.rootDisplayPlanId)
      : currentSettings.rootDisplayPlanId;

  if (nextRootDisplayPlanId) {
    const exists = await prisma.plan.findUnique({
      where: { id: nextRootDisplayPlanId },
      select: { id: true },
    });
    if (!exists) {
      response.status(404).json({ error: "Plano padrão do root não encontrado." });
      return;
    }
  }

  await Promise.all([
    upsertBillingSetting(BILLING_SETTING_AUTO_TRIAL_ENABLED, nextAutoTrialEnabled ? "true" : "false"),
    upsertBillingSetting(BILLING_SETTING_AUTO_TRIAL_DAYS, String(nextAutoTrialDays)),
    upsertBillingSetting(BILLING_SETTING_ROOT_DISPLAY_PLAN_ID, nextRootDisplayPlanId ?? ""),
  ]);

  await syncTrialPlanLimitsFromSettings(nextAutoTrialDays);

  response.json({
    autoTrialEnabled: nextAutoTrialEnabled,
    autoTrialDays: nextAutoTrialDays,
    rootDisplayPlanId: nextRootDisplayPlanId,
  });
});

app.get("/billing/user-discounts", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode listar descontos por usuário." });
    return;
  }

  const query = billingUserDiscountListQuerySchema.parse({
    page: request.query.page,
    pageSize: request.query.pageSize,
    query: request.query.query,
  });
  const searchText = query.query.trim();

  const where = {
    username: { not: "root" },
    ...(searchText
      ? {
          OR: [
            { name: { contains: searchText, mode: "insensitive" as const } },
            { username: { contains: searchText, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        createdAt: true,
        billingDiscountEnabled: true,
        billingDiscountPercent: true,
        subscription: {
          select: {
            status: true,
            billingModel: true,
            cycle: true,
            plan: {
              select: {
                name: true,
                code: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  response.json({
    items: users.map((user) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      billingDiscountEnabled: user.billingDiscountEnabled,
      billingDiscountPercent: user.billingDiscountPercent,
      billingStatus: user.subscription?.status ?? "PAYMENT_REQUIRED",
      billingModel: user.subscription?.billingModel ?? "NONE",
      billingCycle: user.subscription?.cycle ?? null,
      billingPlanName: user.subscription?.plan?.name ?? null,
      billingPlanCode: user.subscription?.plan?.code ?? null,
    })),
    page: Math.min(query.page, totalPages),
    pageSize: query.pageSize,
    total,
    totalPages,
  });
});

app.put("/billing/user-discounts/:userId", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode alterar desconto por usuário." });
    return;
  }

  const userId = (request.params.userId || "").trim();
  if (!userId) {
    response.status(400).json({ error: "Usuário inválido para atualização do desconto." });
    return;
  }

  const payload = updateBillingUserDiscountSchema.parse(request.body);
  if (payload.enabled && payload.percent <= 0) {
    response.status(400).json({ error: "Informe um percentual maior que zero para ativar desconto." });
    return;
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      billingDiscountEnabled: true,
      billingDiscountPercent: true,
      subscription: {
        select: {
          id: true,
          billingModel: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
        },
      },
    },
  });

  if (!targetUser) {
    response.status(404).json({ error: "Usuário não encontrado." });
    return;
  }

  if (targetUser.username === "root") {
    response.status(409).json({ error: "Desconto individual não é aplicável para a conta root." });
    return;
  }

  const nextDiscountPercent = payload.enabled ? payload.percent : 0;
  await prisma.user.update({
    where: { id: targetUser.id },
    data: {
      billingDiscountEnabled: payload.enabled,
      billingDiscountPercent: nextDiscountPercent,
    },
  });

  let stripeSyncWarning: string | null = null;
  if (STRIPE_SECRET_KEY && targetUser.subscription?.billingModel === "STRIPE_SUBSCRIPTION") {
    try {
      const stripe = ensureStripeClient();
      let stripeSubscriptionId = trimNullable(targetUser.subscription.stripeSubscriptionId);
      const stripeCustomerId = trimNullable(targetUser.subscription.stripeCustomerId);
      if (!stripeSubscriptionId && stripeCustomerId) {
        stripeSubscriptionId = await resolveStripeSubscriptionIdFromCustomer({
          stripe,
          stripeCustomerId,
        });
        if (stripeSubscriptionId) {
          await prisma.userPlanSubscription.update({
            where: { id: targetUser.subscription.id },
            data: { stripeSubscriptionId },
          });
        }
      }

      if (stripeSubscriptionId) {
        if (payload.enabled && nextDiscountPercent > 0) {
          const couponId = await createStripeCouponForUserDiscount({
            stripe,
            userId: targetUser.id,
            username: targetUser.username,
            percent: nextDiscountPercent,
          });
          if (couponId) {
            await stripe.subscriptions.update(stripeSubscriptionId, {
              discounts: [{ coupon: couponId }],
            });
          }
        } else {
          await stripe.subscriptions.update(stripeSubscriptionId, {
            discounts: [],
          });
        }
      }
    } catch (error) {
      stripeSyncWarning =
        error instanceof Error
          ? `Desconto salvo, mas houve falha ao sincronizar assinatura ativa no Stripe: ${error.message}`
          : "Desconto salvo, mas houve falha ao sincronizar assinatura ativa no Stripe.";
    }
  }

  await appendBillingAvisoSafely({
    userId: targetUser.id,
    kind: "PLAN_UPDATED",
    title: payload.enabled ? "Desconto ativado" : "Desconto desativado",
    message: payload.enabled
      ? `Seu desconto individual de ${nextDiscountPercent}% está ativo para as próximas cobranças.`
      : "Seu desconto individual foi removido.",
  });

  response.json({
    userId: targetUser.id,
    billingDiscountEnabled: payload.enabled,
    billingDiscountPercent: nextDiscountPercent,
    stripeSyncWarning,
  });
});

app.post("/billing/assign-user-plan", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode alterar plano de usuários." });
    return;
  }

  const payload = assignUserPlanSchema.parse(request.body);
  const [targetUser, plan] = await Promise.all([
    prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true },
    }),
    prisma.plan.findUnique({
      where: { id: payload.planId },
      select: { id: true, isTrial: true, isActive: true },
    }),
  ]);

  if (!targetUser) {
    response.status(404).json({ error: "Usuário não encontrado." });
    return;
  }

  if (!plan) {
    response.status(404).json({ error: "Plano não encontrado." });
    return;
  }

  if (!plan.isActive) {
    response.status(409).json({ error: "Não é possível vincular usuário a plano inativo." });
    return;
  }

  const now = new Date();
  const subscription = await prisma.userPlanSubscription.upsert({
    where: { userId: payload.userId },
    update: {
      planId: payload.planId,
      status: payload.status,
      billingModel: payload.billingModel,
      cycle: payload.cycle ?? null,
      startsAt: now,
      endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
      trialEndsAt:
        payload.billingModel === "TRIAL"
          ? (payload.endsAt ? new Date(payload.endsAt) : null)
          : null,
      blockedReason: payload.status === "BLOCKED" ? "Bloqueado manualmente por root." : null,
    },
    create: {
      userId: payload.userId,
      planId: payload.planId,
      status: payload.status,
      billingModel: payload.billingModel,
      cycle: payload.cycle ?? null,
      startsAt: now,
      endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
      trialEndsAt:
        payload.billingModel === "TRIAL"
          ? (payload.endsAt ? new Date(payload.endsAt) : null)
          : null,
      blockedReason: payload.status === "BLOCKED" ? "Bloqueado manualmente por root." : null,
    },
  });

  response.json(subscription);
});

app.get("/logs", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.json([]);
    return;
  }

  const companyId = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
  const logs = await prisma.agentLog.findMany({
    where: {
      companyId: companyId ?? undefined,
      level: {
        in: ["WARN", "ERROR"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  response.json(
    logs.map((log) => ({
      id: log.id,
      companyId: log.companyId,
      level: log.level,
      errorCode: log.errorCode,
      message: log.message,
      screenshotPath: log.screenshotPath,
      createdAt: log.createdAt,
    })),
  );
});

app.get("/avisos/unread-count", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  const count = await prisma.aviso.count({
    where: {
      userId: authRequest.adminUser!.id,
      readAt: null,
    },
  });

  response.json({ count });
});

app.get("/avisos/recent", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const query = avisoRecentQuerySchema.parse(request.query);

  const [items, unreadCount] = await Promise.all([
    prisma.aviso.findMany({
      where: {
        userId: authRequest.adminUser!.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: query.limit,
    }),
    prisma.aviso.count({
      where: {
        userId: authRequest.adminUser!.id,
        readAt: null,
      },
    }),
  ]);

  response.json({
    items: items.map((aviso) => mapAviso(aviso)),
    unreadCount,
  });
});

app.post("/avisos/mark-all-read", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const now = new Date();
  const result = await prisma.aviso.updateMany({
    where: {
      userId: authRequest.adminUser!.id,
      readAt: null,
    },
    data: {
      readAt: now,
    },
  });

  response.json({ updated: result.count });
});

app.get("/avisos", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const query = avisoPaginationQuerySchema.parse(request.query);
  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await Promise.all([
    prisma.aviso.findMany({
      where: {
        userId: authRequest.adminUser!.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: query.pageSize,
    }),
    prisma.aviso.count({
      where: {
        userId: authRequest.adminUser!.id,
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  response.json({
    items: items.map((aviso) => mapAviso(aviso)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages,
  });
});

app.post("/avisos/broadcast", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas o usuario root pode cadastrar avisos globais." });
    return;
  }

  const payload = createBroadcastAvisoSchema.parse(request.body);

  const recipients = await prisma.user.findMany({
    select: {
      id: true,
    },
  });

  if (recipients.length === 0) {
    response.status(201).json({ created: 0 });
    return;
  }

  await prisma.aviso.createMany({
    data: recipients.map((recipient) => ({
      userId: recipient.id,
      createdByUserId: authRequest.adminUser!.id,
      kind: "SYSTEM_BROADCAST",
      title: payload.title,
      message: payload.message,
    })),
  });

  response.status(201).json({ created: recipients.length });
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

let server: ReturnType<typeof app.listen> | null = null;

async function bootBackend(): Promise<void> {
  await ensureBillingBootstrap();

  startServerInstagramJobWorker();
  startInstagramTokenKeepAliveWorker();
  startServerWhatsappJobWorker();
  void startRabbitJobExecutionConsumer().catch((error) => {
    console.error("Failed to start RabbitMQ job consumer", error);
  });

  server = app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

void bootBackend().catch((error) => {
  console.error("Failed to boot backend", error);
  process.exit(1);
});

let shuttingDown = false;
async function shutdownGracefully(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down backend...`);

  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  }

  await Promise.allSettled([closeRabbitMqInfra(), closeRedisInfra()]);
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdownGracefully("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdownGracefully("SIGTERM");
});
