import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { appendFile, mkdir, unlink } from "node:fs/promises";
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
  consumeThreadsOAuthState,
  createThreadsOAuthLaunchUrl,
  exchangeThreadsOAuthCodeForConnection,
  isThreadsLoginRequiredErrorMessage,
  refreshThreadsAccessTokenForConnection,
  resolveThreadsConnectionRuntimeMetadata,
} from "./threads-graph-api.js";
import {
  closeRabbitMqInfra,
  enqueueJobExecutionMessage,
  startJobExecutionConsumer,
  type JobExecutionPlatform,
  type JobExecutionQueueMessage,
} from "./infra-rabbitmq.js";
import { acquireDistributedLock, isDistributedLockHeld, closeRedisInfra } from "./infra-redis.js";
import {
  createPostForMeWebhook,
  createPostForMeSocialAccountAuthUrl,
  createPostForMeSocialPost,
  disconnectPostForMeSocialAccount,
  isPostForMeManagedPlatform,
  listPostForMeSocialAccountFeed,
  listPostForMeSocialAccounts,
  listPostForMeSocialPostResults,
  listPostForMeSocialPosts,
  type PostForMePlacement,
  type PostForMePlatform,
  type PostForMeSocialAccountFeedRecord,
  type PostForMeSocialAccountRecord,
  type PostForMeSocialPostResultRecord,
} from "./post-for-me.js";
import { META_LOCATION_CATALOG, type MetaLocationCatalogEntry } from "./meta-location-catalog.js";
import { prisma, withPrismaConnectionRetry } from "./prisma.js";
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
const runtimeLogsDir = path.resolve(__dirname, "../../runtime-logs");
const agentEventLogFilePath = path.join(runtimeLogsDir, "agent-events.jsonl");
const deliveryEventLogFilePath = path.join(runtimeLogsDir, "delivery-events.jsonl");
const INSTAGRAM_GRAPH_PUBLIC_BASE_URL = (process.env.INSTAGRAM_GRAPH_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const OAUTH_PUBLIC_BASE_URL = (process.env.PUBLIC_OAUTH_BASE_URL || INSTAGRAM_GRAPH_PUBLIC_BASE_URL)
  .trim()
  .replace(/\/+$/, "");
const INSTAGRAM_IMAGE_MAX_SIZE_BYTES = 8 * 1024 * 1024;
const INSTAGRAM_POST_ASPECT_RATIO_MIN = 4 / 5;
const INSTAGRAM_POST_ASPECT_RATIO_MAX = 1.91;
const META_LOCATION_STORAGE_PREFIX = "__IGLOC__";
const JOB_MEDIA_BUNDLE_STORAGE_PREFIX = "__JOB_MEDIA_BUNDLE__";
const INSTAGRAM_MULTI_MEDIA_MAX_FILES = 10;
const THREADS_MULTI_MEDIA_MAX_FILES = 20;
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
const LIVE_EVENTS_HEARTBEAT_INTERVAL_MS = 20_000;
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
const IMMUTABLE_PUBLICATION_HISTORY_STATUSES = new Set([
  "COMPLETED",
  "SENT_UNCONFIRMED",
  "FAILED",
  "WAITING_LOGIN",
  "CANCELED",
]);
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
const POST_FOR_ME_WHATSAPP_RELINK_LOCK_MS = parseEnvPositiveInt(
  process.env.POST_FOR_ME_WHATSAPP_RELINK_LOCK_MS,
  60_000,
);
const POST_FOR_ME_WHATSAPP_RELINK_MAX_WAIT_MS = parseEnvPositiveInt(
  process.env.POST_FOR_ME_WHATSAPP_RELINK_MAX_WAIT_MS,
  45_000,
);
const POST_FOR_ME_WHATSAPP_RELINK_POLL_INTERVAL_MS = parseEnvPositiveInt(
  process.env.POST_FOR_ME_WHATSAPP_RELINK_POLL_INTERVAL_MS,
  1_500,
);
const POST_FOR_ME_WHATSAPP_RELINK_WORKER_INTERVAL_MS = parseEnvPositiveInt(
  process.env.POST_FOR_ME_WHATSAPP_RELINK_WORKER_INTERVAL_MS,
  2_000,
);
const POST_FOR_ME_WHATSAPP_RELINK_BATCH_SIZE = parseEnvPositiveInt(
  process.env.POST_FOR_ME_WHATSAPP_RELINK_BATCH_SIZE,
  10,
);
const POST_FOR_ME_AMBIGUOUS_FAILURE_MAX_WAIT_MS = parseEnvPositiveInt(
  process.env.POST_FOR_ME_AMBIGUOUS_FAILURE_MAX_WAIT_MS,
  90_000,
);
const POST_FOR_ME_REQUIRED_CAPTION_FALLBACK = "\u2060";
const JOB_DISPATCH_INTERVAL_MS = parseEnvPositiveInt(process.env.JOB_DISPATCH_INTERVAL_MS, 10_000);
const JOB_DISPATCH_BATCH_SIZE = parseEnvPositiveInt(process.env.JOB_DISPATCH_BATCH_SIZE, 10);
const JOB_CONSUMER_CONNECTION_LOCK_MS = parseEnvPositiveInt(process.env.JOB_CONSUMER_CONNECTION_LOCK_MS, 15 * 60 * 1000);
const RABBITMQ_CONSUMER_RETRY_DELAY_MS = parseEnvPositiveInt(process.env.RABBITMQ_CONSUMER_RETRY_DELAY_MS, 10_000);
const DEFAULT_USER_TIME_ZONE = "America/Sao_Paulo";
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const STRIPE_WEBHOOK_PATH = "/billing/stripe/webhook";
const POST_FOR_ME_WEBHOOK_SECRET = (process.env.POST_FOR_ME_WEBHOOK_SECRET || "").trim();
const POST_FOR_ME_WEBHOOK_PATH = "/integrations/post-for-me/webhook";
const POST_FOR_ME_WEBHOOK_PUBLIC_BASE_URL = (process.env.POST_FOR_ME_WEBHOOK_PUBLIC_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const STRIPE_CHECKOUT_SUCCESS_URL = (process.env.STRIPE_CHECKOUT_SUCCESS_URL || "").trim();
const STRIPE_CHECKOUT_CANCEL_URL = (process.env.STRIPE_CHECKOUT_CANCEL_URL || "").trim();
const BILLING_SETTING_AUTO_TRIAL_ENABLED = "billing.autoTrialEnabled";
const BILLING_SETTING_AUTO_TRIAL_DAYS = "billing.autoTrialDays";
const BILLING_SETTING_ROOT_DISPLAY_PLAN_ID = "billing.rootDisplayPlanId";
const BILLING_SETTING_POST_FOR_ME_WEBHOOK_ID = "postForMe.webhookId";
const BILLING_SETTING_POST_FOR_ME_WEBHOOK_URL = "postForMe.webhookUrl";
const BILLING_SETTING_POST_FOR_ME_WEBHOOK_SECRET = "postForMe.webhookSecret";
const BILLING_TRIAL_PLAN_CODE = "FREE_TRIAL";
const BILLING_TRIAL_REFERENCE_DAYS = 30;
const DEFAULT_AUTO_TRIAL_ENABLED = true;
const DEFAULT_AUTO_TRIAL_DAYS = 10;
const POST_FOR_ME_ACCOUNT_WEBHOOK_EVENT_TYPES = ["social.account.created", "social.account.updated"] as const;
const POST_FOR_ME_RENEWAL_AVISO_DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type DefaultPlanSeed = {
  code: string;
  name: string;
  description: string;
  isTrial: boolean;
  maxProfiles: number;
  workspaceLimit: number;
  agencyBonusWorkspaceLimit: number;
  maxConnections: number;
  maxMonthlyPublications: number;
  monthlyPriceCents: number | null;
  yearlyPriceCents: number | null;
  isPublic?: boolean;
  displayOrder?: number;
};

const DEFAULT_BILLING_TRIAL_PLAN: DefaultPlanSeed = {
  code: "FREE_TRIAL",
  name: "Free Trial",
  description: "Teste por 10 dias com limites reduzidos.",
  isTrial: true,
  maxProfiles: 1,
  workspaceLimit: 1,
  agencyBonusWorkspaceLimit: 0,
  maxConnections: 2,
  maxMonthlyPublications: 30,
  monthlyPriceCents: null,
  yearlyPriceCents: null,
  isPublic: false,
  displayOrder: 0,
};

const WORKSPACE_KIND_VALUES = ["CLIENT", "AGENCY_BONUS"] as const;
const WORKSPACE_STATUS_VALUES = ["ACTIVE", "INACTIVE"] as const;
const WORKSPACE_MEMBER_ROLE_VALUES = ["CENTRAL", "CLIENT", "AGENCY"] as const;
type WorkspaceKind = (typeof WORKSPACE_KIND_VALUES)[number];
type WorkspaceStatus = (typeof WORKSPACE_STATUS_VALUES)[number];
type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLE_VALUES)[number];

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseUnknownString(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
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

function resolveScheduledAtFromPayload(input: {
  dataPostagem?: string | null;
  scheduledDateLocal?: string | null;
  scheduledTimeLocal?: string | null;
  timeZone?: string | null;
  fallbackTimeZone?: string | null;
}): Date | null {
  const scheduledDateLocal = (input.scheduledDateLocal || "").trim();
  const scheduledTimeLocal = (input.scheduledTimeLocal || "").trim();

  if (scheduledDateLocal && scheduledTimeLocal) {
    const [yearRaw, monthRaw, dayRaw] = scheduledDateLocal.split("-").map((part) => Number.parseInt(part, 10));
    const [hourRaw, minuteRaw] = scheduledTimeLocal.split(":").map((part) => Number.parseInt(part, 10));

    if (
      !Number.isFinite(yearRaw) ||
      !Number.isFinite(monthRaw) ||
      !Number.isFinite(dayRaw) ||
      !Number.isFinite(hourRaw) ||
      !Number.isFinite(minuteRaw)
    ) {
      return null;
    }

    const timeZone = normalizeUserTimeZone(input.timeZone ?? input.fallbackTimeZone ?? DEFAULT_USER_TIME_ZONE);
    const resolved = zonedDateTimeToUtc({
      year: yearRaw,
      month: monthRaw,
      day: dayRaw,
      hour: hourRaw,
      minute: minuteRaw,
      timeZone,
    });

    return Number.isNaN(resolved.getTime()) ? null : resolved;
  }

  if (!input.dataPostagem) {
    return null;
  }

  const scheduledAt = new Date(input.dataPostagem);
  return Number.isNaN(scheduledAt.getTime()) ? null : scheduledAt;
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

const JOB_LOCATION_METADATA_PREFIX = "__jobmeta__:";

function encodeMetaLocationStorage(
  locationName: string | null,
  locationId: string | null,
  schedulerGroupId?: string | null,
): string | null {
  const normalizedName = locationName?.trim() || "";
  const normalizedGroupId = schedulerGroupId?.trim() || "";
  if (normalizedGroupId) {
    const payload = {
      locationName: normalizedName || null,
      locationId: locationId?.trim() || null,
      schedulerGroupId: normalizedGroupId,
    };
    return `${JOB_LOCATION_METADATA_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  }
  if (!normalizedName) {
    return null;
  }

  const normalizedId = locationId?.trim() || "";
  if (!normalizedId) {
    return normalizedName;
  }

  return `${META_LOCATION_STORAGE_PREFIX}${normalizedId}::${normalizedName}`;
}

function decodeMetaLocationStorage(
  input: string | null | undefined,
): { locationName: string | null; locationId: string | null; schedulerGroupId: string | null } {
  const raw = input?.trim() || "";
  if (!raw) {
    return {
      locationName: null,
      locationId: null,
      schedulerGroupId: null,
    };
  }

  if (raw.startsWith(JOB_LOCATION_METADATA_PREFIX)) {
    const encoded = raw.slice(JOB_LOCATION_METADATA_PREFIX.length).trim();
    if (!encoded) {
      return {
        locationName: null,
        locationId: null,
        schedulerGroupId: null,
      };
    }

    try {
      const decoded = Buffer.from(encoded, "base64url").toString("utf8");
      const parsed = JSON.parse(decoded) as {
        locationName?: unknown;
        locationId?: unknown;
        schedulerGroupId?: unknown;
      };
      return {
        locationName: typeof parsed.locationName === "string" ? parsed.locationName.trim() || null : null,
        locationId: typeof parsed.locationId === "string" ? parsed.locationId.trim() || null : null,
        schedulerGroupId:
          typeof parsed.schedulerGroupId === "string" ? parsed.schedulerGroupId.trim() || null : null,
      };
    } catch {
      return {
        locationName: null,
        locationId: null,
        schedulerGroupId: null,
      };
    }
  }

  if (!raw.startsWith(META_LOCATION_STORAGE_PREFIX)) {
    return {
      locationName: raw,
      locationId: null,
      schedulerGroupId: null,
    };
  }

  const encoded = raw.slice(META_LOCATION_STORAGE_PREFIX.length);
  const separatorIndex = encoded.indexOf("::");
  if (separatorIndex <= 0) {
    return {
      locationName: raw,
      locationId: null,
      schedulerGroupId: null,
    };
  }

  const locationId = encoded.slice(0, separatorIndex).trim();
  const locationName = encoded.slice(separatorIndex + 2).trim();

  if (!locationId || !locationName) {
    return {
      locationName: raw,
      locationId: null,
      schedulerGroupId: null,
    };
  }

  return {
    locationName,
    locationId,
    schedulerGroupId: null,
  };
}

function encodeInstagramLocationStorage(
  locationName: string | null,
  locationId: string | null,
  schedulerGroupId?: string | null,
): string | null {
  return encodeMetaLocationStorage(locationName, locationId, schedulerGroupId);
}

function decodeInstagramLocationStorage(input: string | null | undefined): { locationName: string | null; locationId: string | null } {
  const decoded = decodeMetaLocationStorage(input);
  return {
    locationName: decoded.locationName,
    locationId: decoded.locationId,
  };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function metaLocationTypeLabel(type: MetaLocationCatalogEntry["type"]): string {
  return type === "state" ? "Estado" : "Local";
}

function buildMetaLocationSuggestionSubtitle(entry: MetaLocationCatalogEntry): string {
  if (entry.type === "state" && entry.stateCode) {
    return `Estado · ${entry.stateCode}`;
  }
  return metaLocationTypeLabel(entry.type);
}

function searchMetaLocationCatalog(query: string, limit: number): Array<{
  id: string;
  name: string;
  subtitle: string;
  type: MetaLocationCatalogEntry["type"];
}> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const scored = META_LOCATION_CATALOG.map((entry) => {
    const haystack = normalizeSearchText(
      [entry.name, entry.stateCode ?? "", metaLocationTypeLabel(entry.type)].join(" "),
    );
    if (!haystack.includes(normalizedQuery)) {
      return null;
    }

    const startsWith = haystack.startsWith(normalizedQuery) ? 0 : 1;
    const typeWeight = entry.type === "state" ? 0 : 1;

    return {
      entry,
      score: `${startsWith}:${typeWeight}:${haystack.length.toString().padStart(4, "0")}:${entry.name}`,
    };
  }).filter((item): item is { entry: MetaLocationCatalogEntry; score: string } => Boolean(item));

  scored.sort((left, right) => left.score.localeCompare(right.score));

  return scored.slice(0, limit).map(({ entry }) => ({
    id: entry.id,
    name: entry.name,
    subtitle: buildMetaLocationSuggestionSubtitle(entry),
    type: entry.type,
  }));
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

const workspaceKindSchema = z.enum(WORKSPACE_KIND_VALUES);
const workspaceStatusSchema = z.enum(WORKSPACE_STATUS_VALUES);
const workspaceMemberRoleSchema = z.enum(WORKSPACE_MEMBER_ROLE_VALUES);
const workspaceColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{6})$/, "Informe uma cor válida no formato hexadecimal.")
  .optional()
  .nullable();

const createCompanySchema = z.object({
  name: z.string().min(2).max(80),
  kind: workspaceKindSchema.optional().default("CLIENT"),
  color: workspaceColorSchema,
});

const updateCompanySchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  status: workspaceStatusSchema.optional(),
  color: workspaceColorSchema,
}).refine((payload) => Object.keys(payload).length > 0, {
  message: "Informe ao menos um campo para atualização.",
});

const createWorkspaceInviteSchema = z.object({
  role: workspaceMemberRoleSchema.refine((value) => value !== "CENTRAL", {
    message: "Convites de workspace aceitam apenas cliente ou agência.",
  }),
});

const workspaceInviteQuerySchema = z.object({
  key: z.string().trim().min(1),
});

const socialPlatformSchema = z.enum(["instagram", "facebook", "threads", "tiktok", "x", "whatsapp"]);

const createConnectionSchema = z.object({
  companyId: z.string().trim().min(1, "Workspace é obrigatório."),
  platform: socialPlatformSchema,
  displayName: z.string().min(2).max(80).optional().nullable(),
  loginIdentifier: z.string().trim().max(160).optional().nullable(),
  secret: z.string().trim().max(255).optional().nullable(),
});

const updateConnectionSchema = z.object({
  displayName: z.string().min(2).max(80),
  loginIdentifier: z.string().trim().max(160).optional().nullable(),
  secret: z.string().trim().max(255).optional().nullable(),
});

const setConnectionAgencyRefreshSchema = z.object({
  enabled: z.boolean(),
});

const syncProviderConnectionSchema = z.object({
  providerAccountIdHint: z.string().trim().min(1).max(255).optional(),
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

const createUserFromWorkspaceInviteSchema = z.object({
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
const localDateStringSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTimeStringSchema = z.string().trim().regex(/^\d{2}:\d{2}$/);

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
  hashtags: z.array(z.string().trim().max(64)).max(30).optional().nullable(),
  whatsappBackgroundColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  whatsappRelinkEnabled: z.boolean().optional().default(false),
  whatsappRelinkConnectionIds: z.array(z.string().trim().min(1)).optional().nullable(),
  schedulerGroupId: z.string().trim().min(1).max(120).optional().nullable(),
  locationName: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  publicationType: z.enum([
    "instagram_story",
    "instagram_reel",
    "instagram_post",
    "facebook_post",
    "threads_post",
    "tiktok_post",
    "x_post",
    "whatsapp_status_midia",
  ]),
  publicationState: publicationStateSchema.optional().default("PUBLISHED"),
  dataPostagem: z.string().datetime().optional().nullable(),
  scheduledDateLocal: localDateStringSchema.optional().nullable(),
  scheduledTimeLocal: localTimeStringSchema.optional().nullable(),
  timeZone: z.string().trim().min(1).max(80).optional().nullable(),
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
  hashtags: z.array(z.string().trim().max(64)).max(30).optional().nullable(),
  whatsappBackgroundColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  whatsappRelinkEnabled: z.boolean().optional(),
  whatsappRelinkConnectionIds: z.array(z.string().trim().min(1)).optional().nullable(),
  schedulerGroupId: z.string().trim().min(1).max(120).optional().nullable(),
  locationName: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  publicationType: z.enum([
    "instagram_story",
    "instagram_reel",
    "instagram_post",
    "facebook_post",
    "threads_post",
    "tiktok_post",
    "x_post",
    "whatsapp_status_midia",
  ]),
  publicationState: publicationStateSchema.optional(),
  dataPostagem: z.string().datetime().optional().nullable(),
  scheduledDateLocal: localDateStringSchema.optional().nullable(),
  scheduledTimeLocal: localTimeStringSchema.optional().nullable(),
  timeZone: z.string().trim().min(1).max(80).optional().nullable(),
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
  isPublic: z.boolean().optional().default(true),
  isTrial: z.boolean().optional().default(false),
  maxProfiles: z.coerce.number().int().min(1).max(5000),
  workspaceLimit: z.coerce.number().int().min(1).max(5000),
  agencyBonusWorkspaceLimit: z.coerce.number().int().min(0).max(5000).default(0),
  maxConnections: z.coerce.number().int().min(1).max(20000),
  maxMonthlyPublications: z.coerce.number().int().min(1).max(2000000),
  displayOrder: z.coerce.number().int().min(0).max(5000).default(0),
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

const registerPostForMeWebhookSchema = z.object({
  force: z.boolean().optional().default(false),
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
    case "facebook_post":
    case "threads_post":
    case "tiktok_post":
    case "x_post":
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
    job.publicationType === "facebook_post" ||
    job.publicationType === "threads_post" ||
    job.publicationType === "tiktok_post" ||
    job.publicationType === "x_post" ||
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

  if ((publicationType === "facebook_post" || publicationType === "threads_post") && !/\.(jpg|jpeg|png|mp4|mov|m4v|webm)$/.test(normalizedPath)) {
    throw createFilePathValidationError(
      publicationType === "facebook_post"
        ? "Facebook aceita imagem (JPG/PNG) ou vídeo (MP4/MOV/M4V/WEBM)."
        : "Threads aceita imagem (JPG/PNG) ou vídeo (MP4/MOV/M4V/WEBM).",
    );
  }

  if (publicationType === "tiktok_post" && !/\.(mp4|mov|m4v|webm)$/.test(normalizedPath)) {
    throw createFilePathValidationError("TikTok aceita apenas vídeo (MP4/MOV/M4V/WEBM).");
  }

  if (publicationType === "x_post" && !/\.(jpg|jpeg|png|mp4|mov|m4v|webm)$/.test(normalizedPath)) {
    throw createFilePathValidationError("X aceita imagem (JPG/PNG) ou vídeo (MP4/MOV/M4V/WEBM).");
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

function isVideoFilePathForManagedPublication(filePath: string): boolean {
  return /\.(mp4|mov|m4v|webm)$/i.test(filePath.trim());
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

  const allowsMediaOptional =
    publicationType === "facebook_post" ||
    publicationType === "threads_post" ||
    publicationType === "x_post";

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
  const videoFileCount = uniqueFiles.filter((entry) => isVideoFilePathForManagedPublication(entry)).length;

  if (uniqueFiles.length === 0) {
    if (allowsMediaOptional) {
      return "";
    }
    throw createFilePathValidationError("Este tipo de publicacao exige uma midia.");
  }

  if (publicationType === "instagram_reel" && uniqueFiles.length > 1) {
    throw createFilePathValidationError("Instagram Reel aceita apenas uma mídia por agendamento.");
  }

  if (publicationType === "facebook_post" && uniqueFiles.length > INSTAGRAM_MULTI_MEDIA_MAX_FILES) {
    throw createFilePathValidationError(`Facebook aceita até ${INSTAGRAM_MULTI_MEDIA_MAX_FILES} imagens por agendamento.`);
  }

  if (publicationType === "facebook_post" && videoFileCount > 0 && uniqueFiles.length > 1) {
    throw createFilePathValidationError("Facebook aceita múltiplas imagens no feed ou apenas 1 vídeo por agendamento.");
  }

  if ((publicationType === "instagram_post" || publicationType === "instagram_story") && uniqueFiles.length > INSTAGRAM_MULTI_MEDIA_MAX_FILES) {
    throw createFilePathValidationError(`Você pode enviar até ${INSTAGRAM_MULTI_MEDIA_MAX_FILES} mídias por agendamento.`);
  }

  if (publicationType === "threads_post" && uniqueFiles.length > THREADS_MULTI_MEDIA_MAX_FILES) {
    throw createFilePathValidationError(`Você pode enviar até ${THREADS_MULTI_MEDIA_MAX_FILES} mídias por agendamento no Threads.`);
  }

  if (publicationType === "tiktok_post" && uniqueFiles.length > 1) {
    throw createFilePathValidationError("TikTok aceita apenas um vídeo por agendamento.");
  }

  if (publicationType === "x_post" && uniqueFiles.length > 4) {
    throw createFilePathValidationError("X aceita até 4 mídias por agendamento.");
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

function isProviderManagedMetaPublication(publicationType: PublicationType): boolean {
  return (
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "instagram_story" ||
    publicationType === "facebook_post" ||
    publicationType === "threads_post" ||
    publicationType === "tiktok_post" ||
    publicationType === "x_post"
  );
}

function isMetaLocationSupportedPublication(publicationType: PublicationType): boolean {
  return (
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "facebook_post" ||
    publicationType === "threads_post"
  );
}

function isInstagramLocationSupportedPublication(publicationType: PublicationType): boolean {
  return publicationType === "instagram_post" || publicationType === "instagram_reel";
}

function platformForPublication(publicationType: PublicationType): "instagram" | "facebook" | "threads" | "tiktok" | "x" | "whatsapp" {
  switch (publicationType) {
    case "facebook_post":
      return "facebook";
    case "threads_post":
      return "threads";
    case "tiktok_post":
      return "tiktok";
    case "x_post":
      return "x";
    case "whatsapp_status_midia":
    case "whatsapp_status_texto":
      return "whatsapp";
    case "instagram_story":
    case "instagram_reel":
    case "instagram_post":
    default:
      return "instagram";
  }
}

function publicationExecutionPriority(publicationType: PublicationType): number {
  switch (publicationType) {
    case "instagram_story":
      return 1;
    case "instagram_post":
      return 2;
    case "instagram_reel":
      return 3;
    case "facebook_post":
      return 4;
    case "threads_post":
      return 5;
    case "tiktok_post":
      return 6;
    case "x_post":
      return 7;
    case "whatsapp_status_texto":
      return 8;
    case "whatsapp_status_midia":
      return 9;
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
    case "facebook_post":
      return "Facebook Post";
    case "threads_post":
      return "Threads Post";
    case "tiktok_post":
      return "TikTok";
    case "x_post":
      return "X";
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

function buildDuplicateJobTitleCandidate(baseTitle: string, copyIndex: number): string {
  const normalizedBaseTitle = normalizeJobTitle(baseTitle) || "Sem título";
  const suffix = copyIndex <= 1 ? " - cópia" : ` - cópia${copyIndex}`;
  const maxBaseLength = Math.max(1, 120 - suffix.length);
  return `${normalizedBaseTitle.slice(0, maxBaseLength).trimEnd()}${suffix}`;
}

async function resolveNextDuplicateJobTitle(baseTitle: string, companyId: string): Promise<string> {
  let copyIndex = 1;

  for (;;) {
    const candidateTitle = buildDuplicateJobTitleCandidate(baseTitle, copyIndex);
    const existingJob = await prisma.job.findFirst({
      where: {
        companyId,
        title: candidateTitle,
      },
      select: {
        id: true,
      },
    });

    if (!existingJob) {
      return candidateTitle;
    }

    copyIndex += 1;
  }
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

function ensureMetaPublicationMetadata(
  publicationType: PublicationType,
  caption?: string | null,
  fileCaptions?: Array<string | null | undefined> | null,
  locationName?: string | null,
  locationId?: string | null,
  schedulerGroupId?: string | null,
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
    publicationType !== "instagram_story" &&
    publicationType !== "whatsapp_status_midia" &&
    !normalizedCaption
      ? fallbackCaption
      : normalizedCaption;
  const normalizedLocation = locationName?.trim() || null;
  const normalizedLocationId = locationId?.trim() || null;
  const isForcedInstagramLocation =
    isInstagramLocationSupportedPublication(publicationType) && !!INSTAGRAM_FORCED_LOCATION_ID;
  const effectiveLocationId = isForcedInstagramLocation ? INSTAGRAM_FORCED_LOCATION_ID : normalizedLocationId;
  const effectiveLocationName =
    isForcedInstagramLocation && effectiveLocationId
      ? normalizedLocation || INSTAGRAM_FORCED_LOCATION_NAME || `Local #${effectiveLocationId}`
      : normalizedLocation;

  if (isMetaLocationSupportedPublication(publicationType)) {
    if (effectiveLocationName && !effectiveLocationId) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["locationName"],
          message: "Selecione uma localização válida da lista para preencher o ID automaticamente.",
        },
      ]);
    }

    if (effectiveLocationId?.includes("::")) {
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
    caption:
      publicationType === "instagram_story"
        ? null
        : publicationType === "whatsapp_status_midia"
          ? normalizedCaption
          : effectiveCaption,
    locationName: encodeMetaLocationStorage(
      effectiveLocationName || (effectiveLocationId ? `Local #${effectiveLocationId}` : null),
      effectiveLocationId,
      schedulerGroupId,
    ),
  };
}

function normalizeFirstComment(publicationType: PublicationType, value?: string | null): string | null {
  if (publicationType !== "instagram_post" && publicationType !== "instagram_reel") {
    return null;
  }

  const normalized = value?.trim() || "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeHashtagValue(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 64);
}

function normalizeHashtags(publicationType: PublicationType, value?: Array<string | null | undefined> | null): string[] {
  const supportsHashtags =
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "facebook_post" ||
    publicationType === "threads_post" ||
    publicationType === "tiktok_post" ||
    publicationType === "x_post";
  if (!supportsHashtags) {
    return [];
  }

  const hashtags = (Array.isArray(value) ? value : [])
    .map((entry) => (typeof entry === "string" ? normalizeHashtagValue(entry) : null))
    .filter((entry): entry is string => Boolean(entry));

  return Array.from(new Set(hashtags)).slice(0, 30);
}

function appendHashtagsToCaption(caption: string | null, hashtags: string[]): string | null {
  if (hashtags.length === 0) {
    return caption;
  }

  const normalizedCaption = caption?.trim() || "";
  const hashtagBlock = hashtags.map((tag) => `#${tag}`).join(" ");

  if (!normalizedCaption) {
    return hashtagBlock;
  }

  return `${normalizedCaption}\n\n${hashtagBlock}`;
}

function appendThreadsHashtagsOnNewLine(caption: string | null, hashtags: string[]): string | null {
  if (hashtags.length === 0) {
    return caption;
  }

  const normalizedCaption = caption?.trim() || "";
  const [firstTag, ...remainingTags] = hashtags;
  const hashtagBlock = [`##${firstTag}`]
    .concat(remainingTags.map((tag) => `#${tag}`))
    .join(" ");

  if (!normalizedCaption) {
    return hashtagBlock;
  }

  return `${normalizedCaption}\n\n${hashtagBlock}`;
}

function parseStoredJobHashtags(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => (typeof entry === "string" ? normalizeHashtagValue(entry) : null))
    .filter((entry): entry is string => Boolean(entry));
}

function resolveStoredJobCaptionForPublication(job: {
  caption: string | null;
  hashtags?: unknown;
  publicationType?: string | null;
  postStory?: boolean;
  postReel?: boolean;
  postWhatsapp?: boolean;
}): string | null {
  const publicationType = normalizePublicationType(job);
  if (
    publicationType !== "instagram_post" &&
    publicationType !== "instagram_reel" &&
    publicationType !== "facebook_post" &&
    publicationType !== "threads_post" &&
    publicationType !== "tiktok_post" &&
    publicationType !== "x_post"
  ) {
    return job.caption;
  }

  const hashtags = parseStoredJobHashtags(job.hashtags);
  if (publicationType === "threads_post") {
    return appendThreadsHashtagsOnNewLine(job.caption, hashtags);
  }

  return appendHashtagsToCaption(job.caption, hashtags);
}

function resolvePostForMeCaptionForPublication(job: {
  caption: string | null;
  hashtags?: unknown;
  publicationType?: string | null;
  postStory?: boolean;
  postReel?: boolean;
  postWhatsapp?: boolean;
}): string {
  const resolvedCaption = resolveStoredJobCaptionForPublication(job)?.trim() || "";
  if (resolvedCaption) {
    return resolvedCaption;
  }

  return POST_FOR_ME_REQUIRED_CAPTION_FALLBACK;
}

function resolvePostForMePlacementForMetaPublication(
  publicationType: PublicationType,
  encodedFilePath?: string | null,
): PostForMePlacement | undefined {
  switch (publicationType) {
    case "instagram_reel":
      return "reels";
    case "instagram_story":
      return "stories";
    case "instagram_post":
    case "threads_post":
      return "timeline";
    case "facebook_post": {
      const mediaBundle = decodeJobMediaBundleStorage(encodedFilePath);
      const mediaFiles = mediaBundle.files.length > 0
        ? mediaBundle.files
        : (encodedFilePath?.trim() ? [encodedFilePath.trim()] : []);
      return mediaFiles.length === 1 && isVideoFilePathForManagedPublication(mediaFiles[0]!)
        ? "reels"
        : "timeline";
    }
    default:
      return undefined;
  }
}

function isPostForMeLoginRequiredErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("social account") &&
    (normalized.includes("disconnect") ||
      normalized.includes("not connected") ||
      normalized.includes("invalid") ||
      normalized.includes("revoked"))
  );
}

function supportsWhatsappRelink(publicationType: PublicationType): boolean {
  return (
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "instagram_story" ||
    publicationType === "threads_post" ||
    publicationType === "x_post" ||
    publicationType === "tiktok_post"
  );
}

function resolveWhatsappRelinkMediaFiles(encodedFilePath: string): string[] {
  const mediaBundle = decodeJobMediaBundleStorage(encodedFilePath);
  return mediaBundle.files.length > 0
    ? mediaBundle.files
    : (encodedFilePath?.trim() ? [encodedFilePath.trim()] : []);
}

function resolveWhatsappRelinkMediaValidationMessage(
  publicationType: PublicationType,
  encodedFilePath: string,
): string | null {
  if (!supportsWhatsappRelink(publicationType)) {
    return "Relink no WhatsApp indisponível para este tipo de publicação.";
  }

  const mediaFiles = resolveWhatsappRelinkMediaFiles(encodedFilePath);

  if (publicationType === "instagram_story" && mediaFiles.length > 1) {
    return "Relink no WhatsApp para stories funciona apenas com 1 mídia por vez.";
  }

  if ((publicationType === "threads_post" || publicationType === "x_post") && mediaFiles.length === 0) {
    return `Relink no WhatsApp para ${publicationType === "threads_post" ? "Threads" : "X"} exige ao menos 1 mídia publicada.`;
  }

  if (publicationType === "tiktok_post" && mediaFiles.length === 0) {
    return "Relink no WhatsApp para TikTok exige 1 vídeo publicado.";
  }

  return null;
}

function supportsWhatsappRelinkForJobMedia(
  publicationType: PublicationType,
  encodedFilePath: string,
): boolean {
  return resolveWhatsappRelinkMediaValidationMessage(publicationType, encodedFilePath) === null;
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
  if (!supportsWhatsappRelink(input.publicationType)) {
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

  if (!supportsWhatsappRelinkForJobMedia(input.publicationType, input.encodedFilePath)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["whatsappRelinkEnabled"],
        message:
          resolveWhatsappRelinkMediaValidationMessage(input.publicationType, input.encodedFilePath) ||
          "Relink no WhatsApp indisponível para esta publicação.",
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
      ...connectionVisibilityWhere(input.request),
      id: { in: normalizedIds },
      platform: "whatsapp",
      authStatus: "CONNECTED",
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
  const connection = await findConnectionWithWorkspaceContext(input.socialConnectionId);

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
        message: "A conta social precisa pertencer ao mesmo workspace da postagem.",
      },
    ]);
  }

  const workspace = connection.company as WorkspacePermissionContext;
  if (!canCurrentUserAccessWorkspace(input.request, workspace)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["socialConnectionId"],
        message: "A conta social precisa estar disponível no seu workspace.",
      },
    ]);
  }

  if (workspace.status !== "ACTIVE") {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["companyId"],
        message: "Este workspace está inativo e não aceita novas publicações.",
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

async function resolveAutomaticMetaLocation(input: {
  publicationType: PublicationType;
  socialConnectionId: string;
  locationName?: string | null;
  locationId?: string | null;
}): Promise<{ locationName: string | null; locationId: string | null }> {
  const normalizedLocationName = input.locationName?.trim() || null;
  const normalizedLocationId = input.locationId?.trim() || null;

  if (!isProviderManagedMetaPublication(input.publicationType)) {
    return {
      locationName: normalizedLocationName,
      locationId: normalizedLocationId,
    };
  }

  if (!isMetaLocationSupportedPublication(input.publicationType)) {
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
  const schedulerMetadata = decodeMetaLocationStorage(job.locationName);
  const mediaBundle = decodeJobMediaBundleStorage(job.filePath);
  const hashtags = Array.isArray(job.hashtags)
    ? job.hashtags
        .map((entry) => (typeof entry === "string" ? normalizeHashtagValue(entry) : null))
        .filter((entry): entry is string => Boolean(entry))
    : [];

  return {
    id: job.id,
    companyId: job.companyId,
    socialConnectionId: job.socialConnectionId,
    schedulerGroupId: schedulerMetadata.schedulerGroupId,
    filePath: mediaBundle.files[0] ?? job.filePath,
    filePaths: mediaBundle.files,
    fileCaptions: mediaBundle.captions,
    sequential: mediaBundle.sequential,
    title: job.title,
    caption: job.caption,
    firstComment: job.firstComment,
    hashtags,
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
  const userId = request.adminUser?.id;
  const accessOr =
    !isRootUser(request) && userId
      ? [
          { createdByUserId: userId },
          { members: { some: { userId } } },
        ]
      : undefined;

  return {
    id: companyId ?? undefined,
    OR: accessOr,
  };
}

function connectionVisibilityWhere(
  request: Request & { adminUser?: AdminUserAuth },
  companyId?: string,
) {
  const userId = request.adminUser?.id;
  return {
    companyId: companyId ?? undefined,
    company: isRootUser(request) || !userId
      ? undefined
      : {
          OR: [
            { createdByUserId: userId },
            { members: { some: { userId } } },
          ],
        },
  };
}

function jobVisibilityWhere(
  request: Request & { adminUser?: AdminUserAuth },
  companyId?: string,
  status?: string,
) {
  const userId = request.adminUser?.id;
  return {
    companyId: companyId ?? undefined,
    status: status ?? undefined,
    company: isRootUser(request) || !userId
      ? undefined
      : {
          OR: [
            { createdByUserId: userId },
            { members: { some: { userId } } },
          ],
        },
    NOT: {
      publicationType: "whatsapp_status_texto",
    },
  };
}

type WorkspaceMemberSummary = {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    username: string;
  };
};

type WorkspaceInviteSummary = {
  id: string;
  inviteKey: string;
  role: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  acceptedByUserId: string | null;
};

type WorkspacePermissionContext = {
  id: string;
  name: string;
  color: string | null;
  createdByUserId: string | null;
  kind: string;
  status: string;
  createdAt: Date;
  members: WorkspaceMemberSummary[];
  invites: WorkspaceInviteSummary[];
};

function normalizeWorkspaceMemberRole(value: string | null | undefined): WorkspaceMemberRole | null {
  return WORKSPACE_MEMBER_ROLE_VALUES.includes(value as WorkspaceMemberRole) ? (value as WorkspaceMemberRole) : null;
}

function resolveCurrentWorkspaceRole(
  workspace: Pick<WorkspacePermissionContext, "createdByUserId" | "members">,
  userId: string,
): WorkspaceMemberRole | null {
  const membershipRole = normalizeWorkspaceMemberRole(
    workspace.members.find((member) => member.userId === userId)?.role ?? null,
  );
  if (membershipRole) {
    return membershipRole;
  }
  if (workspace.createdByUserId === userId) {
    return "CENTRAL";
  }
  return null;
}

function hasActiveClientWorkspaceMember(workspace: Pick<WorkspacePermissionContext, "members">): boolean {
  return workspace.members.some((member) => normalizeWorkspaceMemberRole(member.role) === "CLIENT");
}

function canCurrentUserManageWorkspace(
  request: Request & { adminUser?: AdminUserAuth },
  workspace: WorkspacePermissionContext,
): boolean {
  if (isRootUser(request)) {
    return true;
  }

  const userId = request.adminUser?.id;
  if (!userId) {
    return false;
  }

  return resolveCurrentWorkspaceRole(workspace, userId) === "CENTRAL";
}

function canCurrentUserManageWorkspaceMembers(
  request: Request & { adminUser?: AdminUserAuth },
  workspace: WorkspacePermissionContext,
): boolean {
  return canCurrentUserManageWorkspace(request, workspace);
}

function canCurrentUserConnectWorkspaceAccounts(
  request: Request & { adminUser?: AdminUserAuth },
  workspace: WorkspacePermissionContext,
): boolean {
  if (isRootUser(request)) {
    return true;
  }

  if (workspace.status !== "ACTIVE") {
    return false;
  }

  const userId = request.adminUser?.id;
  if (!userId) {
    return false;
  }

  const currentRole = resolveCurrentWorkspaceRole(workspace, userId);
  if (workspace.kind === "AGENCY_BONUS") {
    return currentRole === "CENTRAL" || currentRole === "AGENCY";
  }

  if (currentRole === "CLIENT") {
    return true;
  }

  return currentRole === "CENTRAL" && !hasActiveClientWorkspaceMember(workspace);
}

function canCurrentUserRenewConnectionAccess(
  request: Request & { adminUser?: AdminUserAuth },
  workspace: WorkspacePermissionContext,
  connection: { agencyCanRefresh: boolean },
): boolean {
  if (isRootUser(request)) {
    return true;
  }

  if (workspace.status !== "ACTIVE") {
    return false;
  }

  const userId = request.adminUser?.id;
  if (!userId) {
    return false;
  }

  const currentRole = resolveCurrentWorkspaceRole(workspace, userId);
  if (workspace.kind === "AGENCY_BONUS") {
    return currentRole === "CENTRAL" || currentRole === "AGENCY";
  }

  if (currentRole === "CLIENT") {
    return true;
  }

  if (currentRole === "CENTRAL" && !hasActiveClientWorkspaceMember(workspace)) {
    return true;
  }

  return (currentRole === "CENTRAL" || currentRole === "AGENCY") && connection.agencyCanRefresh;
}

function normalizePlanCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function trimNullable(value?: string | null): string | null {
  const normalized = (value || "").trim();
  return normalized ? normalized : null;
}

async function findWorkspaceContextById(companyId: string): Promise<WorkspacePermissionContext | null> {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      color: true,
      createdByUserId: true,
      kind: true,
      status: true,
      createdAt: true,
      members: {
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
        },
      },
      invites: {
        where: {
          revokedAt: null,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          inviteKey: true,
          role: true,
          usedAt: true,
          revokedAt: true,
          createdAt: true,
          acceptedByUserId: true,
        },
      },
    },
  });
}

async function assertWorkspaceVisibleForRequest(
  request: Request & { adminUser?: AdminUserAuth },
  companyId: string,
): Promise<WorkspacePermissionContext> {
  const workspace = await findWorkspaceContextById(companyId);
  if (!workspace) {
    throw new Error("WORKSPACE_NOT_FOUND");
  }

  if (isRootUser(request)) {
    return workspace;
  }

  const userId = request.adminUser?.id;
  if (!userId) {
    throw new Error("WORKSPACE_FORBIDDEN");
  }

  const isVisible =
    workspace.createdByUserId === userId ||
    workspace.members.some((member) => member.userId === userId);
  if (!isVisible) {
    throw new Error("WORKSPACE_FORBIDDEN");
  }

  return workspace;
}

async function acceptWorkspaceInviteForUser(
  inviteKey: string,
  userId: string,
  transaction: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const invite = await transaction.companyInvite.findFirst({
      where: {
        inviteKey,
        revokedAt: null,
        usedAt: null,
      },
      include: {
        company: {
          include: {
            members: {
              select: {
                id: true,
                userId: true,
                role: true,
                createdAt: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                  },
                },
              },
            },
            invites: {
              where: {
                revokedAt: null,
              },
              select: {
                id: true,
                inviteKey: true,
                role: true,
                usedAt: true,
                revokedAt: true,
                createdAt: true,
                acceptedByUserId: true,
              },
            },
          },
        },
      },
    });

  if (!invite) {
    throw new Error("WORKSPACE_INVITE_INVALID");
  }

  if (normalizeWorkspaceMemberRole(invite.role) === "CLIENT") {
    const activeClientMember = invite.company.members.find((member) => normalizeWorkspaceMemberRole(member.role) === "CLIENT");
    if (activeClientMember && activeClientMember.userId !== userId) {
      throw new Error("WORKSPACE_ALREADY_HAS_CLIENT");
    }
  }

  await transaction.companyMember.upsert({
    where: {
      companyId_userId: {
        companyId: invite.companyId,
        userId,
      },
    },
    update: {
      role: invite.role,
    },
    create: {
      companyId: invite.companyId,
      userId,
      role: invite.role,
    },
  });

  await transaction.companyInvite.update({
    where: { id: invite.id },
    data: {
      usedAt: new Date(),
      acceptedByUserId: userId,
    },
  });

  return transaction.company.findUnique({
    where: { id: invite.companyId },
    select: {
      id: true,
      name: true,
      color: true,
      createdByUserId: true,
      kind: true,
      status: true,
      createdAt: true,
      members: {
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
        },
      },
      invites: {
        where: {
          revokedAt: null,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          inviteKey: true,
          role: true,
          usedAt: true,
          revokedAt: true,
          createdAt: true,
          acceptedByUserId: true,
        },
      },
    },
  });
}

function buildWorkspaceInviteUrl(inviteKey: string): string {
  const publicBaseUrl = (process.env.APP_PUBLIC_URL || process.env.INSTAGRAM_GRAPH_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!publicBaseUrl) {
    return `/?workspaceInviteKey=${encodeURIComponent(inviteKey)}`;
  }
  return `${publicBaseUrl}/?workspaceInviteKey=${encodeURIComponent(inviteKey)}`;
}

function mapWorkspaceForClient(
  request: Request & { adminUser?: AdminUserAuth },
  workspace: WorkspacePermissionContext,
) {
  const currentUserId = request.adminUser?.id ?? "";
  const currentUserRole = currentUserId ? resolveCurrentWorkspaceRole(workspace, currentUserId) : null;
  const hasClientMember = hasActiveClientWorkspaceMember(workspace);

  return {
    id: workspace.id,
    name: workspace.name,
    color: workspace.color,
    kind: workspace.kind,
    status: workspace.status,
    createdAt: workspace.createdAt,
    currentUserRole,
    hasClientMember,
    canManageWorkspace: canCurrentUserManageWorkspace(request, workspace),
    canManageMembers: canCurrentUserManageWorkspaceMembers(request, workspace),
    canConnectAccounts: canCurrentUserConnectWorkspaceAccounts(request, workspace),
    members: workspace.members.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      name: member.user.name,
      username: member.user.username,
      createdAt: member.createdAt,
    })),
    invites: workspace.invites.map((invite) => ({
      id: invite.id,
      role: invite.role,
      createdAt: invite.createdAt,
      usedAt: invite.usedAt,
      revokedAt: invite.revokedAt,
      acceptedByUserId: invite.acceptedByUserId,
      inviteUrl: buildWorkspaceInviteUrl(invite.inviteKey),
    })),
  };
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

type PostForMeWebhookSettingsSnapshot = {
  configured: boolean;
  secretConfigured: boolean;
  secretSource: "app_setting" | "env" | "none";
  webhookId: string | null;
  webhookUrl: string | null;
  publicEndpointUrl: string | null;
  eventTypes: string[];
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
    workspaceLimit: number;
    agencyBonusWorkspaceLimit: number;
    maxConnections: number;
    maxMonthlyPublications: number;
  } | null;
  usage: {
    profilesUsed: number;
    workspaceClientUsed: number;
    workspaceAgencyBonusUsed: number;
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

function resolvePublicBaseUrlFromRequest(request: Request): string | null {
  const host = request.get("host")?.trim();
  if (!host) {
    return null;
  }

  const forwardedProto = request.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.protocol || "https";
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function resolvePostForMeWebhookEndpointUrl(request: Request): string | null {
  const requestBaseUrl = resolvePublicBaseUrlFromRequest(request);
  const requestHost = request.get("host")?.trim().toLowerCase() || "";
  const looksLocalHost =
    requestHost.startsWith("localhost") ||
    requestHost.startsWith("127.0.0.1") ||
    requestHost.startsWith("0.0.0.0");
  const baseUrl =
    POST_FOR_ME_WEBHOOK_PUBLIC_BASE_URL ||
    (looksLocalHost ? "" : requestBaseUrl || "");
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl}${POST_FOR_ME_WEBHOOK_PATH}`;
}

async function resolveStoredPostForMeWebhookSecret(): Promise<string | null> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: BILLING_SETTING_POST_FOR_ME_WEBHOOK_SECRET },
  });

  return trimNullable(setting?.value);
}

async function resolveEffectivePostForMeWebhookSecret(): Promise<{
  secret: string | null;
  source: "app_setting" | "env" | "none";
}> {
  const storedSecret = await resolveStoredPostForMeWebhookSecret();
  if (storedSecret) {
    return { secret: storedSecret, source: "app_setting" };
  }

  if (POST_FOR_ME_WEBHOOK_SECRET) {
    return { secret: POST_FOR_ME_WEBHOOK_SECRET, source: "env" };
  }

  return { secret: null, source: "none" };
}

async function getPostForMeWebhookSettingsSnapshot(request: Request): Promise<PostForMeWebhookSettingsSnapshot> {
  const [webhookIdSetting, webhookUrlSetting, effectiveSecret] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: BILLING_SETTING_POST_FOR_ME_WEBHOOK_ID } }),
    prisma.appSetting.findUnique({ where: { key: BILLING_SETTING_POST_FOR_ME_WEBHOOK_URL } }),
    resolveEffectivePostForMeWebhookSecret(),
  ]);

  const webhookId = trimNullable(webhookIdSetting?.value);
  const webhookUrl = trimNullable(webhookUrlSetting?.value);
  const publicEndpointUrl = resolvePostForMeWebhookEndpointUrl(request);
  const secretConfigured = Boolean(effectiveSecret.secret);

  return {
    configured: Boolean(webhookUrl && secretConfigured),
    secretConfigured,
    secretSource: effectiveSecret.source,
    webhookId,
    webhookUrl,
    publicEndpointUrl,
    eventTypes: [...POST_FOR_ME_ACCOUNT_WEBHOOK_EVENT_TYPES],
  };
}

async function backfillLegacyPlanWorkspaceConfig(): Promise<void> {
  const plans = await prisma.plan.findMany({
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      code: true,
      isTrial: true,
      maxProfiles: true,
      workspaceLimit: true,
      agencyBonusWorkspaceLimit: true,
      isPublic: true,
      displayOrder: true,
    },
  });

  await Promise.all(
    plans.map(async (plan, index) => {
      const nextData: Prisma.PlanUpdateInput = {};

      const looksLegacyWorkspaceLimit = plan.workspaceLimit <= 1 && plan.maxProfiles > 1;
      if (looksLegacyWorkspaceLimit) {
        nextData.workspaceLimit = plan.maxProfiles;
      }

      if (plan.code === BILLING_TRIAL_PLAN_CODE && plan.isPublic) {
        nextData.isPublic = false;
      }

      if (plan.displayOrder === 0) {
        nextData.displayOrder = index + 1;
      }

      if (Object.keys(nextData).length === 0) {
        return;
      }

      await prisma.plan.update({
        where: { id: plan.id },
        data: nextData,
      });
    }),
  );
}

async function backfillLegacyWorkspaceMembers(): Promise<void> {
  const workspaces = await prisma.company.findMany({
    where: {
      createdByUserId: { not: null },
    },
    select: {
      id: true,
      createdByUserId: true,
      members: {
        where: { role: "CENTRAL" },
        select: {
          userId: true,
        },
      },
    },
  });

  const missingCentralMemberships = workspaces
    .filter((workspace) => {
      const ownerUserId = workspace.createdByUserId;
      if (!ownerUserId) {
        return false;
      }

      return !workspace.members.some((member) => member.userId === ownerUserId);
    })
    .map((workspace) => ({
      companyId: workspace.id,
      userId: workspace.createdByUserId as string,
      role: "CENTRAL",
    }));

  if (missingCentralMemberships.length === 0) {
    return;
  }

  await prisma.companyMember.createMany({
    data: missingCentralMemberships,
    skipDuplicates: true,
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
      isPublic: trial.isPublic ?? false,
      isTrial: true,
      maxProfiles: trial.maxProfiles,
      workspaceLimit: trial.workspaceLimit,
      agencyBonusWorkspaceLimit: trial.agencyBonusWorkspaceLimit,
      maxConnections: trial.maxConnections,
      maxMonthlyPublications: trial.maxMonthlyPublications,
      displayOrder: trial.displayOrder ?? 0,
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

  const settings = await getBillingSettingsSnapshot();
  await backfillLegacyPlanWorkspaceConfig();
  await backfillLegacyWorkspaceMembers();
  await syncTrialPlanLimitsFromSettings(settings.autoTrialDays);
}

async function getBestActivePlanForDisplay() {
  return prisma.plan.findFirst({
    where: { isActive: true, isPublic: true },
    orderBy: [
      { displayOrder: "asc" },
      { maxMonthlyPublications: "desc" },
      { maxConnections: "desc" },
      { workspaceLimit: "desc" },
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
  const trialPlan = await prisma.plan.findUnique({
    where: { code: BILLING_TRIAL_PLAN_CODE },
    select: { id: true },
  });

  const trialReferencePlan = await prisma.plan.findFirst({
    where: {
      isActive: true,
      isTrial: false,
      isPublic: true,
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    select: { maxProfiles: true, workspaceLimit: true, maxConnections: true, maxMonthlyPublications: true },
  });

  if (!trialPlan || !trialReferencePlan) {
    return;
  }

  const nextWorkspaceLimit = scaleLimitByTrialDays(trialReferencePlan.workspaceLimit ?? trialReferencePlan.maxProfiles, trialDays);
  const nextMaxConnections = Math.max(
    nextWorkspaceLimit,
    scaleLimitByTrialDays(trialReferencePlan.maxConnections, trialDays),
  );
  const nextMaxMonthlyPublications = scaleLimitByTrialDays(trialReferencePlan.maxMonthlyPublications, trialDays);

  await prisma.plan.update({
    where: { id: trialPlan.id },
    data: {
      maxProfiles: nextWorkspaceLimit,
      workspaceLimit: nextWorkspaceLimit,
      agencyBonusWorkspaceLimit: 0,
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

async function resolveUserBillingAccessOnce(userId: string): Promise<BillingAccessSnapshot> {
  const now = new Date();
  const monthBounds = currentMonthBounds(now);
  const [subscription, workspaceMembershipsCount, profilesUsed, workspaceClientUsed, workspaceAgencyBonusUsed, connectionsUsed, postsUsedThisMonth] = await Promise.all([
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
            workspaceLimit: true,
            agencyBonusWorkspaceLimit: true,
            maxConnections: true,
            maxMonthlyPublications: true,
            isActive: true,
          },
        },
      },
    }),
    prisma.companyMember.count({
      where: {
        userId,
      },
    }),
    prisma.company.count({
      where: {
        createdByUserId: userId,
      },
    }),
    prisma.company.count({
      where: {
        createdByUserId: userId,
        kind: "CLIENT",
      },
    }),
    prisma.company.count({
      where: {
        createdByUserId: userId,
        kind: "AGENCY_BONUS",
      },
    }),
    prisma.socialConnection.count({
      where: {
        company: {
          createdByUserId: userId,
        },
      },
    }),
    prisma.job.count({
      where: {
        company: {
          createdByUserId: userId,
        },
        publicationState: "PUBLISHED",
        criadoEm: {
          gte: monthBounds.start,
          lt: monthBounds.end,
        },
      },
    }),
  ]);

  if (!subscription) {
    if (workspaceMembershipsCount > 0) {
      return {
        status: "ACTIVE",
        billingModel: "WORKSPACE_MEMBER",
        cycle: null,
        stripeSubscriptionId: null,
        stripeCancelAtPeriodEnd: false,
        plan: null,
        usage: {
          profilesUsed,
          workspaceClientUsed,
          workspaceAgencyBonusUsed,
          connectionsUsed,
          postsUsedThisMonth,
        },
        isBlocked: false,
        blockMessage: null,
        startsAt: null,
        endsAt: null,
        trialEndsAt: null,
      };
    }

    return {
      status: "PAYMENT_REQUIRED",
      billingModel: "NONE",
      cycle: null,
      stripeSubscriptionId: null,
      stripeCancelAtPeriodEnd: false,
      plan: null,
      usage: {
        profilesUsed,
        workspaceClientUsed,
        workspaceAgencyBonusUsed,
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
        workspaceLimit: true,
        agencyBonusWorkspaceLimit: true,
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
          workspaceLimit: exposedPlan.workspaceLimit,
          agencyBonusWorkspaceLimit: exposedPlan.agencyBonusWorkspaceLimit,
          maxConnections: exposedPlan.maxConnections,
          maxMonthlyPublications: exposedPlan.maxMonthlyPublications,
        }
      : null,
    usage: {
      profilesUsed,
      workspaceClientUsed,
      workspaceAgencyBonusUsed,
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

async function resolveUserBillingAccess(userId: string): Promise<BillingAccessSnapshot> {
  return withPrismaConnectionRetry(() => resolveUserBillingAccessOnce(userId), {
    maxAttempts: 3,
    retryDelayMs: 350,
  });
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

async function ensureWorkspaceOwnerBillingWritableAccess(
  workspace: Pick<WorkspacePermissionContext, "createdByUserId">,
): Promise<BillingAccessSnapshot | null> {
  const ownerUserId = workspace.createdByUserId?.trim() || "";
  if (!ownerUserId) {
    return null;
  }

  const access = await resolveUserBillingAccess(ownerUserId);
  if (access.isBlocked) {
    throw new Error(access.blockMessage || "Conta bloqueada por pagamento pendente. Renove para continuar.");
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

function isLegacyMetaOAuthPlatform(platform: string): platform is "instagram" | "threads" {
  return platform === "instagram" || platform === "threads";
}

function isPostForMeProviderConnection(connection: {
  platform: string;
  provider?: string | null;
}): connection is { platform: PostForMePlatform; provider: "POST_FOR_ME" } {
  return connection.provider === "POST_FOR_ME" && isPostForMeManagedPlatform(connection.platform);
}

function buildPostForMeConnectionExternalId(connectionId: string): string {
  return `socialup:connection:${connectionId}`;
}

function resolvePostForMeStoredExternalId(connection: {
  id: string;
  providerExternalId?: string | null;
  providerMetadata?: Prisma.JsonValue | null;
}): string {
  const metadata = asRecord(connection.providerMetadata);
  const metadataExternalId =
    parseUnknownString(metadata?.external_id) ??
    parseUnknownString(metadata?.externalId) ??
    parseUnknownString(metadata?.external_id_hint) ??
    parseUnknownString(metadata?.externalIdHint);
  const providerExternalId = parseUnknownString(connection.providerExternalId);
  return metadataExternalId ?? providerExternalId ?? buildPostForMeConnectionExternalId(connection.id);
}

function buildPostForMeJobExternalId(jobId: string): string {
  return `socialup:job:${jobId}`;
}

function defaultAuthLaunchUrlForPlatform(platform: "instagram" | "facebook" | "threads" | "tiktok" | "x" | "whatsapp"): string | null {
  return platform === "whatsapp" ? "https://web.whatsapp.com/" : null;
}

function defaultConnectionDisplayNameForPlatform(platform: string): string {
  if (platform === "instagram") {
    return "Conta Instagram";
  }
  if (platform === "facebook") {
    return "Conta Facebook";
  }
  if (platform === "threads") {
    return "Conta Threads";
  }
  if (platform === "tiktok") {
    return "Conta TikTok";
  }
  if (platform === "x") {
    return "Conta X";
  }
  if (platform === "whatsapp") {
    return "Conta WhatsApp";
  }
  return "Conta conectada";
}

function buildAutoWhatsappInstanceName(connectionId: string): string {
  const suffix = createHash("sha1").update(connectionId).digest("hex").slice(0, 20);
  return `socialup_wa_${suffix}`;
}

function humanizeWhatsappQrErrorMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) {
    return "Falha ao iniciar a geração do QR do WhatsApp.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_KEY_MISSING")) {
    return "A integração do WhatsApp não está configurada no backend. Revise a chave da Evolution API.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_HTTP_401:")) {
    return "A Evolution API recusou a autenticação. Revise a chave configurada no backend e na Evolution.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_HTTP_403:")) {
    return "A Evolution API bloqueou esta operação. Revise as permissões e a configuração da instância.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_HTTP_404:")) {
    return "A instância do WhatsApp não foi encontrada na Evolution. Tente gerar o QR novamente.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_HTTP_409:")) {
    return "A instância do WhatsApp está em conflito de sessão. Tente gerar um novo QR.";
  }

  if (normalized.includes("LOGIN_REQUIRED_WHATSAPP")) {
    return "A conta do WhatsApp precisa ser autenticada para continuar.";
  }

  if (normalized.includes("WHATSAPP_INSTANCE_STARTING")) {
    return "A instância do WhatsApp está iniciando. Aguarde alguns segundos e tente novamente.";
  }

  if (normalized.includes("WHATSAPP_INSTANCE_LOGOUT_PENDING")) {
    return "A sessão anterior do WhatsApp ainda não foi encerrada na Evolution. Aguarde alguns segundos e tente gerar um novo QR.";
  }

  if (normalized.includes("WHATSAPP_INSTANCE_DELETE_PENDING")) {
    return "A Evolution ainda está removendo a sessão anterior do WhatsApp. Aguarde alguns segundos e tente novamente.";
  }

  if (normalized.includes("WHATSAPP_INSTANCE_REUSE_BLOCKED")) {
    return "A Evolution ainda está reaproveitando a sessão anterior do WhatsApp. O novo QR só será liberado quando essa sessão for encerrada.";
  }

  return normalized;
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

const metaDataDeletionRequestByCode = new Map<
  string,
  { platform: "threads"; createdAtMs: number }
>();

function cleanupMetaDataDeletionRequests(nowMs: number): void {
  for (const [code, entry] of metaDataDeletionRequestByCode.entries()) {
    if (nowMs - entry.createdAtMs > 7 * 24 * 60 * 60 * 1000) {
      metaDataDeletionRequestByCode.delete(code);
    }
  }
}

function resolveOauthPublicBaseUrl(request: Request): string | null {
  if (OAUTH_PUBLIC_BASE_URL) {
    return OAUTH_PUBLIC_BASE_URL;
  }

  const host = request.get("host")?.trim();
  if (!host) {
    return null;
  }

  const forwardedProto = request.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.protocol || "https";
  return `${protocol}://${host}`;
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
  provider?: string | null;
  providerAccountId?: string | null;
  providerExternalId?: string | null;
  providerStatus?: string | null;
  providerMetadata?: Prisma.JsonValue | null;
  displayName: string;
  loginIdentifier: string | null;
  secretCipher?: string | null;
  agencyCanRefresh?: boolean;
  authStatus: string;
  automationMode: string;
  authLaunchUrl: string | null;
  tokenExpiresAt: Date | null;
  lastAuthAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: connection.id,
    companyId: connection.companyId,
    platform: connection.platform,
    provider: connection.provider ?? "NATIVE",
    providerAccountId: connection.providerAccountId ?? null,
    providerExternalId: connection.providerExternalId ?? null,
    providerStatus: connection.providerStatus ?? null,
    providerMetadata: connection.providerMetadata ?? null,
    displayName: connection.displayName,
    loginIdentifier: connection.loginIdentifier,
    hasSecret: Boolean(connection.secretCipher),
    agencyCanRefresh: Boolean(connection.agencyCanRefresh),
    authStatus: connection.authStatus,
    automationMode: connection.automationMode,
    authLaunchUrl: connection.authLaunchUrl,
    tokenExpiresAt: connection.tokenExpiresAt,
    lastAuthAt: connection.lastAuthAt,
    lastSeenAt: connection.lastSeenAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    ...applyConnectionWorkerOverlay(connection),
  };
}

function resolveConnectionTokenExpiresAt(
  tokenExpiresInSeconds: number | null,
  referenceDate: Date,
): Date | null {
  if (typeof tokenExpiresInSeconds !== "number" || tokenExpiresInSeconds <= 0) {
    return null;
  }

  return new Date(referenceDate.getTime() + tokenExpiresInSeconds * 1000);
}

function parseOptionalDateFromUnknown(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function findConnectionWithWorkspaceContext(connectionId: string) {
  return prisma.socialConnection.findUnique({
    where: { id: connectionId },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          createdByUserId: true,
          kind: true,
          status: true,
          createdAt: true,
          members: {
            orderBy: [{ createdAt: "asc" }],
            select: {
              id: true,
              userId: true,
              role: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                },
              },
            },
          },
          invites: {
            where: {
              revokedAt: null,
            },
            orderBy: [{ createdAt: "desc" }],
            select: {
              id: true,
              inviteKey: true,
              role: true,
              usedAt: true,
              revokedAt: true,
              createdAt: true,
              acceptedByUserId: true,
            },
          },
        },
      },
    },
  });
}

async function findJobWithWorkspaceContext(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          createdByUserId: true,
          kind: true,
          status: true,
          createdAt: true,
          members: {
            orderBy: [{ createdAt: "asc" }],
            select: {
              id: true,
              userId: true,
              role: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                },
              },
            },
          },
          invites: {
            where: {
              revokedAt: null,
            },
            orderBy: [{ createdAt: "desc" }],
            select: {
              id: true,
              inviteKey: true,
              role: true,
              usedAt: true,
              revokedAt: true,
              createdAt: true,
              acceptedByUserId: true,
            },
          },
        },
      },
    },
  });
}

function canCurrentUserAccessWorkspace(
  request: Request & { adminUser?: AdminUserAuth },
  workspace: WorkspacePermissionContext,
): boolean {
  if (isRootUser(request)) {
    return true;
  }

  const userId = request.adminUser?.id;
  if (!userId) {
    return false;
  }

  return Boolean(resolveCurrentWorkspaceRole(workspace, userId));
}

function resolvePostForMeAccountSyncTimestamp(account: PostForMeSocialAccountRecord): number {
  const raw =
    account.raw && typeof account.raw === "object" && !Array.isArray(account.raw)
      ? (account.raw as Record<string, unknown>)
      : null;

  const candidates = [
    raw?.updated_at,
    raw?.updatedAt,
    raw?.connected_at,
    raw?.connectedAt,
    raw?.created_at,
    raw?.createdAt,
    account.tokenExpiresAt,
  ];

  for (const candidate of candidates) {
    const parsed = parseOptionalDateFromUnknown(candidate);
    if (parsed) {
      return parsed.getTime();
    }
  }

  return 0;
}

function resolvePostForMeConnectionAuthStatus(status: string | null | undefined): "AUTH_REQUIRED" | "AUTH_IN_PROGRESS" | "CONNECTED" {
  const normalized = (status || "").trim().toLowerCase();
  if (normalized === "connected") {
    return "CONNECTED";
  }
  if (normalized === "pending" || normalized === "processing" || normalized === "auth_in_progress") {
    return "AUTH_IN_PROGRESS";
  }
  return "AUTH_REQUIRED";
}

type PostForMeWebhookAccountRecord = {
  id: string;
  externalId: string | null;
  platform: PostForMePlatform | null;
  status: string | null;
  tokenExpiresAt: Date | null;
  username: string | null;
  name: string | null;
  raw: Record<string, unknown>;
};

function normalizePostForMeWebhookEventType(value: unknown): string | null {
  return parseUnknownString(value)?.trim().toLowerCase() || null;
}

function parsePostForMeWebhookAccountRecord(value: unknown): PostForMeWebhookAccountRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = parseUnknownString(record.id);
  if (!id) {
    return null;
  }

  const platformRaw = parseUnknownString(record.platform)?.toLowerCase() || null;
  const platform =
    platformRaw === "instagram" ||
    platformRaw === "facebook" ||
    platformRaw === "threads" ||
    platformRaw === "tiktok" ||
    platformRaw === "x"
      ? platformRaw
      : null;

  return {
    id,
    externalId: parseUnknownString(record.external_id) || parseUnknownString(record.externalId),
    platform,
    status: parseUnknownString(record.status)?.toLowerCase() || null,
    tokenExpiresAt: parseOptionalDateFromUnknown(
      parseUnknownString(record.access_token_expires_at) ||
        parseUnknownString(record.token_expires_at) ||
        parseUnknownString(record.expires_at),
    ),
    username:
      parseUnknownString(record.username) ||
      parseUnknownString(record.handle) ||
      parseUnknownString(record.login_identifier),
    name: parseUnknownString(record.name) || parseUnknownString(record.display_name),
    raw: record,
  };
}

function resolvePostForMeWebhookAccountPayload(payload: unknown): PostForMeWebhookAccountRecord | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const directAccount = parsePostForMeWebhookAccountRecord(record);
  if (directAccount) {
    return directAccount;
  }

  const nestedCandidates = [
    record.data,
    record.account,
    record.social_account,
    asRecord(record.data)?.account,
    asRecord(record.data)?.social_account,
    asRecord(record.resource)?.account,
    asRecord(record.resource)?.social_account,
  ];

  for (const candidate of nestedCandidates) {
    const parsed = parsePostForMeWebhookAccountRecord(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function resolvePostForMeAccountDisplayName(
  account: PostForMeSocialAccountRecord,
  fallbackDisplayName: string,
): string {
  return account.name?.trim() || account.username?.trim() || fallbackDisplayName;
}

function resolvePostForMeAccountLoginIdentifier(
  platform: string,
  account: PostForMeSocialAccountRecord,
): string | null {
  const normalizedUsername = account.username?.trim() || null;
  if (!normalizedUsername) {
    return null;
  }

  if (platform === "instagram" || platform === "threads" || platform === "tiktok" || platform === "x") {
    return normalizedUsername.replace(/^@+/, "");
  }

  return normalizedUsername;
}

function doesPostForMeConnectionNeedRenewal(input: {
  platform: string;
  authStatus: string;
  tokenExpiresAt: Date | null;
}, now: Date): boolean {
  if (input.authStatus === "AUTH_REQUIRED") {
    return true;
  }

  if (input.platform === "tiktok") {
    return false;
  }

  return (
    (input.tokenExpiresAt instanceof Date && input.tokenExpiresAt.getTime() <= now.getTime())
  );
}

function resolvePostForMeConnectionAccountLabel(input: {
  loginIdentifier: string | null;
  displayName: string;
}): string {
  const normalizedLoginIdentifier = input.loginIdentifier?.trim() || "";
  if (normalizedLoginIdentifier) {
    return normalizedLoginIdentifier.startsWith("@")
      ? normalizedLoginIdentifier
      : `@${normalizedLoginIdentifier}`;
  }

  return input.displayName;
}

function buildPostForMeRenewalAvisoMessage(input: {
  platform: "instagram" | "facebook" | "threads" | "tiktok" | "x";
  accountLabel: string;
  workspaceName: string;
}): string {
  return (
    `${postForMePlatformNoticeLabel(input.platform)} ${input.accountLabel} expirou e precisa de renovação ` +
    `no workspace ${input.workspaceName}.`
  );
}

type ConnectionRuntimeMetadata = {
  instagramUsername?: string | null;
  instagramUserId?: string | null;
  threadsUsername?: string | null;
  threadsUserId?: string | null;
  whatsappProfileName?: string | null;
  whatsappOwnerJid?: string | null;
};

async function resolveConnectionRuntimeMetadata(connection: {
  id: string;
  companyId: string;
  platform: string;
  provider?: string | null;
  displayName: string;
  loginIdentifier: string | null;
  secretCipher?: string | null;
  authStatus: string;
}): Promise<ConnectionRuntimeMetadata> {
  if (connection.authStatus !== "CONNECTED") {
    return {};
  }

  if (connection.provider === "POST_FOR_ME") {
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

  if (connection.platform === "threads") {
    try {
      const metadata = await withTimeout(
        resolveThreadsConnectionRuntimeMetadata({
          loginIdentifier: connection.loginIdentifier,
          secretCipher: connection.secretCipher ?? null,
        }),
        3_000,
        "THREADS_CONNECTION_METADATA_TIMEOUT",
      );

      return {
        threadsUsername: metadata.threadsUsername,
        threadsUserId: metadata.threadsUserId,
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

async function syncPostForMeConnectionsForBase(input: {
  baseConnectionId: string;
  actorUserId: string;
  providerAccountIdHint?: string | null;
}): Promise<{
  primaryConnection: Prisma.SocialConnectionGetPayload<Record<string, never>>;
  importedConnections: Prisma.SocialConnectionGetPayload<Record<string, never>>[];
  remoteCount: number;
}> {
  const baseConnection = await prisma.socialConnection.findUnique({
    where: { id: input.baseConnectionId },
  });

  if (!baseConnection) {
    throw new Error("POST_FOR_ME_CONNECTION_NOT_FOUND");
  }

  if (!isPostForMeProviderConnection(baseConnection)) {
    throw new Error("POST_FOR_ME_CONNECTION_PROVIDER_INVALID");
  }

  const externalId = resolvePostForMeStoredExternalId(baseConnection);
  if (externalId !== baseConnection.providerExternalId) {
    await prisma.socialConnection.update({
      where: { id: baseConnection.id },
      data: {
        providerExternalId: externalId,
      },
    });
  }

  const remoteAccountsByExternalId = await listPostForMeSocialAccounts({
    platform: baseConnection.platform,
    externalId,
  });
  const normalizedProviderAccountIdHint = input.providerAccountIdHint?.trim() || "";
  let remoteAccounts = remoteAccountsByExternalId;

  if (
    normalizedProviderAccountIdHint &&
    !remoteAccounts.some((account) => account.id === normalizedProviderAccountIdHint)
  ) {
    const remoteAccountsByPlatform = await listPostForMeSocialAccounts({
      platform: baseConnection.platform,
    });
    const hintedRemoteAccount = remoteAccountsByPlatform.find(
      (account) => account.id === normalizedProviderAccountIdHint,
    );

    if (hintedRemoteAccount) {
      const mergedRemoteAccounts = [
        hintedRemoteAccount,
        ...remoteAccounts.filter((account) => account.id !== hintedRemoteAccount.id),
      ];
      remoteAccounts = mergedRemoteAccounts;
    }
  }

  if (remoteAccounts.length === 0) {
    const refreshedBaseConnection = await prisma.socialConnection.update({
      where: { id: baseConnection.id },
      data: {
        providerExternalId: externalId,
        providerStatus: "awaiting_remote_connection",
        authStatus: "AUTH_IN_PROGRESS",
      },
    });
    notifyLiveUpdateForWorkspace(refreshedBaseConnection.companyId, ["connections", "dashboard"]);

    return {
      primaryConnection: refreshedBaseConnection,
      importedConnections: [],
      remoteCount: 0,
    };
  }

  const orderedRemoteAccounts = [...remoteAccounts].sort(
    (left, right) => resolvePostForMeAccountSyncTimestamp(right) - resolvePostForMeAccountSyncTimestamp(left),
  );
  const hintedPrimaryRemoteAccount = normalizedProviderAccountIdHint
    ? orderedRemoteAccounts.find((account) => account.id === normalizedProviderAccountIdHint) ?? null
    : null;
  const replacementCandidates =
    baseConnection.providerAccountId?.trim()
      ? orderedRemoteAccounts.filter((account) => account.id !== baseConnection.providerAccountId)
      : orderedRemoteAccounts;
  const primaryRemoteAccount =
    hintedPrimaryRemoteAccount ??
    replacementCandidates[0] ??
    orderedRemoteAccounts[0] ??
    null;

  if (!primaryRemoteAccount) {
    throw new Error("POST_FOR_ME_REMOTE_ACCOUNT_SELECTION_FAILED");
  }

  const providerMetadata = primaryRemoteAccount.raw as Prisma.InputJsonValue;
  const resolvedRemoteDisplayName = resolvePostForMeAccountDisplayName(primaryRemoteAccount, baseConnection.displayName);
  const sharedConnectionData = {
    loginIdentifier: resolvePostForMeAccountLoginIdentifier(baseConnection.platform, primaryRemoteAccount),
    authStatus: resolvePostForMeConnectionAuthStatus(primaryRemoteAccount.status),
    automationMode: "VISUAL",
    authLaunchUrl: null,
    tokenExpiresAt: parseOptionalDateFromUnknown(primaryRemoteAccount.tokenExpiresAt),
    lastAuthAt: new Date(),
    lastSeenAt: new Date(),
    provider: "POST_FOR_ME",
    providerAccountId: primaryRemoteAccount.id,
    providerExternalId: primaryRemoteAccount.externalId || externalId,
    providerStatus: primaryRemoteAccount.status,
    providerMetadata,
    secretCipher: null,
  } satisfies Omit<Prisma.SocialConnectionUpdateInput, "displayName">;

  const primaryConnection = await prisma.socialConnection.update({
    where: { id: baseConnection.id },
    data: {
      ...sharedConnectionData,
      displayName: baseConnection.displayName?.trim() || resolvedRemoteDisplayName,
    },
  });

  const staleRemoteAccounts = orderedRemoteAccounts.filter((account) => account.id !== primaryRemoteAccount.id);
  for (const staleRemoteAccount of staleRemoteAccounts) {
    try {
      await disconnectPostForMeSocialAccount(staleRemoteAccount.id);
    } catch {
      // Melhor esforço: não bloqueia a religação da conta principal.
    }
  }

  await prisma.socialConnection.deleteMany({
    where: {
      companyId: baseConnection.companyId,
      platform: baseConnection.platform,
      provider: "POST_FOR_ME",
      id: { not: baseConnection.id },
    },
  });
  notifyLiveUpdateForWorkspace(primaryConnection.companyId, ["connections", "dashboard"]);

  return {
    primaryConnection,
    importedConnections: [],
    remoteCount: remoteAccounts.length,
  };
}

async function shouldDisconnectPostForMeSocialAccountRemotely(input: {
  providerAccountId: string;
  excludeConnectionIds?: string[];
}): Promise<boolean> {
  const providerAccountId = input.providerAccountId.trim();
  if (!providerAccountId) {
    return false;
  }

  const otherConnectionsCount = await prisma.socialConnection.count({
    where: {
      provider: "POST_FOR_ME",
      providerAccountId,
      ...(input.excludeConnectionIds?.length
        ? {
            id: {
              notIn: input.excludeConnectionIds,
            },
          }
        : {}),
    },
  });

  return otherConnectionsCount === 0;
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
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Promise<typeof connection> {
  if (connection.platform !== "whatsapp") {
    return connection;
  }

  const now = new Date();
  const overlay = getWhatsappConnectionOverlay(connection.id) as {
    qrStatus?: unknown;
    workerLastSeenAt?: unknown;
  };
  const overlayQrStatus = typeof overlay.qrStatus === "string" ? overlay.qrStatus : null;
  const overlayWorkerLastSeenAt =
    overlay.workerLastSeenAt instanceof Date ? overlay.workerLastSeenAt : null;
  const hasRecentConnectedOverlay =
    overlayQrStatus === "CONNECTED" &&
    overlayWorkerLastSeenAt !== null &&
    now.getTime() - overlayWorkerLastSeenAt.getTime() < 2 * 60 * 1000;
  const hasRecentLastAuthAt =
    connection.lastAuthAt instanceof Date && now.getTime() - connection.lastAuthAt.getTime() < 2 * 60 * 1000;

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

  if (connection.authStatus === "AUTH_REQUIRED") {
    return connection;
  }

  if (
    connection.authStatus === "CONNECTED" &&
    runtimeAuthStatus !== "CONNECTED" &&
    (hasRecentConnectedOverlay || hasRecentLastAuthAt)
  ) {
    return connection;
  }

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
  notifyLiveUpdateForWorkspace(updatedConnection.companyId, ["connections", "dashboard"]);

  return updatedConnection;
}

async function handlePostForMeAccountWebhook(payload: unknown): Promise<{
  processed: boolean;
  connectionId?: string;
  companyId?: string;
}> {
  const eventRecord = asRecord(payload);
  const eventType = normalizePostForMeWebhookEventType(
    eventRecord?.event_type || eventRecord?.eventType || eventRecord?.type,
  );
  if (eventType !== "social.account.updated" && eventType !== "social.account.created") {
    return { processed: false };
  }

  const account = resolvePostForMeWebhookAccountPayload(payload);
  if (!account || !account.platform) {
    return { processed: false };
  }

  const connections = await prisma.socialConnection.findMany({
    where: {
      provider: "POST_FOR_ME",
      platform: account.platform,
      OR: [
        { providerAccountId: account.id },
        ...(account.externalId ? [{ providerExternalId: account.externalId }] : []),
      ],
    },
    select: {
      id: true,
      companyId: true,
      platform: true,
      displayName: true,
      loginIdentifier: true,
      authStatus: true,
      tokenExpiresAt: true,
      providerStatus: true,
      company: {
        select: {
          name: true,
        },
      },
    },
  });

  if (connections.length === 0) {
    return { processed: false };
  }

  const nextAuthStatus = resolvePostForMeConnectionAuthStatus(account.status);
  const now = new Date();
  const nextTokenExpiresAt = account.tokenExpiresAt;
  let firstProcessedConnectionId: string | undefined;
  let firstProcessedCompanyId: string | undefined;
  const notifiedWorkspaceIds = new Set<string>();

  for (const connection of connections) {
    const nextRenewalRequired = doesPostForMeConnectionNeedRenewal(
      { platform: connection.platform, authStatus: nextAuthStatus, tokenExpiresAt: nextTokenExpiresAt },
      now,
    );
    const previousRenewalRequired = doesPostForMeConnectionNeedRenewal(
      { platform: connection.platform, authStatus: connection.authStatus, tokenExpiresAt: connection.tokenExpiresAt },
      now,
    );

    const normalizedLoginIdentifier =
      resolvePostForMeAccountLoginIdentifier(account.platform, {
        id: account.id,
        platform: account.platform,
        name: account.name,
        username: account.username,
        status: account.status,
        externalId: account.externalId,
        tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
        raw: account.raw,
      }) ?? connection.loginIdentifier;
    const accountLabel = resolvePostForMeConnectionAccountLabel({
      loginIdentifier: normalizedLoginIdentifier,
      displayName: connection.displayName,
    });

    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        loginIdentifier: normalizedLoginIdentifier,
        authStatus: nextAuthStatus,
        authLaunchUrl: nextRenewalRequired ? defaultAuthLaunchUrlForPlatform(connection.platform) : null,
        tokenExpiresAt: nextTokenExpiresAt,
        lastSeenAt: nextRenewalRequired ? null : now,
        lastAuthAt:
          nextAuthStatus === "CONNECTED" && connection.authStatus !== "CONNECTED"
            ? now
            : undefined,
        providerAccountId: account.id,
        providerExternalId: account.externalId ?? undefined,
        providerStatus: account.status,
        providerMetadata: account.raw as Prisma.InputJsonValue,
      },
    });

    await appendLog({
      companyId: connection.companyId,
      level: nextRenewalRequired ? "WARN" : "INFO",
      errorCode: "POST_FOR_ME_ACCOUNT_WEBHOOK_SYNC",
      message:
        `Conta ${connection.displayName} (${postForMePlatformNoticeLabel(account.platform)}) ` +
        `atualizada via webhook do Post for Me: ${connection.authStatus} -> ${nextAuthStatus}.`,
    });

    if (!previousRenewalRequired && nextRenewalRequired) {
      await appendWorkspaceAvisoSafely({
        companyId: connection.companyId,
        kind: "SYSTEM",
        title: "Conta precisa de renovação",
        message: buildPostForMeRenewalAvisoMessage({
          platform: account.platform,
          accountLabel,
          workspaceName: connection.company.name,
        }),
        dedupeWindowMs: POST_FOR_ME_RENEWAL_AVISO_DEDUPE_WINDOW_MS,
      });
    }

    if (!notifiedWorkspaceIds.has(connection.companyId)) {
      notifyLiveUpdateForWorkspace(connection.companyId, ["connections", "dashboard", "avisos"]);
      notifiedWorkspaceIds.add(connection.companyId);
    }

    if (!firstProcessedConnectionId) {
      firstProcessedConnectionId = connection.id;
      firstProcessedCompanyId = connection.companyId;
    }
  }

  return {
    processed: true,
    connectionId: firstProcessedConnectionId,
    companyId: firstProcessedCompanyId,
  };
}

async function backfillPostForMeRenewalAvisos(): Promise<{
  connectionsNeedingRenewal: number;
  avisosCreated: number;
  connectionsUpdated: number;
}> {
  const now = new Date();
  const connections = await prisma.socialConnection.findMany({
    where: {
      provider: "POST_FOR_ME",
      OR: [
        { authStatus: "AUTH_REQUIRED" },
        { tokenExpiresAt: { lte: now } },
      ],
    },
    select: {
      id: true,
      companyId: true,
      platform: true,
      displayName: true,
      loginIdentifier: true,
      authStatus: true,
      tokenExpiresAt: true,
      authLaunchUrl: true,
      company: {
        select: {
          name: true,
        },
      },
    },
  });

  let connectionsNeedingRenewal = 0;
  let avisosCreated = 0;
  let connectionsUpdated = 0;

  for (const connection of connections) {
    if (!isPostForMeManagedPlatform(connection.platform)) {
      continue;
    }

    if (!doesPostForMeConnectionNeedRenewal(connection, now)) {
      continue;
    }

    connectionsNeedingRenewal += 1;

    let updatedThisConnection = false;
    if (!connection.authLaunchUrl) {
      const defaultLaunchUrl = defaultAuthLaunchUrlForPlatform(connection.platform);
      if (defaultLaunchUrl) {
        await prisma.socialConnection.update({
          where: { id: connection.id },
          data: {
            authLaunchUrl: defaultLaunchUrl,
          },
        });
        connectionsUpdated += 1;
        updatedThisConnection = true;
      }
    }

    const accountLabel = resolvePostForMeConnectionAccountLabel({
      loginIdentifier: connection.loginIdentifier,
      displayName: connection.displayName,
    });

    const appended = await appendWorkspaceAvisoSafely({
      companyId: connection.companyId,
      kind: "SYSTEM",
      title: "Conta precisa de renovação",
      message: buildPostForMeRenewalAvisoMessage({
        platform: connection.platform,
        accountLabel,
        workspaceName: connection.company.name,
      }),
      dedupeWindowMs: POST_FOR_ME_RENEWAL_AVISO_DEDUPE_WINDOW_MS,
    });
    avisosCreated += appended.createdCount;

    if (updatedThisConnection || appended.createdCount > 0) {
      notifyLiveUpdateForWorkspace(connection.companyId, ["connections", "dashboard", "avisos"]);
    }
  }

  return {
    connectionsNeedingRenewal,
    avisosCreated,
    connectionsUpdated,
  };
}

async function waitForWhatsappRuntimeConnected(input: {
  id: string;
  companyId: string;
  displayName: string;
  platform: string;
  loginIdentifier: string | null;
  secretCipher?: string | null;
}, timeoutMs: number = 8_000, delayMs: number = 1_000): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const runtimeAuthStatus = await resolveWhatsappConnectionRuntimeAuthStatus({
      id: input.id,
      companyId: input.companyId,
      displayName: input.displayName,
      platform: input.platform,
      loginIdentifier: input.loginIdentifier,
      secretCipher: input.secretCipher ?? null,
    }).catch(() => null);

    if (runtimeAuthStatus === "CONNECTED") {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return false;
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

type LiveUpdateScope = "jobs" | "dashboard" | "avisos" | "connections" | "companies" | "logs";

type LiveEventClient = {
  response: Response;
  heartbeatIntervalId: ReturnType<typeof setInterval>;
};

const liveEventClientsByUserId = new Map<string, Map<string, LiveEventClient>>();

function normalizeLiveUpdateScopes(scopes: LiveUpdateScope[]): LiveUpdateScope[] {
  return Array.from(new Set(scopes));
}

function writeLiveEvent(response: Response, payload: Record<string, unknown>): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function registerLiveEventClient(userId: string, clientId: string, client: LiveEventClient): void {
  const userClients = liveEventClientsByUserId.get(userId) ?? new Map<string, LiveEventClient>();
  userClients.set(clientId, client);
  liveEventClientsByUserId.set(userId, userClients);
}

function unregisterLiveEventClient(userId: string, clientId: string): void {
  const userClients = liveEventClientsByUserId.get(userId);
  if (!userClients) {
    return;
  }

  const client = userClients.get(clientId);
  if (client) {
    clearInterval(client.heartbeatIntervalId);
  }

  userClients.delete(clientId);
  if (userClients.size === 0) {
    liveEventClientsByUserId.delete(userId);
  }
}

function emitLiveUpdateToUser(userId: string, scopes: LiveUpdateScope[], companyId?: string | null): void {
  const userClients = liveEventClientsByUserId.get(userId);
  if (!userClients || userClients.size === 0) {
    return;
  }

  const normalizedScopes = normalizeLiveUpdateScopes(scopes);
  const payload = {
    type: "update",
    scopes: normalizedScopes,
    companyId: companyId ?? null,
    issuedAt: new Date().toISOString(),
  } satisfies Record<string, unknown>;

  for (const [clientId, client] of userClients.entries()) {
    try {
      writeLiveEvent(client.response, payload);
    } catch {
      unregisterLiveEventClient(userId, clientId);
    }
  }
}

async function resolveLiveUpdateRecipientUserIdsForWorkspace(companyId: string): Promise<string[]> {
  const [workspace, rootUsers] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        createdByUserId: true,
        members: {
          select: {
            userId: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        role: "ROOT",
      },
      select: {
        id: true,
      },
    }),
  ]);

  const userIds = new Set<string>();
  const ownerUserId = workspace?.createdByUserId?.trim() || "";
  if (ownerUserId) {
    userIds.add(ownerUserId);
  }

  for (const member of workspace?.members ?? []) {
    const memberUserId = member.userId.trim();
    if (memberUserId) {
      userIds.add(memberUserId);
    }
  }

  for (const rootUser of rootUsers) {
    const rootUserId = rootUser.id.trim();
    if (rootUserId) {
      userIds.add(rootUserId);
    }
  }

  return [...userIds];
}

function notifyLiveUpdateForUser(userId: string, scopes: LiveUpdateScope[], companyId?: string | null): void {
  emitLiveUpdateToUser(userId, scopes, companyId);
}

function notifyLiveUpdateForUsers(userIds: string[], scopes: LiveUpdateScope[], companyId?: string | null): void {
  const normalizedUserIds = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
  if (normalizedUserIds.length === 0) {
    return;
  }

  for (const userId of normalizedUserIds) {
    notifyLiveUpdateForUser(userId, scopes, companyId);
  }
}

function notifyLiveUpdateForWorkspace(companyId: string, scopes: LiveUpdateScope[]): void {
  if (liveEventClientsByUserId.size === 0) {
    return;
  }

  void resolveLiveUpdateRecipientUserIdsForWorkspace(companyId)
    .then((userIds) => {
      notifyLiveUpdateForUsers(userIds, scopes, companyId);
    })
    .catch((error) => {
      console.error("Failed to resolve live update recipients for workspace", error);
    });
}

async function appendLog(input: {
  companyId: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  errorCode?: string | null;
  screenshotPath?: string | null;
}): Promise<void> {
  void appendLogToFiles(input);
  await prisma.agentLog.create({
    data: {
      companyId: input.companyId,
      level: input.level,
      errorCode: input.errorCode,
      message: input.message,
      screenshotPath: input.screenshotPath,
    },
  });
  notifyLiveUpdateForWorkspace(input.companyId, ["logs"]);
}

function shouldMirrorToDeliveryEventFile(input: {
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  errorCode?: string | null;
}): boolean {
  const normalizedCode = (input.errorCode || "").trim().toUpperCase();
  const normalizedMessage = input.message.trim().toUpperCase();
  if (
    normalizedCode.startsWith("INSTAGRAM") ||
    normalizedCode.startsWith("THREADS") ||
    normalizedCode.startsWith("WHATSAPP") ||
    normalizedCode.startsWith("LOGIN_REQUIRED")
  ) {
    return true;
  }

  return (
    normalizedMessage.includes("INSTAGRAM") ||
    normalizedMessage.includes("THREADS") ||
    normalizedMessage.includes("WHATSAPP") ||
    normalizedMessage.includes("AUTENTICA") ||
    normalizedMessage.includes("LOGIN") ||
    normalizedMessage.includes("TOKEN") ||
    normalizedMessage.includes("JOB ")
  );
}

async function appendLogToFiles(input: {
  companyId: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  errorCode?: string | null;
  screenshotPath?: string | null;
}): Promise<void> {
  try {
    await mkdir(runtimeLogsDir, { recursive: true });
    const serializedLine =
      JSON.stringify({
        createdAt: new Date().toISOString(),
        companyId: input.companyId,
        level: input.level,
        errorCode: input.errorCode ?? null,
        message: input.message,
        screenshotPath: input.screenshotPath ?? null,
      }) + "\n";

    await appendFile(agentEventLogFilePath, serializedLine, "utf8");
    if (shouldMirrorToDeliveryEventFile(input)) {
      await appendFile(deliveryEventLogFilePath, serializedLine, "utf8");
    }
  } catch (error) {
    console.error("Failed to append runtime log file", error);
  }
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
  notifyLiveUpdateForUser(input.userId, ["avisos"]);
}

async function appendWorkspaceAvisoSafely(input: {
  companyId: string;
  title: string;
  message: string;
  kind?: string;
  dedupeWindowMs?: number;
}): Promise<{ createdCount: number }> {
  try {
    const userIds = await resolveLiveUpdateRecipientUserIdsForWorkspace(input.companyId);
    const normalizedUserIds = [...new Set(userIds.map((entry) => entry.trim()).filter(Boolean))];
    if (normalizedUserIds.length === 0) {
      return { createdCount: 0 };
    }

    let targetUserIds = normalizedUserIds;
    if ((input.dedupeWindowMs ?? 0) > 0) {
      const existingAvisos = await prisma.aviso.findMany({
        where: {
          userId: { in: normalizedUserIds },
          title: input.title,
          message: input.message,
          createdAt: {
            gte: new Date(Date.now() - (input.dedupeWindowMs ?? 0)),
          },
        },
        select: {
          userId: true,
        },
      });
      const existingUserIds = new Set(existingAvisos.map((entry) => entry.userId));
      targetUserIds = normalizedUserIds.filter((userId) => !existingUserIds.has(userId));
    }

    if (targetUserIds.length === 0) {
      return { createdCount: 0 };
    }

    await prisma.aviso.createMany({
      data: targetUserIds.map((userId) => ({
        userId,
        title: input.title,
        message: input.message,
        kind: input.kind ?? "SYSTEM",
        createdByUserId: null,
      })),
    });

    notifyLiveUpdateForUsers(targetUserIds, ["avisos"], input.companyId);
    return { createdCount: targetUserIds.length };
  } catch (error) {
    console.error("Failed to append workspace aviso", error);
    return { createdCount: 0 };
  }
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
    companyId?: string | null;
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
    const companyId = job.companyId?.trim() || "";
    if (companyId) {
      notifyLiveUpdateForWorkspace(companyId, ["jobs", "dashboard"]);
    }
  } catch (error) {
    console.error("Failed to append job aviso", error);
  }
}

function resolveWhatsappOwnerNumberFromJid(ownerJid: string | null | undefined): string | null {
  const raw = ownerJid?.trim() || "";
  if (!raw) {
    return null;
  }

  const base = raw.split("@")[0]?.trim() || "";
  if (!base) {
    return null;
  }

  const digits = base.replace(/\D+/g, "");
  return digits || base;
}

async function resolveWhatsappConnectionNoticeLabel(connection: {
  id: string;
  companyId: string;
  displayName: string;
  platform: string;
  loginIdentifier: string | null;
  secretCipher: string | null;
}): Promise<string> {
  try {
    const metadata = await resolveWhatsappConnectionRuntimeMetadata({
      id: connection.id,
      companyId: connection.companyId,
      displayName: connection.displayName,
      platform: connection.platform,
      loginIdentifier: connection.loginIdentifier,
      secretCipher: connection.secretCipher,
    });

    const ownerNumber = resolveWhatsappOwnerNumberFromJid(metadata.ownerJid);
    if (ownerNumber) {
      return ownerNumber;
    }

    const profileName = metadata.profileName?.trim() || "";
    if (profileName) {
      return profileName;
    }
  } catch {
    // Melhor esforço: cai no nome visual da conta.
  }

  return connection.displayName.trim() || "conta do WhatsApp";
}

async function appendWhatsappRelinkChildAviso(
  parentJobId: string,
  connection: {
    id: string;
    companyId: string;
    displayName: string;
    platform: string;
    loginIdentifier: string | null;
    secretCipher: string | null;
  },
  input: {
    title: string;
    kind: string;
    messageForAccount: (accountLabel: string) => string;
  },
): Promise<void> {
  const parentJob = await prisma.job.findUnique({
    where: { id: parentJobId },
    select: {
      id: true,
      createdByUserId: true,
      title: true,
      caption: true,
      publicationType: true,
      postStory: true,
      postReel: true,
      postWhatsapp: true,
      modoWhatsapp: true,
    },
  });

  if (!parentJob?.createdByUserId) {
    return;
  }

  const accountLabel = await resolveWhatsappConnectionNoticeLabel(connection);
  await appendJobAvisoSafely(parentJob, {
    title: input.title,
    kind: input.kind,
    message: input.messageForAccount(accountLabel),
  });
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

async function failJobDueToUnhandledConsumerCrash(
  queueMessage: JobExecutionQueueMessage,
  job:
    | {
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
      }
    | null,
  error: unknown,
): Promise<"ack" | "requeue"> {
  console.error("RabbitMQ consumer handler failed", error);

  if (!job) {
    return "requeue";
  }

  const rawMessage = error instanceof Error ? error.message : "Erro inesperado no consumidor RabbitMQ.";
  const update = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: {
        in: ["PENDING", "WAITING_LOGIN", "RUNNING", "SENT_UNCONFIRMED"],
      },
    },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      lastError: rawMessage,
    },
  });

  if (update.count === 0) {
    return "ack";
  }

  await appendLog({
    companyId: job.companyId,
    level: "ERROR",
    errorCode: "RABBITMQ_CONSUMER_UNHANDLED_ERROR",
    message:
      `Job ${job.id} falhou por erro inesperado no consumidor RabbitMQ (${queueMessage.platform}). ` +
      `Erro: ${rawMessage}`,
  });

  await appendJobAvisoSafely(job, {
    title: "Falha no agendamento",
    kind: "JOB_FAILED",
    message: summarizeFailureMessageForAviso(normalizePublicationType(job), rawMessage),
  });

  return "ack";
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

  if (publicationType === "tiktok_post") {
    return "Falha ao publicar no TikTok. Revise o vídeo e tente novamente.";
  }

  if (publicationType === "x_post") {
    return "Falha ao publicar no X. Revise o texto, a mídia e tente novamente.";
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

function postForMeWhatsappRelinkLockKey(jobId: string): string {
  return `job:postforme:whatsapp-relink:${jobId}`;
}

const WHATSAPP_RELINK_PARENT_MARKER_PREFIX = "__wa_relink_parent__:";
const POST_FOR_ME_INSTAGRAM_CONFIRMED_MARKER_PREFIX = "__pfm_instagram_confirmed__:";

function buildWhatsappRelinkParentMarker(parentJobId: string): string {
  return `${WHATSAPP_RELINK_PARENT_MARKER_PREFIX}${parentJobId}`;
}

function parseWhatsappRelinkParentMarker(value: string | null | undefined): string | null {
  const normalized = value?.trim() || "";
  if (!normalized.startsWith(WHATSAPP_RELINK_PARENT_MARKER_PREFIX)) {
    return null;
  }

  const parentJobId = normalized.slice(WHATSAPP_RELINK_PARENT_MARKER_PREFIX.length).trim();
  return parentJobId || null;
}

function hasPostForMeInstagramConfirmedMarker(value: string | null | undefined): boolean {
  return (value?.trim() || "").startsWith(POST_FOR_ME_INSTAGRAM_CONFIRMED_MARKER_PREFIX);
}

function buildPostForMeInstagramConfirmedMarker(nowMs: number): string {
  return `${POST_FOR_ME_INSTAGRAM_CONFIRMED_MARKER_PREFIX}${nowMs}`;
}

function parsePostForMeInstagramConfirmedMarkerMs(value: string | null | undefined): number | null {
  const normalized = value?.trim() || "";
  if (!normalized.startsWith(POST_FOR_ME_INSTAGRAM_CONFIRMED_MARKER_PREFIX)) {
    return null;
  }

  const raw = normalized.slice(POST_FOR_ME_INSTAGRAM_CONFIRMED_MARKER_PREFIX.length).trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isOfficialMetaPermalink(url: string | null | undefined): boolean {
  const normalized = url?.trim() || "";
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "instagram.com" ||
      hostname === "www.instagram.com" ||
      hostname === "instagr.am" ||
      hostname === "threads.net" ||
      hostname === "www.threads.net" ||
      hostname === "x.com" ||
      hostname === "www.x.com" ||
      hostname === "twitter.com" ||
      hostname === "www.twitter.com" ||
      hostname === "tiktok.com" ||
      hostname === "www.tiktok.com" ||
      hostname === "m.tiktok.com" ||
      hostname === "vm.tiktok.com"
    );
  } catch {
    return false;
  }
}

function postForMePublishedAvisoTitleForPublicationType(publicationType: PublicationType): string {
  switch (publicationType) {
    case "threads_post":
      return "Threads publicado";
    case "facebook_post":
      return "Facebook publicado";
    case "tiktok_post":
      return "TikTok publicado";
    case "x_post":
      return "X publicado";
    case "instagram_post":
    case "instagram_reel":
    case "instagram_story":
    default:
      return "Instagram publicado";
  }
}

async function appendMetaPublishedAvisoOnce(job: {
  id: string;
  createdByUserId: string | null;
  title?: string | null;
  caption: string | null;
  publicationType?: string | null;
  postStory?: boolean;
  postReel?: boolean;
  postWhatsapp?: boolean;
  modoWhatsapp?: string | null;
  lastError?: string | null;
}): Promise<boolean> {
  const marker = buildPostForMeInstagramConfirmedMarker(Date.now());

  const update = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: "RUNNING",
      OR: [
        {
          lastError: null,
        },
        {
          NOT: {
            lastError: {
              startsWith: POST_FOR_ME_INSTAGRAM_CONFIRMED_MARKER_PREFIX,
            },
          },
        },
      ],
    },
    data: {
      lastError: marker,
    },
  });

  if (update.count === 0) {
    return false;
  }

  await appendJobAvisoSafely(job, {
    title: postForMePublishedAvisoTitleForPublicationType(normalizePublicationType(job)),
    kind: "JOB_SENT",
    message: "Publicacao concluida com sucesso.",
  });

  return true;
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
    case "tiktok_post":
      return {
        label: "TikTok",
        frameWidth: 292,
        frameHeight: 520,
        accentStart: "#0f172a",
        accentEnd: "#111827",
      };
    case "x_post":
      return {
        label: "X",
        frameWidth: 360,
        frameHeight: 450,
        accentStart: "#1f2937",
        accentEnd: "#0f172a",
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

function renderInstagramSharePendingPage(input: {
  shareUrl: string;
  previewTitle: string;
  previewDescription: string;
  previewImageUrl: string | null;
}): string {
  const shareUrl = escapeHtml(input.shareUrl);
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
    <meta http-equiv="refresh" content="4; url=${shareUrl}" />
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
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
        width: min(100%, 440px);
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid #e5e7eb;
        border-radius: 20px;
        padding: 28px 24px;
        text-align: center;
        box-shadow: 0 24px 48px rgba(15, 23, 42, 0.08);
      }
      h1 { margin: 0 0 8px; font-size: 1.05rem; font-weight: 600; }
      p { margin: 0; color: #4b5563; }
      a { color: #111827; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>${previewTitle}</h1>
      <p>Esta publicação do Instagram ainda está sendo finalizada.</p>
      <p style="margin-top: 10px;">Vamos tentar abrir novamente em alguns segundos.</p>
      <p style="margin-top: 14px;"><a href="${shareUrl}">Atualizar agora</a></p>
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

  if (input.publicationType === "instagram_story" || input.publicationType === "tiktok_post") {
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
}): Promise<boolean> {
  const publicationType = normalizePublicationType(input.job);
  if (
    !supportsWhatsappRelink(publicationType) ||
    !supportsWhatsappRelinkForJobMedia(publicationType, input.job.filePath)
  ) {
    return false;
  }

  if (!input.job.whatsappRelinkEnabled || input.job.whatsappRelinkDispatchedAt) {
    return false;
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
    return false;
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
    return false;
  }

  return dispatchWhatsappRelinkJobsForInstagramPermalink({
    job: input.job,
    permalink,
  });
}

async function dispatchWhatsappRelinkJobsForInstagramPermalink(input: {
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
  permalink: string;
}): Promise<boolean> {
  const publicationType = normalizePublicationType(input.job);
  if (
    !supportsWhatsappRelink(publicationType) ||
    !supportsWhatsappRelinkForJobMedia(publicationType, input.job.filePath)
  ) {
    return false;
  }

  if (!input.job.whatsappRelinkEnabled || input.job.whatsappRelinkDispatchedAt) {
    return false;
  }

  const configuredConnectionIds = parseStoredWhatsappRelinkConnectionIds(input.job.whatsappRelinkConnectionIds);
  if (configuredConnectionIds.length === 0) {
    return false;
  }

  const permalink = input.permalink.trim();
  if (!permalink) {
    return false;
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
    return false;
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
    return false;
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
  const relinkParentMarker = buildWhatsappRelinkParentMarker(input.job.id);
  const relinkOriginLabel =
    publicationType === "threads_post"
      ? "Relink Threads"
      : publicationType === "x_post"
        ? "Relink X"
        : publicationType === "tiktok_post"
          ? "Relink TikTok"
          : "Relink Instagram";
  const now = new Date();
  for (const whatsappConnection of targetConnectionsInOrder) {
    await prisma.job.create({
      data: {
        companyId: whatsappConnection.companyId,
        createdByUserId: input.job.createdByUserId,
        socialConnectionId: whatsappConnection.id,
        filePath: relinkSourceFilePath,
        title: input.job.title ? `${input.job.title} (Relink)` : relinkOriginLabel,
        caption: relinkText,
        firstComment: null,
        locationName: relinkParentMarker,
        whatsappBackgroundColor: null,
        publicationType: "whatsapp_status_midia",
        publicationState: "PUBLISHED",
        postStory: false,
        postReel: false,
        postWhatsapp: true,
        modoWhatsapp: "midia",
        dataPostagem: now,
      },
    });
  }

  await prisma.job.update({
    where: { id: input.job.id },
    data: {
      whatsappRelinkDispatchedAt: now,
      instagramPermalink: isOfficialMetaPermalink(permalink) ? permalink : undefined,
    },
  });

  await appendLog({
    companyId: input.job.companyId,
    level: "INFO",
    message:
      `Job ${input.job.id} criou ${targetConnectionsInOrder.length} status de relink no WhatsApp ` +
      `com permalink ${permalink}.`,
  });

  return true;
}

async function finalizeWhatsappRelinkParentJob(
  parentJob: {
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
    status: "COMPLETED" | "FAILED";
    title: string;
    kind: string;
    message: string;
    lastError: string | null;
    emitAviso?: boolean;
  },
): Promise<boolean> {
  const update = await prisma.job.updateMany({
    where: {
      id: parentJob.id,
      completedAt: null,
    },
    data: {
      status: input.status,
      completedAt: new Date(),
      lastError: input.lastError,
    },
  });

  if (update.count === 0) {
    return false;
  }

  if (input.emitAviso !== false) {
    await appendJobAvisoSafely(parentJob, {
      title: input.title,
      kind: input.kind,
      message: input.message,
    });
  }
  return true;
}

async function syncWhatsappRelinkParentJobOutcome(parentJobId: string): Promise<boolean> {
  const parentJob = await prisma.job.findUnique({
    where: { id: parentJobId },
    select: {
      id: true,
      createdByUserId: true,
      title: true,
      caption: true,
      publicationType: true,
      postStory: true,
      postReel: true,
      postWhatsapp: true,
      modoWhatsapp: true,
      whatsappRelinkEnabled: true,
      whatsappRelinkConnectionIds: true,
      whatsappRelinkDispatchedAt: true,
      completedAt: true,
    },
  });

  if (!parentJob || !parentJob.whatsappRelinkEnabled || !parentJob.whatsappRelinkDispatchedAt) {
    return false;
  }

  const configuredConnectionIds = parseStoredWhatsappRelinkConnectionIds(parentJob.whatsappRelinkConnectionIds);
  if (configuredConnectionIds.length === 0) {
    return false;
  }

  const childJobs = await prisma.job.findMany({
    where: {
      locationName: buildWhatsappRelinkParentMarker(parentJobId),
      publicationState: "PUBLISHED",
    },
    select: {
      id: true,
      status: true,
      lastError: true,
    },
  });

  if (childJobs.length < configuredConnectionIds.length) {
    return false;
  }

  const allResolved = childJobs.every((job) =>
    job.status === "COMPLETED" || job.status === "FAILED" || job.status === "WAITING_LOGIN" || job.status === "CANCELED",
  );
  if (!allResolved) {
    return false;
  }

  const hasCompletedChild = childJobs.some((job) => job.status === "COMPLETED");
  const failedChildJob = childJobs.find((job) =>
    job.status === "FAILED" || job.status === "WAITING_LOGIN" || job.status === "CANCELED",
  );
  if (failedChildJob) {
    return finalizeWhatsappRelinkParentJob(parentJob, {
      status: "COMPLETED",
      title: "Relink concluído",
      kind: "JOB_SENT",
      message: hasCompletedChild
        ? `O relink foi concluído para parte das contas de WhatsApp.`
        : `O relink foi encerrado com pendências nas contas de WhatsApp.`,
      lastError: failedChildJob.lastError?.trim() || "WHATSAPP_RELINK_INCOMPLETE",
      emitAviso: false,
    });
  }

  const allCompleted = childJobs.every((job) => job.status === "COMPLETED");
  if (!allCompleted) {
    return false;
  }

  return finalizeWhatsappRelinkParentJob(parentJob, {
    status: "COMPLETED",
    title: "Relink postado no WhatsApp",
    kind: "JOB_SENT",
    message: `A publicação foi repostada em ${configuredConnectionIds.length} conta(s) de WhatsApp.`,
    lastError: null,
    emitAviso: false,
  });
}

function extractPostForMePlatformUrlFromResults(
  results: PostForMeSocialPostResultRecord[],
  platform: PostForMePlatform,
): string | null {
  for (const result of results) {
    const platformDataUrl = result.platformDataUrl?.trim() || "";
    if (platformDataUrl) {
      return platformDataUrl;
    }

    for (const platformPost of result.platformPosts) {
      if (platformPost.platform !== platform) {
        continue;
      }

      const platformUrl = platformPost.platformUrl?.trim() || "";
      if (platformUrl) {
        return platformUrl;
      }
    }
  }

  return null;
}

function collectPostForMeUrlCandidates(record: Record<string, unknown> | null | undefined): string[] {
  if (!record) {
    return [];
  }

  const platformDataRecord =
    record.platform_data && typeof record.platform_data === "object" && !Array.isArray(record.platform_data)
      ? (record.platform_data as Record<string, unknown>)
      : null;

  const candidates = [
    record.platform_url,
    record.platformUrl,
    record.url,
    record.permalink,
    record.short_url,
    record.shortUrl,
    record.share_url,
    record.shareUrl,
    record.link,
    record.post_url,
    record.postUrl,
    platformDataRecord?.url,
    platformDataRecord?.platform_url,
    platformDataRecord?.platformUrl,
    platformDataRecord?.permalink,
    platformDataRecord?.share_url,
    platformDataRecord?.shareUrl,
    platformDataRecord?.link,
    asRecord(record.details)?.url,
    asRecord(record.details)?.platform_url,
    asRecord(record.details)?.platformUrl,
    asRecord(record.details)?.permalink,
    asRecord(record.details)?.share_url,
    asRecord(record.details)?.shareUrl,
    asRecord(record.details)?.link,
  ];

  const normalized = candidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => /^https?:\/\//i.test(value));

  return Array.from(new Set(normalized));
}

function collectPostForMeCaptionCandidates(record: Record<string, unknown> | null | undefined): string[] {
  if (!record) {
    return [];
  }

  const platformDataRecord =
    record.platform_data && typeof record.platform_data === "object" && !Array.isArray(record.platform_data)
      ? (record.platform_data as Record<string, unknown>)
      : null;
  const detailsRecord =
    record.details && typeof record.details === "object" && !Array.isArray(record.details)
      ? (record.details as Record<string, unknown>)
      : null;

  const candidates = [
    record.caption,
    record.text,
    record.body,
    record.content,
    platformDataRecord?.caption,
    platformDataRecord?.text,
    platformDataRecord?.body,
    platformDataRecord?.content,
    detailsRecord?.caption,
    detailsRecord?.text,
    detailsRecord?.body,
    detailsRecord?.content,
  ];

  const normalized = candidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  return Array.from(new Set(normalized));
}

function extractPostForMeSocialAccountIdFromProviderPost(record: Record<string, unknown> | null | undefined): string | null {
  if (!record) {
    return null;
  }

  const socialAccounts = Array.isArray(record.social_accounts) ? record.social_accounts : [];
  for (const entry of socialAccounts) {
    const entryRecord = asRecord(entry);
    const id = typeof entryRecord?.id === "string" ? entryRecord.id.trim() : "";
    if (id) {
      return id;
    }
  }

  return null;
}

function extractPostForMePlatformUrlFromAccountFeed(
  records: PostForMeSocialAccountFeedRecord[],
  platform: PostForMePlatform,
): string | null {
  for (const record of records) {
    if (record.platform !== platform) {
      continue;
    }

    const platformUrl = record.platformUrl?.trim() || "";
    if (platformUrl) {
      return platformUrl;
    }
  }

  return null;
}

function isPostForMeProcessedApplicationLimitFalseNegative(input: {
  postStatus: string | null;
  providerError: string | null;
  hasFailedResult: boolean;
  hasSuccessfulResult: boolean;
}): boolean {
  if (!isPostForMeSocialPostProcessed(input.postStatus)) {
    return false;
  }

  if (input.hasSuccessfulResult || !input.hasFailedResult) {
    return false;
  }

  const normalizedError = input.providerError?.trim().toLowerCase() || "";
  if (!normalizedError) {
    return false;
  }

  return normalizedError.includes("application request limit reached");
}

function isPostForMeProcessedTikTokFalseNegative(input: {
  platform: PostForMePlatform;
  postStatus: string | null;
  providerError: string | null;
  hasFailedResult: boolean;
  hasSuccessfulResult: boolean;
  providerPlatformPostId: string | null;
  platformUrl: string | null;
}): boolean {
  if (input.platform !== "tiktok" || input.hasSuccessfulResult || !input.hasFailedResult) {
    return false;
  }

  const normalizedError = input.providerError?.trim().toLowerCase() || "";
  if (!normalizedError.startsWith("failed to post to tiktok")) {
    return false;
  }

  return (
    Boolean(input.providerPlatformPostId?.trim()) ||
    Boolean(input.platformUrl?.trim()) ||
    isPostForMeSocialPostProcessed(input.postStatus)
  );
}

function shouldDeferPostForMeAmbiguousFailure(input: {
  platform: PostForMePlatform;
  providerError: string | null;
  startedAt: Date | null;
  createdAt: Date | null;
}): boolean {
  if (input.platform !== "tiktok") {
    return false;
  }

  const normalizedError = input.providerError?.trim().toLowerCase() || "";
  if (!normalizedError.startsWith("failed to post to tiktok")) {
    return false;
  }

  const referenceTimeMs = input.startedAt?.getTime() ?? input.createdAt?.getTime() ?? null;
  if (!referenceTimeMs) {
    return false;
  }

  return Date.now() - referenceTimeMs < POST_FOR_ME_AMBIGUOUS_FAILURE_MAX_WAIT_MS;
}

async function resolvePostForMeManagedMetaJobState(input: {
  jobId: string;
  platform: PostForMePlatform;
}): Promise<{
  postStatus: string | null;
  providerPostId: string | null;
  providerPlatformPostId: string | null;
  platformUrl: string | null;
  platformUrlSource: "social-post" | "social-post-result" | "social-account-feed" | null;
  hasAnyResult: boolean;
  hasSuccessfulResult: boolean;
  hasFailedResult: boolean;
  providerError: string | null;
  debugUrlCandidates: string[];
  debugCaptionCandidates: string[];
  resultsCount: number;
}> {
  const providerExternalId = buildPostForMeJobExternalId(input.jobId);
  const providerPosts = await listPostForMeSocialPosts({
    externalId: providerExternalId,
    platform: input.platform,
    limit: 10,
  });

  for (const providerPost of providerPosts) {
    const providerPostPlatformData =
      providerPost.raw.platform_data &&
      typeof providerPost.raw.platform_data === "object" &&
      !Array.isArray(providerPost.raw.platform_data)
        ? (providerPost.raw.platform_data as Record<string, unknown>)
        : null;
    const directPlatformUrl =
      (providerPost.raw.platform_url && typeof providerPost.raw.platform_url === "string"
        ? providerPost.raw.platform_url
        : null) ||
      (providerPost.raw.url && typeof providerPost.raw.url === "string" ? providerPost.raw.url : null) ||
      (providerPost.raw.permalink && typeof providerPost.raw.permalink === "string" ? providerPost.raw.permalink : null) ||
      (providerPostPlatformData?.url && typeof providerPostPlatformData.url === "string"
        ? providerPostPlatformData.url
        : null) ||
      (providerPostPlatformData?.platform_url && typeof providerPostPlatformData.platform_url === "string"
        ? providerPostPlatformData.platform_url
        : null) ||
      (providerPostPlatformData?.permalink && typeof providerPostPlatformData.permalink === "string"
        ? providerPostPlatformData.permalink
        : null);
    const results = await listPostForMeSocialPostResults({
      postId: providerPost.id,
      platform: input.platform,
      limit: 20,
    });
    const providerSocialAccountId =
      results.map((result) => result.socialAccountId?.trim() || "").find(Boolean) ||
      extractPostForMeSocialAccountIdFromProviderPost(providerPost.raw);
    let accountFeedRecords: PostForMeSocialAccountFeedRecord[] = [];
    if (providerSocialAccountId) {
      try {
        accountFeedRecords = await listPostForMeSocialAccountFeed({
          socialAccountId: providerSocialAccountId,
          socialPostId: providerPost.id,
          limit: 10,
        });
      } catch {
        accountFeedRecords = [];
      }
    }
    const feedPlatformUrl = extractPostForMePlatformUrlFromAccountFeed(accountFeedRecords, input.platform);
    const feedPlatformPostId =
      accountFeedRecords.map((record) => record.id?.trim() || "").find(Boolean) || null;
    const providerPlatformPostId =
      results.map((result) => result.platformDataId?.trim() || "").find(Boolean) ||
      results
        .flatMap((result) => result.platformPosts.map((platformPost) => platformPost.id?.trim() || ""))
        .find(Boolean) ||
      feedPlatformPostId ||
      null;
    const resultPlatformUrl = extractPostForMePlatformUrlFromResults(results, input.platform);
    const normalizedDirectPlatformUrl = directPlatformUrl?.trim() || "";
    const normalizedResultPlatformUrl = resultPlatformUrl?.trim() || "";
    const normalizedFeedPlatformUrl = feedPlatformUrl?.trim() || "";
    const resolvedPlatformUrl =
      normalizedDirectPlatformUrl || normalizedResultPlatformUrl || normalizedFeedPlatformUrl || null;
    const platformUrlSource = normalizedDirectPlatformUrl
      ? "social-post"
      : normalizedResultPlatformUrl
        ? "social-post-result"
        : normalizedFeedPlatformUrl
          ? "social-account-feed"
          : null;
    const hasSuccessfulResult = results.some((result) => result.success === true);
    const hasFailedResult = results.some((result) => result.success === false || Boolean(result.error?.trim()));
    const providerError = results.map((result) => result.error?.trim() || "").find(Boolean) || null;
    const debugUrlCandidates = Array.from(
      new Set([
        ...collectPostForMeUrlCandidates(providerPost.raw),
        ...results.flatMap((result) => collectPostForMeUrlCandidates(result.raw)),
        ...results.flatMap((result) =>
          result.platformPosts
            .filter((platformPost) => platformPost.platform === input.platform)
            .flatMap((platformPost) => collectPostForMeUrlCandidates(platformPost.raw)),
        ),
        ...accountFeedRecords.flatMap((record) => collectPostForMeUrlCandidates(record.raw)),
      ]),
    );
    const debugCaptionCandidates = Array.from(
      new Set([
        ...collectPostForMeCaptionCandidates(providerPost.raw),
        ...results.flatMap((result) => collectPostForMeCaptionCandidates(result.raw)),
        ...results.flatMap((result) =>
          result.platformPosts
            .filter((platformPost) => platformPost.platform === input.platform)
            .flatMap((platformPost) => collectPostForMeCaptionCandidates(platformPost.raw)),
        ),
        ...accountFeedRecords.map((record) => record.caption?.trim() || "").filter(Boolean),
        ...accountFeedRecords.flatMap((record) => collectPostForMeCaptionCandidates(record.raw)),
      ]),
    );

    return {
      postStatus: providerPost.status,
      providerPostId: providerPost.id,
      providerPlatformPostId,
      platformUrl: resolvedPlatformUrl,
      platformUrlSource,
      hasAnyResult: results.length > 0,
      hasSuccessfulResult,
      hasFailedResult,
      providerError,
      debugUrlCandidates,
      debugCaptionCandidates,
      resultsCount: results.length,
    };
  }

  return {
    postStatus: null,
    providerPostId: null,
    providerPlatformPostId: null,
    platformUrl: null,
    platformUrlSource: null,
    hasAnyResult: false,
    hasSuccessfulResult: false,
    hasFailedResult: false,
    providerError: null,
    debugUrlCandidates: [],
    debugCaptionCandidates: [],
    resultsCount: 0,
  };
}

async function resolvePostForMeMetaPermalinkForJob(
  jobId: string,
  platform: PostForMePlatform,
): Promise<string | null> {
  const state = await resolvePostForMeManagedMetaJobState({
    jobId,
    platform,
  });
  return state.platformUrl;
}

async function resolveMetaRelinkTargetUrl(job: {
  id: string;
  publicationType?: string | null;
  instagramPermalink: string | null;
}): Promise<string | null> {
  const directPermalink = job.instagramPermalink?.trim() || "";
  if (directPermalink) {
    return directPermalink;
  }

  const publicationType = normalizePublicationType(job);
  const providerPlatform: PostForMePlatform | null =
    publicationType === "threads_post"
      ? "threads"
      : publicationType === "x_post"
        ? "x"
        : publicationType === "tiktok_post"
          ? "tiktok"
          : publicationType === "instagram_post" ||
              publicationType === "instagram_reel" ||
              publicationType === "instagram_story"
            ? "instagram"
            : null;
  if (!providerPlatform) {
    return null;
  }

  const providerPermalink = (await resolvePostForMeMetaPermalinkForJob(job.id, providerPlatform))?.trim() || "";
  if (providerPermalink) {
    return providerPermalink;
  }

  return null;
}

function isPostForMeSocialPostProcessed(status: string | null | undefined): boolean {
  const normalized = (status || "").trim().toLowerCase();
  return normalized === "processed" || normalized === "published" || normalized === "completed";
}

function postForMePlatformNoticeLabel(platform: "instagram" | "facebook" | "threads" | "tiktok" | "x"): string {
  switch (platform) {
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "threads":
      return "Threads";
    case "tiktok":
      return "TikTok";
    case "x":
      return "X";
  }
}

function socialPlatformNoticeLabel(platform: "instagram" | "facebook" | "threads" | "tiktok" | "x" | "whatsapp"): string {
  return platform === "whatsapp" ? "WhatsApp" : postForMePlatformNoticeLabel(platform);
}

function supportsPostForMeCaptionDebug(platform: "instagram" | "facebook" | "threads" | "tiktok" | "x"): boolean {
  return platform === "instagram" || platform === "threads";
}

function supportsPostForMeUrlDebug(platform: "instagram" | "facebook" | "threads" | "tiktok" | "x"): boolean {
  return platform === "tiktok";
}

async function tryRecoverPostForMeManagedMetaJobAfterConnectionLoss(job: {
  id: string;
  companyId: string;
  createdByUserId: string | null;
  criadoEm: Date | null;
  startedAt: Date | null;
  title?: string | null;
  caption: string | null;
  lastError?: string | null;
  publicationType?: string | null;
  postStory?: boolean;
  postReel?: boolean;
  postWhatsapp?: boolean;
  modoWhatsapp?: string | null;
  whatsappRelinkEnabled?: boolean;
  whatsappRelinkConnectionIds?: unknown;
}, platform: "instagram" | "facebook" | "threads" | "tiktok" | "x"): Promise<boolean> {
  let providerState: Awaited<ReturnType<typeof resolvePostForMeManagedMetaJobState>>;
  try {
    providerState = await resolvePostForMeManagedMetaJobState({
      jobId: job.id,
      platform,
    });
  } catch (error) {
    await appendLog({
      companyId: job.companyId,
      level: "WARN",
      errorCode: "POST_FOR_ME_META_RECOVERY_FAILED",
      message:
        `Job ${job.id} não conseguiu consultar o Post for Me após perda de conexão: ` +
        `${error instanceof Error ? error.message : "erro desconhecido"}`,
    });
    return false;
  }

  const providerAccepted = Boolean(providerState.providerPostId);
  const providerFalseNegativeProcessed =
    platform === "instagram" &&
    isPostForMeProcessedApplicationLimitFalseNegative({
      postStatus: providerState.postStatus,
      providerError: providerState.providerError,
      hasFailedResult: providerState.hasFailedResult,
      hasSuccessfulResult: providerState.hasSuccessfulResult,
    });
  const providerTikTokFalseNegativeProcessed = isPostForMeProcessedTikTokFalseNegative({
    platform,
    postStatus: providerState.postStatus,
    providerError: providerState.providerError,
    hasFailedResult: providerState.hasFailedResult,
    hasSuccessfulResult: providerState.hasSuccessfulResult,
    providerPlatformPostId: providerState.providerPlatformPostId,
    platformUrl: providerState.platformUrl,
  });
  const providerProcessed =
    providerFalseNegativeProcessed ||
    providerTikTokFalseNegativeProcessed ||
    providerState.hasSuccessfulResult ||
    (isPostForMeSocialPostProcessed(providerState.postStatus) && !providerState.hasAnyResult);
  const providerFailed =
    providerState.hasFailedResult &&
    !providerFalseNegativeProcessed &&
    !providerTikTokFalseNegativeProcessed;

  if (!providerAccepted && !providerProcessed && !providerFailed) {
    return false;
  }

  if (providerFailed) {
    if (shouldDeferPostForMeAmbiguousFailure({
      platform,
      providerError: providerState.providerError,
      startedAt: job.startedAt,
      createdAt: job.criadoEm,
    })) {
      await prisma.job.updateMany({
        where: {
          id: job.id,
          status: {
            in: ["PENDING", "WAITING_LOGIN", "RUNNING", "SENT_UNCONFIRMED"],
          },
        },
        data: {
          status: "RUNNING",
          completedAt: null,
          lastError: `Aguardando confirmação final do ${postForMePlatformNoticeLabel(platform)}.`,
        },
      });
      return true;
    }

    const failureMessage = providerState.providerError || "O Post for Me retornou erro ao concluir a publicação.";
    const update = await prisma.job.updateMany({
      where: {
        id: job.id,
        status: {
          in: ["PENDING", "WAITING_LOGIN", "RUNNING", "SENT_UNCONFIRMED"],
        },
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        lastError: failureMessage,
      },
    });

    if (update.count > 0) {
      await appendLog({
        companyId: job.companyId,
        level: "ERROR",
        errorCode: "POST_FOR_ME_META_RECOVERED_FAILED",
        message:
          `Job ${job.id} retornou falha real no Post for Me. ` +
          `platform=${platform} providerPostId=${providerState.providerPostId ?? "indisponivel"} ` +
          `platformUrlSource=${providerState.platformUrlSource ?? "indisponivel"} ` +
          `error=${failureMessage}.`,
      });

      await appendJobAvisoSafely(job, {
        title: "Falha no agendamento",
        kind: "JOB_FAILED",
        message: failureMessage,
      });
    }

    return true;
  }

  const relinkTargetCount =
    (platform === "instagram" || platform === "threads" || platform === "tiktok" || platform === "x") &&
      job.whatsappRelinkEnabled
      ? parseStoredWhatsappRelinkConnectionIds(job.whatsappRelinkConnectionIds).length
      : 0;
  const shouldHoldForWhatsappRelink =
    (platform === "instagram" || platform === "threads" || platform === "tiktok" || platform === "x") &&
    relinkTargetCount > 0;
  const recoveredStatus = providerProcessed && !shouldHoldForWhatsappRelink ? "COMPLETED" : "RUNNING";
  const update = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: {
        in: ["PENDING", "WAITING_LOGIN", "RUNNING"],
      },
    },
    data: {
      status: recoveredStatus,
      completedAt: providerProcessed && !shouldHoldForWhatsappRelink ? new Date() : null,
      lastError: null,
      instagramPermalink:
        (platform === "instagram" || platform === "threads" || platform === "tiktok" || platform === "x") &&
          providerState.platformUrl?.trim()
          ? providerState.platformUrl.trim()
          : undefined,
    },
  });

  if (update.count === 0) {
    return true;
  }

  await appendLog({
    companyId: job.companyId,
    level: providerProcessed ? "INFO" : "WARN",
    errorCode: providerProcessed ? "POST_FOR_ME_META_RECOVERED_COMPLETED" : "POST_FOR_ME_META_RECOVERED_PENDING",
    message:
      `Job ${job.id} foi recuperado pelo Post for Me após perda de conexão. ` +
      `platform=${platform} providerPostId=${providerState.providerPostId ?? "indisponivel"} ` +
      `platformUrlSource=${providerState.platformUrlSource ?? "indisponivel"} ` +
      `status=${providerState.postStatus ?? "desconhecido"}.`,
  });

  if (providerProcessed) {
    if (shouldHoldForWhatsappRelink) {
      await appendMetaPublishedAvisoOnce(job);
    } else {
      await appendJobAvisoSafely(job, {
        title: `${postForMePlatformNoticeLabel(platform)} publicado`,
        kind: "JOB_SENT",
        message: "Publicacao concluida com sucesso.",
      });
    }
  }

  return true;
}

async function tryDispatchPostForMeWhatsappRelinkForMetaJob(job: {
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
  instagramPermalink: string | null;
}): Promise<boolean> {
  if (!job.whatsappRelinkEnabled || job.whatsappRelinkDispatchedAt) {
    return false;
  }

  const permalink = await resolveMetaRelinkTargetUrl(job);
  if (!permalink) {
    return false;
  }

  return dispatchWhatsappRelinkJobsForInstagramPermalink({
    job,
    permalink,
  });
}

async function waitForPostForMeWhatsappRelinkForMetaJob(job: {
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
  instagramPermalink: string | null;
}): Promise<boolean> {
  if (!job.whatsappRelinkEnabled || job.whatsappRelinkDispatchedAt) {
    return false;
  }

  const deadlineAt = Date.now() + POST_FOR_ME_WHATSAPP_RELINK_MAX_WAIT_MS;
  while (Date.now() <= deadlineAt) {
    if (await tryDispatchPostForMeWhatsappRelinkForMetaJob(job)) {
      return true;
    }

    if (Date.now() >= deadlineAt) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, POST_FOR_ME_WHATSAPP_RELINK_POLL_INTERVAL_MS));
  }

  return false;
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
    hashtags?: unknown;
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
        caption: resolveStoredJobCaptionForPublication(job),
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
      caption: resolveStoredJobCaptionForPublication(job),
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

async function executePostForMeManagedMetaRunningJob(job: {
  id: string;
  companyId: string;
  createdByUserId: string | null;
  title?: string | null;
  filePath: string;
  caption: string | null;
  lastError?: string | null;
  hashtags?: unknown;
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
}, connection: {
  id: string;
  platform: "instagram" | "facebook" | "threads" | "tiktok" | "x";
  displayName: string;
  loginIdentifier: string | null;
  provider?: string | null;
  providerAccountId?: string | null;
  providerStatus?: string | null;
}): Promise<void> {
  const publicationType = normalizePublicationType(job);
  if (!isProviderManagedMetaPublication(publicationType)) {
    throw new Error(`UNSUPPORTED_SERVER_PUBLICATION_TYPE:${publicationType}`);
  }

  const socialAccountId = connection.providerAccountId?.trim() || "";
  if (!socialAccountId) {
    throw new Error(`POST_FOR_ME_SOCIAL_ACCOUNT_NOT_CONNECTED:${connection.platform}`);
  }

  const mediaBundle = decodeJobMediaBundleStorage(job.filePath);
  const mediaFiles = mediaBundle.files.length > 0
    ? mediaBundle.files
    : (job.filePath?.trim() ? [job.filePath.trim()] : []);

  if (publicationType === "instagram_story" && mediaFiles.length > 1) {
    throw new Error("POST_FOR_ME_INSTAGRAM_STORY_SEQUENCE_UNSUPPORTED");
  }

  const mediaUrls = mediaFiles.map((filePath, index) =>
    appendInstagramMediaCacheBuster(
      resolvePublicUploadUrl(filePath),
      job.id,
      path.basename(filePath) || `media-${index + 1}`,
      `pfm-${publicationType}-${index + 1}`,
    ),
  );
  const locationMetadata = isMetaLocationSupportedPublication(publicationType)
    ? decodeMetaLocationStorage(job.locationName)
    : { locationName: null as string | null, locationId: null as string | null };

  const relinkTargetCount =
    connection.platform === "instagram" ||
      connection.platform === "threads" ||
      connection.platform === "tiktok" ||
      connection.platform === "x"
      ? parseStoredWhatsappRelinkConnectionIds(job.whatsappRelinkConnectionIds).length
      : 0;
  const resolvedProviderCaption = resolvePostForMeCaptionForPublication(job);

  if (supportsPostForMeCaptionDebug(connection.platform)) {
    await appendLog({
      companyId: job.companyId,
      level: "INFO",
      errorCode: "POST_FOR_ME_META_FINAL_CAPTION_DEBUG",
      message:
        `Job ${job.id} enviará caption final ao ${postForMePlatformNoticeLabel(connection.platform)}: ${JSON.stringify(resolvedProviderCaption)}. ` +
        `mediaCount=${mediaFiles.length}.`,
    });
  }

  const socialPost = await createPostForMeSocialPost({
    caption: resolvedProviderCaption,
    socialAccountIds: [socialAccountId],
    mediaUrls,
    platform: connection.platform,
    placement: resolvePostForMePlacementForMetaPublication(publicationType, job.filePath),
    locationId: locationMetadata.locationId,
    externalId: buildPostForMeJobExternalId(job.id),
  });

  const normalizedProviderStatus = socialPost.status?.trim().toLowerCase() || "submitted";
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "RUNNING",
      completedAt: null,
      lastError: null,
    },
  });

  await appendLog({
    companyId: job.companyId,
    level: "INFO",
    errorCode: "POST_FOR_ME_SOCIAL_POST_SUBMITTED",
    message:
      `Job ${job.id} enviado ao Post for Me para ${connection.platform}. ` +
      `providerPostId=${socialPost.id} status=${normalizedProviderStatus}.`,
  });

  if (supportsPostForMeCaptionDebug(connection.platform)) {
    const providerSubmitCaption =
      typeof socialPost.raw.caption === "string" && socialPost.raw.caption.trim().length > 0
        ? socialPost.raw.caption.trim()
        : null;
    await appendLog({
      companyId: job.companyId,
      level: "INFO",
      errorCode: "POST_FOR_ME_META_PROVIDER_SUBMIT_DEBUG",
      message:
        `Job ${job.id} recebeu resposta inicial do Post for Me para ${postForMePlatformNoticeLabel(connection.platform)} com ` +
        `submitCaption=${JSON.stringify(providerSubmitCaption)} mediaCount=${mediaFiles.length}.`,
    });
  }

  if (supportsPostForMeUrlDebug(connection.platform)) {
    const submitUrlCandidates = collectPostForMeUrlCandidates(socialPost.raw).join(" | ") || "none";
    await appendLog({
      companyId: job.companyId,
      level: "INFO",
      errorCode: "POST_FOR_ME_META_PROVIDER_URL_DEBUG",
      message:
        `Job ${job.id} recebeu resposta inicial do Post for Me para ${postForMePlatformNoticeLabel(connection.platform)} com ` +
        `submitUrlCandidates=${submitUrlCandidates}.`,
    });
  }

  if (connection.platform === "instagram" && job.firstComment?.trim()) {
    await appendLog({
      companyId: job.companyId,
      level: "WARN",
      errorCode: "POST_FOR_ME_FIRST_COMMENT_SKIPPED",
      message:
        `Job ${job.id} possui primeiro comentário configurado, mas esse envio via Post for Me ainda não aplica essa etapa automaticamente.`,
    });
  }

  if (
    (connection.platform === "instagram" ||
      connection.platform === "threads" ||
      connection.platform === "tiktok" ||
      connection.platform === "x") &&
    job.whatsappRelinkEnabled &&
    relinkTargetCount > 0
  ) {
    await appendLog({
      companyId: job.companyId,
      level: "INFO",
      errorCode: "POST_FOR_ME_WHATSAPP_RELINK_PENDING",
      message:
        `Job ${job.id} aguarda confirmação final do Post for Me para disparar relink em ${relinkTargetCount} conta(s) de WhatsApp.`,
    });
  }
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
  platform: string;
  displayName: string;
  loginIdentifier: string | null;
  provider?: string | null;
  providerAccountId?: string | null;
  providerStatus?: string | null;
  secretCipher: string | null;
}): Promise<void> {
  if (isPostForMeProviderConnection(connection)) {
    await executePostForMeManagedMetaRunningJob(job, connection);
    return;
  }

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
              tokenExpiresAt: resolveConnectionTokenExpiresAt(refreshed.tokenExpiresInSeconds, refreshedAt),
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
              tokenExpiresAt: null,
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
    let waitingLogin =
      isInstagramLoginRequiredErrorMessage(message) || isPostForMeLoginRequiredErrorMessage(message);
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
            tokenExpiresAt: resolveConnectionTokenExpiresAt(refreshed.tokenExpiresInSeconds, refreshedAt),
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
        waitingLogin =
          isInstagramLoginRequiredErrorMessage(message) || isPostForMeLoginRequiredErrorMessage(message);
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
            tokenExpiresAt: resolveConnectionTokenExpiresAt(refreshed.tokenExpiresInSeconds, refreshedAt),
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
        waitingLogin =
          isInstagramLoginRequiredErrorMessage(message) || isPostForMeLoginRequiredErrorMessage(message);

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
          secretCipher: isPostForMeProviderConnection(connection) ? undefined : null,
          tokenExpiresAt: null,
          lastAuthAt: isPostForMeProviderConnection(connection) ? undefined : null,
          authLaunchUrl: null,
          lastSeenAt: null,
          providerStatus: isPostForMeProviderConnection(connection) ? "disconnected" : undefined,
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
            in: [
              "instagram_post",
              "instagram_reel",
              "instagram_story",
              "facebook_post",
              "threads_post",
              "tiktok_post",
              "x_post",
            ],
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
        const expectedPlatform = platformForPublication(normalizePublicationType(job));
        const billingBlockedMessage = await resolveJobBillingBlockMessage(job);
        if (billingBlockedMessage) {
          await failJobDueToBillingBlocked(job, billingBlockedMessage);
          continue;
        }

        if (!job.socialConnectionId) {
          if (
            (expectedPlatform === "instagram" ||
              expectedPlatform === "facebook" ||
              expectedPlatform === "threads" ||
              expectedPlatform === "tiktok" ||
              expectedPlatform === "x") &&
            (await tryRecoverPostForMeManagedMetaJobAfterConnectionLoss(job, expectedPlatform))
          ) {
            continue;
          }
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
            platform: expectedPlatform,
          },
          select: {
            id: true,
            platform: true,
            authStatus: true,
            provider: true,
            providerAccountId: true,
            secretCipher: true,
          },
        });

        if (!connection) {
          if (
            (expectedPlatform === "instagram" ||
              expectedPlatform === "facebook" ||
              expectedPlatform === "threads" ||
              expectedPlatform === "tiktok" ||
              expectedPlatform === "x") &&
            (await tryRecoverPostForMeManagedMetaJobAfterConnectionLoss(job, expectedPlatform))
          ) {
            continue;
          }
          await failJobDueToConnectionUnavailable(job, {
            errorCode: "SOCIAL_CONNECTION_NOT_FOUND",
            message:
              "Conta social deste agendamento não está mais disponível. Edite o agendamento e selecione outra conta conectada.",
          });
          continue;
        }

        const hasProviderExecutionAccess =
          isPostForMeProviderConnection(connection) && Boolean(connection.providerAccountId?.trim());
        const hasNativeExecutionAccess = !isPostForMeProviderConnection(connection) && Boolean(connection.secretCipher);

        if (connection.authStatus !== "CONNECTED" || (!hasProviderExecutionAccess && !hasNativeExecutionAccess)) {
          const platformLabel = socialPlatformNoticeLabel(expectedPlatform);
          if (job.status === "PENDING") {
            await prisma.job.update({
              where: { id: job.id },
              data: {
                status: "WAITING_LOGIN",
                startedAt: null,
                completedAt: null,
                lastError: `Aguardando autenticação do ${platformLabel}.`,
              },
            });

            await appendJobAvisoSafely(job, {
              title: "Aguardando autenticação",
              kind: "JOB_WAITING_LOGIN",
              message: `A conta do ${platformLabel} precisa ser autenticada para continuar.`,
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
        notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

        try {
          await enqueueJobForExecution({
            jobId: job.id,
            platform: expectedPlatform,
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
          notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

          await appendLog({
            companyId: job.companyId,
            level: "ERROR",
            errorCode: "RABBITMQ_ENQUEUE_FAILED",
            message:
              `Falha ao enfileirar job ${job.id} de ${expectedPlatform} no RabbitMQ. ` +
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
              tokenExpiresAt: resolveConnectionTokenExpiresAt(refreshed.tokenExpiresInSeconds, new Date()),
              lastSeenAt: new Date(),
            },
          });
          notifyLiveUpdateForWorkspace(connection.companyId, ["connections", "dashboard"]);
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
                tokenExpiresAt: null,
                lastAuthAt: null,
                authLaunchUrl: null,
                lastSeenAt: null,
            },
          });
          notifyLiveUpdateForWorkspace(connection.companyId, ["connections", "dashboard"]);

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

function startPostForMeMetaPostSyncWorker(): void {
  const tick = async () => {
    try {
      const candidateJobs = await prisma.job.findMany({
        where: {
          publicationState: "PUBLISHED",
          status: {
            in: ["RUNNING", "COMPLETED", "SENT_UNCONFIRMED"],
          },
          OR: [
            {
              status: {
                in: ["RUNNING", "SENT_UNCONFIRMED"],
              },
            },
            {
              publicationType: {
                in: ["instagram_post", "instagram_reel", "instagram_story", "threads_post", "tiktok_post", "x_post"],
              },
              whatsappRelinkEnabled: true,
              whatsappRelinkDispatchedAt: null,
            },
          ],
          socialConnection: {
            is: {
              provider: "POST_FOR_ME",
              platform: {
                in: ["instagram", "facebook", "threads", "tiktok", "x"],
              },
            },
          },
        },
        orderBy: [{ completedAt: "asc" }, { criadoEm: "asc" }],
        take: POST_FOR_ME_WHATSAPP_RELINK_BATCH_SIZE,
        include: {
          socialConnection: {
            select: {
              platform: true,
            },
          },
        },
      });

      for (const job of candidateJobs) {
        const providerPlatform = job.socialConnection?.platform ?? "";
        if (!isPostForMeManagedPlatform(providerPlatform)) {
          continue;
        }
        const relinkTargetCount =
          (providerPlatform === "instagram" ||
            providerPlatform === "threads" ||
            providerPlatform === "tiktok" ||
            providerPlatform === "x")
            ? parseStoredWhatsappRelinkConnectionIds(job.whatsappRelinkConnectionIds).length
            : 0;
        const shouldHoldForWhatsappRelink =
          (providerPlatform === "instagram" ||
            providerPlatform === "threads" ||
            providerPlatform === "tiktok" ||
            providerPlatform === "x") &&
          job.whatsappRelinkEnabled &&
          relinkTargetCount > 0;

        const relinkLock = await acquireDistributedLock(
          postForMeWhatsappRelinkLockKey(job.id),
          POST_FOR_ME_WHATSAPP_RELINK_LOCK_MS,
        );
        if (!relinkLock) {
          continue;
        }

        try {
          if (shouldHoldForWhatsappRelink && job.whatsappRelinkDispatchedAt) {
            await syncWhatsappRelinkParentJobOutcome(job.id);
            continue;
          }

          const providerState = await resolvePostForMeManagedMetaJobState({
            jobId: job.id,
            platform: providerPlatform,
          });
          const providerFalseNegativeProcessed =
            providerPlatform === "instagram" &&
            isPostForMeProcessedApplicationLimitFalseNegative({
              postStatus: providerState.postStatus,
              providerError: providerState.providerError,
              hasFailedResult: providerState.hasFailedResult,
              hasSuccessfulResult: providerState.hasSuccessfulResult,
            });
          const providerTikTokFalseNegativeProcessed = isPostForMeProcessedTikTokFalseNegative({
            platform: providerPlatform,
            postStatus: providerState.postStatus,
            providerError: providerState.providerError,
            hasFailedResult: providerState.hasFailedResult,
            hasSuccessfulResult: providerState.hasSuccessfulResult,
            providerPlatformPostId: providerState.providerPlatformPostId,
            platformUrl: providerState.platformUrl,
          });
          const providerConfirmed =
            providerFalseNegativeProcessed ||
            providerTikTokFalseNegativeProcessed ||
            providerState.hasSuccessfulResult ||
            (isPostForMeSocialPostProcessed(providerState.postStatus) && !providerState.hasAnyResult);
          const providerFailed =
            providerState.hasFailedResult &&
            !providerFalseNegativeProcessed &&
            !providerTikTokFalseNegativeProcessed;

          if (providerFalseNegativeProcessed) {
            await appendLog({
              companyId: job.companyId,
              level: "WARN",
              errorCode: "POST_FOR_ME_FALSE_NEGATIVE_PROCESSED",
              message:
                `Job ${job.id} recebeu erro contraditório do Post for Me após processamento no Instagram. ` +
                `providerPostId=${providerState.providerPostId ?? "indisponivel"} ` +
                `providerPlatformPostId=${providerState.providerPlatformPostId ?? "indisponivel"} ` +
                `platformUrlSource=${providerState.platformUrlSource ?? "indisponivel"} ` +
                `error=${providerState.providerError ?? "indisponivel"}.`,
            });
          }

          if (providerFailed) {
            if (shouldDeferPostForMeAmbiguousFailure({
              platform: providerPlatform,
              providerError: providerState.providerError,
              startedAt: job.startedAt,
              createdAt: job.criadoEm,
            })) {
              await prisma.job.updateMany({
                where: {
                  id: job.id,
                  status: {
                    in: ["RUNNING", "SENT_UNCONFIRMED"],
                  },
                },
                data: {
                  status: "RUNNING",
                  completedAt: null,
                  lastError: `Aguardando confirmação final do ${postForMePlatformNoticeLabel(providerPlatform)}.`,
                },
              });
              continue;
            }

            const failureMessage = providerState.providerError || "O Post for Me retornou erro ao concluir a publicação.";
            const update = await prisma.job.updateMany({
              where: {
                id: job.id,
                status: {
                  in: ["RUNNING", "SENT_UNCONFIRMED"],
                },
              },
              data: {
                status: "FAILED",
                completedAt: new Date(),
                lastError: failureMessage,
              },
            });

            if (update.count > 0) {
              await appendLog({
                companyId: job.companyId,
                level: "ERROR",
                errorCode: "POST_FOR_ME_SOCIAL_POST_FAILED",
                message:
                  `Job ${job.id} retornou falha real no Post for Me para ${providerPlatform}. ` +
                  `providerPostId=${providerState.providerPostId ?? "indisponivel"} ` +
                  `providerPlatformPostId=${providerState.providerPlatformPostId ?? "indisponivel"} ` +
                  `platformUrlSource=${providerState.platformUrlSource ?? "indisponivel"} ` +
                  `error=${failureMessage}.`,
              });

              if (supportsPostForMeCaptionDebug(providerPlatform)) {
                const debugCaptions = providerState.debugCaptionCandidates.join(" | ") || "none";
                await appendLog({
                  companyId: job.companyId,
                  level: "INFO",
                  errorCode: "POST_FOR_ME_META_PROVIDER_RESPONSE_DEBUG",
                  message:
                    `Job ${job.id} recebeu retorno do Post for Me para ${postForMePlatformNoticeLabel(providerPlatform)} com ` +
                    `captionCandidates=${debugCaptions}.`,
                });
              }

              await appendJobAvisoSafely(job, {
                title: "Falha no agendamento",
                kind: "JOB_FAILED",
                message: failureMessage,
              });
            }
            continue;
          }

          if (!shouldHoldForWhatsappRelink && (job.status === "RUNNING" || job.status === "SENT_UNCONFIRMED") && providerConfirmed) {
            const update = await prisma.job.updateMany({
              where: {
                id: job.id,
                status: {
                  in: ["RUNNING", "SENT_UNCONFIRMED"],
                },
              },
              data: {
                status: "COMPLETED",
                completedAt: job.completedAt ?? new Date(),
                lastError: null,
                instagramPermalink:
                  (providerPlatform === "instagram" ||
                    providerPlatform === "threads" ||
                    providerPlatform === "tiktok" ||
                    providerPlatform === "x") &&
                    providerState.platformUrl?.trim()
                    ? providerState.platformUrl.trim()
                    : undefined,
              },
            });

            if (update.count > 0) {
              await appendLog({
                companyId: job.companyId,
                level: "INFO",
                errorCode: "POST_FOR_ME_SOCIAL_POST_CONFIRMED",
                message:
                  `Job ${job.id} foi confirmado pelo Post for Me para ${providerPlatform}. ` +
                  `providerPostId=${providerState.providerPostId ?? "indisponivel"} ` +
                  `providerPlatformPostId=${providerState.providerPlatformPostId ?? "indisponivel"} ` +
                  `platformUrlSource=${providerState.platformUrlSource ?? "indisponivel"} ` +
                  `status=${providerState.postStatus ?? "desconhecido"}.`,
              });

              if (supportsPostForMeCaptionDebug(providerPlatform)) {
                const debugCaptions = providerState.debugCaptionCandidates.join(" | ") || "none";
                await appendLog({
                  companyId: job.companyId,
                  level: "INFO",
                  errorCode: "POST_FOR_ME_META_PROVIDER_RESPONSE_DEBUG",
                  message:
                    `Job ${job.id} confirmou no ${postForMePlatformNoticeLabel(providerPlatform)} com ` +
                    `captionCandidates=${debugCaptions}.`,
                });
              }

              if (supportsPostForMeUrlDebug(providerPlatform)) {
                const debugUrls = providerState.debugUrlCandidates.join(" | ") || "none";
                await appendLog({
                  companyId: job.companyId,
                  level: "INFO",
                  errorCode: "POST_FOR_ME_META_PROVIDER_URL_DEBUG",
                  message:
                    `Job ${job.id} confirmou no ${postForMePlatformNoticeLabel(providerPlatform)} com ` +
                    `providerPlatformPostId=${providerState.providerPlatformPostId ?? "indisponivel"} ` +
                    `platformUrlSource=${providerState.platformUrlSource ?? "indisponivel"} ` +
                    `urlCandidates=${debugUrls}.`,
                });
              }

              await appendJobAvisoSafely(job, {
                title: `${postForMePlatformNoticeLabel(providerPlatform)} publicado`,
                kind: "JOB_SENT",
                message: "Publicacao concluida com sucesso.",
              });
            }
          }

          if (shouldHoldForWhatsappRelink && providerConfirmed) {
            await prisma.job.updateMany({
              where: {
                id: job.id,
                status: {
                  in: ["RUNNING", "SENT_UNCONFIRMED"],
                },
              },
              data: {
                status: "RUNNING",
                completedAt: null,
                instagramPermalink:
                  providerState.platformUrl?.trim()
                    ? providerState.platformUrl.trim()
                    : undefined,
              },
            });

            await appendMetaPublishedAvisoOnce(job);
          }

          if (shouldHoldForWhatsappRelink && !job.whatsappRelinkDispatchedAt) {
            const resolvedPermalink =
              providerState.platformUrl?.trim() ||
              job.instagramPermalink?.trim() ||
              "";
            if (resolvedPermalink) {
              const relinkDispatched = await dispatchWhatsappRelinkJobsForInstagramPermalink({
                job,
                permalink: resolvedPermalink,
              });
              if (!relinkDispatched && providerConfirmed) {
                await finalizeWhatsappRelinkParentJob(job, {
                  status: "FAILED",
                  title: "Relink falhou no WhatsApp",
                  kind: "JOB_FAILED",
                  message: `O relink para ${relinkTargetCount} conta(s) de WhatsApp não pôde ser iniciado.`,
                  lastError: "Não foi possível iniciar o relink para o WhatsApp.",
                });
              }
            } else if (providerConfirmed) {
              const instagramConfirmedAtMs = parsePostForMeInstagramConfirmedMarkerMs(job.lastError);
              const relinkUrlWaitTimedOut =
                instagramConfirmedAtMs !== null && Date.now() - instagramConfirmedAtMs >= POST_FOR_ME_WHATSAPP_RELINK_MAX_WAIT_MS;

              if (relinkUrlWaitTimedOut) {
                await finalizeWhatsappRelinkParentJob(job, {
                  status: "FAILED",
                  title: "Relink falhou no WhatsApp",
                  kind: "JOB_FAILED",
                  message:
                    `A publicação em ${postForMePlatformNoticeLabel(providerPlatform)} foi concluída, mas a URL oficial não ficou disponível a tempo para enviar o relink ao WhatsApp.`,
                  lastError: `A URL oficial da publicação em ${postForMePlatformNoticeLabel(providerPlatform)} não ficou disponível a tempo para o relink.`,
                });
                continue;
              }

              const debugCandidates = providerState.debugUrlCandidates.join(" | ") || "none";
              await appendLog({
                companyId: job.companyId,
                level: "INFO",
                errorCode: "POST_FOR_ME_WHATSAPP_RELINK_URL_PENDING",
                message:
                  `Job ${job.id} foi confirmado em ${postForMePlatformNoticeLabel(providerPlatform)}, mas ainda aguarda URL final para disparar o relink no WhatsApp. ` +
                  `providerPostId=${providerState.providerPostId ?? "indisponivel"} ` +
                  `providerPlatformPostId=${providerState.providerPlatformPostId ?? "indisponivel"} ` +
                  `platformUrlSource=${providerState.platformUrlSource ?? "indisponivel"} ` +
                  `resultsCount=${providerState.resultsCount} ` +
                  `urlCandidates=${debugCandidates}.`,
              });
            }
          }
        } catch (error) {
          await appendLog({
            companyId: job.companyId,
            level: "WARN",
            errorCode: "POST_FOR_ME_META_SYNC_FAILED",
            message:
              `Job ${job.id} não conseguiu sincronizar o resultado do Post for Me neste ciclo: ` +
              `${error instanceof Error ? error.message : "erro desconhecido"}`,
          });
        } finally {
          await relinkLock.release();
        }
      }
    } catch (error) {
      console.error("Post for Me meta sync worker error", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, POST_FOR_ME_WHATSAPP_RELINK_WORKER_INTERVAL_MS);
}

async function executeWhatsappRunningJob(job: {
  id: string;
  companyId: string;
  caption: string | null;
  locationName: string | null;
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
  const relinkParentJobId = parseWhatsappRelinkParentMarker(job.locationName);
  const isWhatsappRelinkChild = Boolean(relinkParentJobId);

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
          `Job ${job.id} confirmado no histórico do WhatsApp. ` +
          `remoteJid=${delivery.remoteJid ?? "status@broadcast"} messageId=${delivery.messageId ?? "indisponivel"}`,
      });

      if (relinkParentJobId) {
        await appendWhatsappRelinkChildAviso(relinkParentJobId, connection, {
          title: "Relink postado no WhatsApp",
          kind: "JOB_SENT",
          messageForAccount: (accountLabel) => `O relink foi postado no WhatsApp ${accountLabel}.`,
        });
        await syncWhatsappRelinkParentJobOutcome(relinkParentJobId);
        return;
      }

      await appendJobAvisoSafely(job, {
        title: "Postagem enviada",
        kind: "JOB_SENT",
        message: "Publicacao concluida com sucesso.",
      });
      return;
    }

    if (isWhatsappRelinkChild) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: delivery.messageId ? "COMPLETED" : "FAILED",
          completedAt: new Date(),
          lastError: delivery.messageId ? null : "O WhatsApp não confirmou a publicação do relink.",
        },
      });

      await appendLog({
        companyId: job.companyId,
        level: delivery.messageId ? "WARN" : "ERROR",
        errorCode: delivery.messageId ? "WHATSAPP_RELINK_ACCEPTED_WITHOUT_CONFIRMATION" : "WHATSAPP_RELINK_NOT_CONFIRMED",
        message:
          delivery.messageId
            ? `Job ${job.id} teve o relink aceito pelo WhatsApp sem confirmação final explícita. ` +
              `remoteJid=${delivery.remoteJid ?? "status@broadcast"} messageId=${delivery.messageId}`
            : `Job ${job.id} não recebeu confirmação final do WhatsApp para o relink. ` +
              `remoteJid=${delivery.remoteJid ?? "status@broadcast"} messageId=${delivery.messageId ?? "indisponivel"}`,
      });

      if (relinkParentJobId) {
        if (delivery.messageId) {
          await appendWhatsappRelinkChildAviso(relinkParentJobId, connection, {
            title: "Relink postado no WhatsApp",
            kind: "JOB_SENT",
            messageForAccount: (accountLabel) => `O relink foi postado no WhatsApp ${accountLabel}.`,
          });
        }
        await syncWhatsappRelinkParentJobOutcome(relinkParentJobId);
      }
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

    if (relinkParentJobId) {
      if (waitingLogin) {
        await appendWhatsappRelinkChildAviso(relinkParentJobId, connection, {
          title: "Aguardando autenticação",
          kind: "JOB_WAITING_LOGIN",
          messageForAccount: (accountLabel) =>
            `A conta ${accountLabel} do WhatsApp precisa ser autenticada novamente para receber o relink.`,
        });
      }
      await syncWhatsappRelinkParentJobOutcome(relinkParentJobId);
      return;
    }

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
  let job:
    | {
        id: string;
        companyId: string;
        createdByUserId: string | null;
        socialConnectionId: string | null;
        filePath: string;
        title: string | null;
        caption: string | null;
        firstComment: string | null;
        hashtags: unknown;
        locationName: string | null;
        whatsappBackgroundColor: string | null;
        whatsappRelinkEnabled: boolean;
        whatsappRelinkConnectionIds: unknown;
        whatsappRelinkDispatchedAt: Date | null;
        instagramPermalink: string | null;
        publicationType: string;
        postStory: boolean;
        postReel: boolean;
        postWhatsapp: boolean;
        modoWhatsapp: string;
        dataPostagem: Date;
        publicationState: string;
        status: string;
        tentativas: number;
        criadoEm: Date;
        startedAt: Date | null;
        completedAt: Date | null;
        lastError: string | null;
      }
    | null = null;

  try {
    job = await prisma.job.findUnique({
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
      if (
        (queueMessage.platform === "instagram" ||
          queueMessage.platform === "facebook" ||
          queueMessage.platform === "threads" ||
          queueMessage.platform === "tiktok" ||
          queueMessage.platform === "x") &&
        (await tryRecoverPostForMeManagedMetaJobAfterConnectionLoss(job, queueMessage.platform))
      ) {
        return "ack";
      }
      await failJobDueToConnectionUnavailable(job, {
        errorCode: "SOCIAL_CONNECTION_MISSING",
        message: "Conta social removida deste agendamento. Edite o agendamento e selecione uma conta conectada.",
      });
      return "ack";
    }

    if (queueMessage.platform !== "whatsapp") {
      const connection = await prisma.socialConnection.findFirst({
        where: {
          id: job.socialConnectionId,
          companyId: job.companyId,
          platform: queueMessage.platform,
        },
      });

      if (!connection) {
        if (
          (queueMessage.platform === "instagram" ||
            queueMessage.platform === "facebook" ||
            queueMessage.platform === "threads" ||
            queueMessage.platform === "tiktok" ||
            queueMessage.platform === "x") &&
          (await tryRecoverPostForMeManagedMetaJobAfterConnectionLoss(job, queueMessage.platform))
        ) {
          return "ack";
        }
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
        const hasProviderExecutionAccess =
          isPostForMeProviderConnection(connection) && Boolean(connection.providerAccountId?.trim());
        const hasNativeExecutionAccess = !isPostForMeProviderConnection(connection) && Boolean(connection.secretCipher);

        if (connection.authStatus !== "CONNECTED" || (!hasProviderExecutionAccess && !hasNativeExecutionAccess)) {
          const platformLabel = socialPlatformNoticeLabel(queueMessage.platform);
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "WAITING_LOGIN",
              lastError: `Aguardando autenticação do ${platformLabel}.`,
            },
          });

          await appendJobAvisoSafely(job, {
            title: "Aguardando autenticação",
            kind: "JOB_WAITING_LOGIN",
            message: `A conta do ${platformLabel} precisa ser autenticada para continuar.`,
          });
          return "ack";
        }

        if (queueMessage.platform === "instagram") {
          await executeInstagramRunningJob(job, connection);
        } else {
          await executePostForMeManagedMetaRunningJob(job, connection as typeof connection & {
            platform: "facebook" | "threads" | "tiktok" | "x";
          });
        }
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
  } catch (error) {
    return await failJobDueToUnhandledConsumerCrash(queueMessage, job, error);
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
        notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

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
          notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

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

app.get("/events", async (request, response) => {
  const sessionToken = typeof request.query.sessionToken === "string" ? request.query.sessionToken.trim() : "";
  if (!sessionToken) {
    response.status(401).json({ error: "Sessao invalida ou expirada." });
    return;
  }

  const user = await prisma.user.findFirst({
    where: {
      sessionToken,
    },
    select: {
      id: true,
      username: true,
    },
  });

  if (!user) {
    response.status(401).json({ error: "Sessao invalida ou expirada." });
    return;
  }

  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();

  const clientId = createHash("sha1")
    .update(`${user.id}:${Date.now()}:${Math.random()}:${user.username}`)
    .digest("hex");

  const heartbeatIntervalId = setInterval(() => {
    try {
      writeLiveEvent(response, {
        type: "ping",
        issuedAt: new Date().toISOString(),
      });
    } catch {
      unregisterLiveEventClient(user.id, clientId);
    }
  }, LIVE_EVENTS_HEARTBEAT_INTERVAL_MS);

  registerLiveEventClient(user.id, clientId, {
    response,
    heartbeatIntervalId,
  });

  writeLiveEvent(response, {
    type: "connected",
    scopes: [],
    issuedAt: new Date().toISOString(),
  });

  request.on("close", () => {
    unregisterLiveEventClient(user.id, clientId);
    response.end();
  });
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

app.get("/auth/workspace-access", async (request, response) => {
  const query = workspaceInviteQuerySchema.parse(request.query);
  const invite = await prisma.companyInvite.findFirst({
    where: {
      inviteKey: query.key,
      revokedAt: null,
      usedAt: null,
    },
    select: {
      id: true,
      role: true,
      createdAt: true,
      company: {
        select: {
          id: true,
          name: true,
          kind: true,
        },
      },
    },
  });

  if (!invite) {
    response.status(404).json({ error: "Convite de workspace inválido, revogado ou já utilizado." });
    return;
  }

  response.json({
    valid: true,
    role: invite.role,
    createdAt: invite.createdAt,
    workspace: invite.company,
  });
});

app.post("/auth/workspace-access/accept", adminAuthMiddleware, async (request, response) => {
  const payload = workspaceInviteQuerySchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  try {
    const workspace = await acceptWorkspaceInviteForUser(payload.key, authRequest.adminUser!.id);
    if (!workspace) {
      response.status(404).json({ error: "Workspace não encontrado após aceitar o convite." });
      return;
    }

    response.status(201).json({
      workspace: mapWorkspaceForClient(authRequest, workspace),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKSPACE_INVITE_INVALID";
    if (message === "WORKSPACE_ALREADY_HAS_CLIENT") {
      response.status(409).json({ error: "Este workspace já possui um cliente ativo." });
      return;
    }

    response.status(400).json({ error: "Convite de workspace inválido, revogado ou já utilizado." });
  }
});

app.post("/auth/workspace-access/setup", async (request, response) => {
  const payload = createUserFromWorkspaceInviteSchema.parse(request.body);
  const existingInvite = await prisma.companyInvite.findFirst({
    where: {
      inviteKey: payload.key,
      revokedAt: null,
      usedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!existingInvite) {
    response.status(404).json({ error: "Convite de workspace inválido, revogado ou já utilizado." });
    return;
  }

  const existingUser = await prisma.user.findUnique({
    where: { username: payload.username },
  });

  if (existingUser) {
    response.status(409).json({ error: "Ja existe um usuario com esse username." });
    return;
  }

  try {
    const createdUser = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
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
          timeZone: true,
          role: true,
        },
      });

      await acceptWorkspaceInviteForUser(payload.key, user.id, transaction);
      return user;
    });

    const sessionToken = createRandomToken();
    const authenticatedUser = await prisma.user.update({
      where: { id: createdUser.id },
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
    response.status(201).json({
      sessionToken,
      user: authUserPayload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKSPACE_INVITE_INVALID";
    if (message === "WORKSPACE_ALREADY_HAS_CLIENT") {
      response.status(409).json({ error: "Este workspace já possui um cliente ativo." });
      return;
    }
    response.status(400).json({ error: "Convite de workspace inválido, revogado ou já utilizado." });
  }
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
        tokenExpiresAt: null,
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
        tokenExpiresAt: null,
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
    const preferredInstagramIdentifier =
      INSTAGRAM_OAUTH_FLOW_RUNTIME === "facebook_login" ? connection.loginIdentifier : undefined;
    const oauthResult = await exchangeInstagramOAuthCodeForConnection({
      authorizationCode: code,
      preferredInstagramIdentifier,
    });
    const now = new Date();

    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        authStatus: "CONNECTED",
        loginIdentifier: oauthResult.instagramUsername?.trim() || connection.loginIdentifier,
        secretCipher: encodeSecret(oauthResult.accessToken),
        authLaunchUrl: null,
        tokenExpiresAt: resolveConnectionTokenExpiresAt(oauthResult.tokenExpiresInSeconds, now),
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
        tokenExpiresAt: null,
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

app.get("/oauth/threads/callback", async (request, response) => {
  const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
  const code = typeof request.query.code === "string" ? request.query.code.trim() : "";
  const oauthError = typeof request.query.error === "string" ? request.query.error.trim() : "";
  const oauthErrorDescription =
    typeof request.query.error_description === "string" ? request.query.error_description.trim() : "";
  const consumedState = consumeThreadsOAuthState(state);

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

  if (!connection || connection.platform !== "threads") {
    respondInstagramOAuthResult(response, {
      statusCode: 404,
      success: false,
      connectionId: consumedState.connectionId,
      returnToUrl: consumedState.returnToUrl,
      message: "Conta do Threads não encontrada para concluir a autorização.",
    });
    return;
  }

  if (oauthError) {
    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        authStatus: "AUTH_REQUIRED",
        authLaunchUrl: null,
        tokenExpiresAt: null,
        lastSeenAt: null,
      },
    });

    const errorMessage = oauthErrorDescription || oauthError;
    await appendLog({
      companyId: connection.companyId,
      level: "WARN",
      errorCode: "THREADS_OAUTH_DENIED",
      message: `Autorização Threads cancelada para ${connection.displayName}: ${errorMessage}`,
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
        tokenExpiresAt: null,
        lastSeenAt: null,
      },
    });

    await appendLog({
      companyId: connection.companyId,
      level: "ERROR",
      errorCode: "THREADS_OAUTH_CODE_MISSING",
      message: `Falha ao concluir OAuth da conta ${connection.displayName}: código não retornado pelo Threads.`,
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
    const oauthResult = await exchangeThreadsOAuthCodeForConnection({
      authorizationCode: code,
    });
    const now = new Date();

    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        authStatus: "CONNECTED",
        loginIdentifier: oauthResult.threadsUsername?.trim() || connection.loginIdentifier,
        secretCipher: encodeSecret(oauthResult.accessToken),
        authLaunchUrl: null,
        tokenExpiresAt: resolveConnectionTokenExpiresAt(oauthResult.tokenExpiresInSeconds, now),
        lastAuthAt: now,
        lastSeenAt: now,
      },
    });

    await appendLog({
      companyId: connection.companyId,
      level: "INFO",
      message: `Conta ${connection.displayName} conectada via OAuth (Threads @${oauthResult.threadsUsername || "sem-username"}).`,
    });

    respondInstagramOAuthResult(response, {
      statusCode: 200,
      success: true,
      connectionId: connection.id,
      returnToUrl: consumedState.returnToUrl,
      message: `Conta conectada com sucesso${oauthResult.threadsUsername ? ` (@${oauthResult.threadsUsername})` : ""}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "THREADS_OAUTH_CALLBACK_UNKNOWN_ERROR";

    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        authStatus: "AUTH_REQUIRED",
        secretCipher: null,
        authLaunchUrl: null,
        tokenExpiresAt: null,
        lastSeenAt: null,
      },
    });

    await appendLog({
      companyId: connection.companyId,
      level: "ERROR",
      errorCode: normalizeAutomationErrorCode(message),
      message: `Falha ao conectar conta ${connection.displayName} via OAuth do Threads: ${message}`,
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

app.all("/oauth/threads/deauthorize", express.urlencoded({ extended: false }), async (_request, response) => {
  response
    .status(200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .send("<html><body><p>Desautorização do Threads recebida com sucesso.</p></body></html>");
});

app.post("/oauth/threads/data-deletion", express.urlencoded({ extended: false }), async (request, response) => {
  cleanupMetaDataDeletionRequests(Date.now());
  const confirmationCode = createRandomToken(12);
  metaDataDeletionRequestByCode.set(confirmationCode, {
    platform: "threads",
    createdAtMs: Date.now(),
  });

  const publicBaseUrl = resolveOauthPublicBaseUrl(request);
  const statusUrl = publicBaseUrl
    ? `${publicBaseUrl}/oauth/threads/data-deletion-status/${encodeURIComponent(confirmationCode)}`
    : `/oauth/threads/data-deletion-status/${encodeURIComponent(confirmationCode)}`;

  response.json({
    url: statusUrl,
    confirmation_code: confirmationCode,
  });
});

app.get("/oauth/threads/data-deletion-status/:code", async (request, response) => {
  cleanupMetaDataDeletionRequests(Date.now());
  const code = request.params.code.trim();
  const entry = metaDataDeletionRequestByCode.get(code);

  response.json({
    confirmationCode: code,
    platform: "threads",
    status: entry ? "received" : "unknown",
    message: entry
      ? "Solicitação de exclusão registrada com sucesso."
      : "Nenhuma solicitação encontrada para este código.",
  });
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

  if (!job || !isInstagramPublication(normalizePublicationType(job))) {
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
  if (!job.instagramPermalink) {
    response.type("html").send(
      renderInstagramSharePendingPage({
        shareUrl,
        previewTitle,
        previewDescription,
        previewImageUrl,
      }),
    );
    return;
  }

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

app.post(POST_FOR_ME_WEBHOOK_PATH, async (request, response) => {
  const { secret: configuredSecret } = await resolveEffectivePostForMeWebhookSecret();
  if (!configuredSecret) {
    response.status(503).json({
      error: "Webhook do Post for Me indisponível. Configure o secret no SocialUp ou em POST_FOR_ME_WEBHOOK_SECRET.",
    });
    return;
  }

  const secretHeader = request.headers["post-for-me-webhook-secret"];
  const providedSecret = Array.isArray(secretHeader) ? secretHeader[0]?.trim() : `${secretHeader || ""}`.trim();
  if (!providedSecret) {
    response.status(400).json({ error: "Cabeçalho Post-For-Me-Webhook-Secret ausente." });
    return;
  }

  if (providedSecret !== configuredSecret) {
    response.status(401).json({ error: "Webhook do Post for Me com secret inválido." });
    return;
  }

  try {
    await handlePostForMeAccountWebhook(request.body);
    response.json({ received: true });
  } catch (error) {
    console.error("Post for Me webhook processing failed", error);
    response.status(500).json({ error: "Falha ao processar webhook do Post for Me." });
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
      let effectiveConnection = syncedConnection;

      if (
        (
          (syncedConnection.platform === "instagram" &&
            runtimeMetadata.instagramUsername &&
            runtimeMetadata.instagramUsername !== syncedConnection.loginIdentifier) ||
          (syncedConnection.platform === "threads" &&
            runtimeMetadata.threadsUsername &&
            runtimeMetadata.threadsUsername !== syncedConnection.loginIdentifier)
        )
      ) {
        effectiveConnection = await prisma.socialConnection.update({
          where: { id: syncedConnection.id },
          data: {
            loginIdentifier:
              syncedConnection.platform === "instagram"
                ? runtimeMetadata.instagramUsername
                : runtimeMetadata.threadsUsername,
          },
        });
      }

      return {
        ...mapConnection(effectiveConnection),
        ...runtimeMetadata,
      };
    }),
  );

  response.json(mappedConnections);
});

app.get("/connections/:id/instagram-location-candidates", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!connection || connection.platform !== "instagram") {
    response.status(404).json({ error: "Conta do Instagram não encontrada." });
    return;
  }

  const workspace = connection.company as WorkspacePermissionContext;
  if (!canCurrentUserAccessWorkspace(authRequest, workspace)) {
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

app.get("/jobs/meta-location-suggestions", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q : "";
  const suggestions = searchMetaLocationCatalog(query, 10);
  response.json(suggestions);
});

app.post("/connections", async (request, response) => {
  const payload = createConnectionSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const loginIdentifier = payload.loginIdentifier?.trim() || null;
  const secretCipher = encodeSecret(payload.secret);
  let company: WorkspacePermissionContext;
  try {
    company = await assertWorkspaceVisibleForRequest(authRequest, payload.companyId);
  } catch (error) {
    response.status(error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? 400 : 403).json({
      error:
        error instanceof Error && error.message === "WORKSPACE_NOT_FOUND"
          ? "Workspace inválido. Selecione um workspace existente."
          : "Você não pode adicionar conta neste workspace.",
    });
    return;
  }

  if (!canCurrentUserConnectWorkspaceAccounts(authRequest, company)) {
    response.status(403).json({ error: "Você não pode conectar contas neste workspace." });
    return;
  }

  const resolvedDisplayName = payload.displayName?.trim() || defaultConnectionDisplayNameForPlatform(payload.platform);

  if (company.status !== "ACTIVE") {
    response.status(409).json({ error: "Este workspace está inativo e não aceita novas conexões." });
    return;
  }

  const billingAccess = isRootUser(authRequest) ? null : await ensureWorkspaceOwnerBillingWritableAccess(company);
  if (billingAccess && billingAccess.plan && billingAccess.usage.connectionsUsed >= billingAccess.plan.maxConnections) {
    response.status(409).json({
      error: `Seu plano atingiu o limite de ${billingAccess.plan.maxConnections} conta(s) conectada(s).`,
    });
    return;
  }

  const existingConnectionForPlatform = await prisma.socialConnection.findFirst({
    where: {
      companyId: payload.companyId,
      platform: payload.platform,
    },
    select: {
      id: true,
    },
  });

  if (existingConnectionForPlatform) {
    response.status(409).json({
      error: "Só é permitido adicionar 1 tipo de rede social por workspace.",
    });
    return;
  }

  const launchUrl = defaultAuthLaunchUrlForPlatform(payload.platform);
  const isPostForMeConnection = isPostForMeManagedPlatform(payload.platform);
  const resolvedLoginIdentifier =
    payload.platform === "whatsapp" && !isWhatsappEvolutionHardcodedEnabled()
      ? loginIdentifier || buildAutoWhatsappInstanceName(`${payload.companyId}:${payload.platform}:${Date.now()}`)
      : loginIdentifier;
  const createdConnection = await prisma.socialConnection.create({
    data: {
      companyId: payload.companyId,
      createdByUserId: authRequest.adminUser!.id,
      platform: payload.platform,
      provider: isPostForMeConnection ? "POST_FOR_ME" : "NATIVE",
      displayName: resolvedDisplayName,
      loginIdentifier: resolvedLoginIdentifier,
      secretCipher,
      authStatus: "AUTH_REQUIRED",
      automationMode: "VISUAL",
      authLaunchUrl: launchUrl,
      tokenExpiresAt: null,
      providerStatus: isPostForMeConnection ? "awaiting_remote_connection" : null,
    },
  });

  const connection = isPostForMeConnection
    ? await prisma.socialConnection.update({
        where: { id: createdConnection.id },
        data: {
          providerExternalId: buildPostForMeConnectionExternalId(createdConnection.id),
        },
      })
    : createdConnection;

  await appendLog({
    companyId: payload.companyId,
    level: "INFO",
    message: `Conta ${resolvedDisplayName} (${payload.platform}) criada e pronta para autenticação.`,
  });

  response.status(201).json(mapConnection(connection));
});

app.put("/connections/:id", async (request, response) => {
  const payload = updateConnectionSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingConnection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!existingConnection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  const workspace = existingConnection.company as WorkspacePermissionContext;
  if (!canCurrentUserManageWorkspace(authRequest, workspace) && !canCurrentUserConnectWorkspaceAccounts(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode editar esta conta." });
    return;
  }

  const nextLoginIdentifier =
    payload.loginIdentifier !== undefined ? payload.loginIdentifier?.trim() || null : existingConnection.loginIdentifier;
  const nextSecretCipher =
    payload.secret !== undefined ? encodeSecret(payload.secret) : existingConnection.secretCipher;
  const resolvedNextLoginIdentifier =
    existingConnection.platform === "whatsapp" && !isWhatsappEvolutionHardcodedEnabled()
      ? nextLoginIdentifier || buildAutoWhatsappInstanceName(existingConnection.id)
      : nextLoginIdentifier;

  const connection = await prisma.socialConnection.update({
    where: { id: request.params.id },
    data: {
      displayName: payload.displayName,
      loginIdentifier: resolvedNextLoginIdentifier,
      secretCipher: nextSecretCipher,
      tokenExpiresAt: payload.secret !== undefined ? null : existingConnection.tokenExpiresAt,
    },
  });

  response.json(mapConnection(connection));
});

app.put("/connections/:id/agency-refresh", async (request, response) => {
  const payload = setConnectionAgencyRefreshSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  const workspace = connection.company as WorkspacePermissionContext;
  if (workspace.kind !== "CLIENT") {
    response.status(409).json({ error: "A autorização de renovação só se aplica a workspaces de cliente." });
    return;
  }

  if (!canCurrentUserConnectWorkspaceAccounts(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode alterar esta autorização." });
    return;
  }

  const updatedConnection = await prisma.socialConnection.update({
    where: { id: connection.id },
    data: {
      agencyCanRefresh: payload.enabled,
    },
  });

  response.json(mapConnection(updatedConnection));
});

app.post("/connections/:id/open-visual-auth", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const payload = openVisualAuthSchema.parse(request.body ?? {});
  const connection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  const workspace = connection.company as WorkspacePermissionContext;
  const canConnectAccounts = canCurrentUserConnectWorkspaceAccounts(authRequest, workspace);
  const canRenewAccess = canCurrentUserRenewConnectionAccess(authRequest, workspace, connection);
  if (!canConnectAccounts && !canRenewAccess) {
    response.status(403).json({ error: "Você não pode autenticar esta conta." });
    return;
  }

  if (workspace.status !== "ACTIVE") {
    response.status(409).json({ error: "Este workspace está inativo." });
    return;
  }

  if (isPostForMeProviderConnection(connection)) {
    const connectionExternalId = resolvePostForMeStoredExternalId(connection);
    let launchUrl: string;
    try {
      launchUrl = await createPostForMeSocialAccountAuthUrl({
        platform: connection.platform,
        externalId: connectionExternalId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "POST_FOR_ME_CONFIG_MISSING";
      response.status(400).json({
        error: message.startsWith("POST_FOR_ME_CONFIG_MISSING:")
          ? `Provedor externo não configurado no backend: ${message.replace("POST_FOR_ME_CONFIG_MISSING:", "")}.`
          : message === "POST_FOR_ME_NETWORK_ERROR:/social-accounts/auth-url:CONNECT_TIMEOUT"
            ? "O provedor externo demorou demais para responder. Tente novamente em instantes."
            : message === "POST_FOR_ME_NETWORK_ERROR:/social-accounts/auth-url:REQUEST_TIMEOUT"
              ? "O provedor externo não respondeu a tempo. Tente novamente em instantes."
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
        providerExternalId: connectionExternalId,
        providerStatus: "auth_in_progress",
      },
    });

    await appendLog({
      companyId: updatedConnection.companyId,
      level: "INFO",
      message: `Fluxo de autorização Post for Me iniciado para ${updatedConnection.displayName}.`,
    });

    response.json({
      connection: mapConnection(updatedConnection),
      launchUrl,
    });
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

    try {
      await requestWhatsappQr(updatedConnection.id, false);
    } catch (error) {
      const message = humanizeWhatsappQrErrorMessage(
        error instanceof Error && error.message ? error.message : "Falha ao iniciar a geracao do QR do WhatsApp.",
      );

      await appendLog({
        companyId: updatedConnection.companyId,
        level: "ERROR",
        errorCode: "WHATSAPP_QR_REQUEST_FAILED",
        message,
      });

      await prisma.socialConnection.update({
        where: { id: updatedConnection.id },
        data: {
          authStatus: "AUTH_REQUIRED",
          lastSeenAt: null,
        },
      });

      response.status(400).json({
        error: message,
      });
      return;
    }

    await appendLog({
      companyId: updatedConnection.companyId,
      level: "INFO",
      message: `Fluxo de QR iniciado para ${updatedConnection.displayName}.`,
    });

    response.json({
      connection: mapConnection(updatedConnection),
      launchUrl: updatedConnection.authLaunchUrl,
    });
    return;
  }

  let launchUrl: string;
  try {
      launchUrl =
        connection.platform === "threads"
          ? createThreadsOAuthLaunchUrl(connection.id, {
            returnToUrl: payload.returnToUrl ?? null,
          })
        : createInstagramOAuthLaunchUrl(connection.id, {
            returnToUrl: payload.returnToUrl ?? null,
          });
  } catch (error) {
    const message = error instanceof Error ? error.message : "META_OAUTH_CONFIG_MISSING";
    response.status(400).json({
      error:
        connection.platform === "threads"
          ? message.startsWith("THREADS_CONFIG_MISSING:")
            ? `Threads API não configurada no backend: ${message.replace("THREADS_CONFIG_MISSING:", "")}.`
            : message
          : message.startsWith("INSTAGRAM_GRAPH_CONFIG_MISSING:")
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

app.post("/connections/:id/sync-provider", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const payload = syncProviderConnectionSchema.parse(request.body ?? {});
  const connection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  const workspace = connection.company as WorkspacePermissionContext;
  if (
    !canCurrentUserConnectWorkspaceAccounts(authRequest, workspace) &&
    !canCurrentUserRenewConnectionAccess(authRequest, workspace, connection)
  ) {
    response.status(403).json({ error: "Você não pode renovar esta conta." });
    return;
  }

  if (workspace.status !== "ACTIVE") {
    response.status(409).json({ error: "Este workspace está inativo." });
    return;
  }

  if (!isPostForMeProviderConnection(connection)) {
    response.status(400).json({ error: "Esta conta não usa um provedor externo compatível." });
    return;
  }

  try {
    const syncResult = await syncPostForMeConnectionsForBase({
      baseConnectionId: connection.id,
      actorUserId: authRequest.adminUser!.id,
      providerAccountIdHint: payload.providerAccountIdHint ?? null,
    });

    response.json({
      primaryConnection: mapConnection(syncResult.primaryConnection),
      importedConnections: syncResult.importedConnections.map((item) => mapConnection(item)),
      remoteCount: syncResult.remoteCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "POST_FOR_ME_SYNC_FAILED";
    response.status(400).json({
      error: message.startsWith("POST_FOR_ME_CONFIG_MISSING:")
        ? `Provedor externo não configurado no backend: ${message.replace("POST_FOR_ME_CONFIG_MISSING:", "")}.`
        : message,
    });
  }
});

app.post("/connections/:id/regenerate-qr", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  const workspace = connection.company as WorkspacePermissionContext;
  if (!canCurrentUserConnectWorkspaceAccounts(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode gerar QR para esta conta." });
    return;
  }

  if (workspace.status !== "ACTIVE") {
    response.status(409).json({ error: "Este workspace está inativo." });
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

  try {
    await requestWhatsappQr(updatedConnection.id, true);
  } catch (error) {
    const message = humanizeWhatsappQrErrorMessage(
      error instanceof Error && error.message ? error.message : "Falha ao gerar um novo QR do WhatsApp.",
    );

    await appendLog({
      companyId: updatedConnection.companyId,
      level: "ERROR",
      errorCode: "WHATSAPP_QR_REQUEST_FAILED",
      message,
    });

    await prisma.socialConnection.update({
      where: { id: updatedConnection.id },
      data: {
        authStatus: "AUTH_REQUIRED",
        lastSeenAt: null,
      },
    });

    response.status(400).json({
      error: message,
    });
    return;
  }

  await appendLog({
    companyId: updatedConnection.companyId,
    level: "WARN",
    message: `Novo QR solicitado para a conta ${updatedConnection.displayName}.`,
  });

  response.json(mapConnection(updatedConnection));
});

app.post("/connections/:id/dismiss-qr", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  const workspace = connection.company as WorkspacePermissionContext;
  if (!canCurrentUserConnectWorkspaceAccounts(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode encerrar o QR desta conta." });
    return;
  }

  if (workspace.status !== "ACTIVE") {
    response.status(409).json({ error: "Este workspace está inativo." });
    return;
  }

  if (connection.platform !== "whatsapp") {
    response.status(400).json({ error: "Fechamento de QR disponivel apenas para contas de WhatsApp." });
    return;
  }

  let runtimeAuthStatus = await resolveWhatsappConnectionRuntimeAuthStatus({
    id: connection.id,
    companyId: connection.companyId,
    displayName: connection.displayName,
    platform: connection.platform,
    loginIdentifier: connection.loginIdentifier,
    secretCipher: connection.secretCipher ?? null,
  }).catch(() => null);

  if (runtimeAuthStatus !== "CONNECTED") {
    const becameConnected = await waitForWhatsappRuntimeConnected(connection, 5_000, 500);
    if (becameConnected) {
      runtimeAuthStatus = "CONNECTED";
    }
  }

  if (runtimeAuthStatus === "CONNECTED") {
    const updatedConnection = await prisma.socialConnection.update({
      where: { id: request.params.id },
      data: {
        authStatus: "CONNECTED",
        authLaunchUrl: null,
        lastAuthAt: connection.lastAuthAt ?? new Date(),
        lastSeenAt: new Date(),
      },
    });

    await dismissWhatsappQr(updatedConnection.id);

    await appendLog({
      companyId: updatedConnection.companyId,
      level: "INFO",
      message: `Conta ${updatedConnection.displayName} conectada ao fechar o modal de QR.`,
    });

    response.json(mapConnection(updatedConnection));
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

app.post("/connections/:id/cancel-auth", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  const workspace = connection.company as WorkspacePermissionContext;
  if (!canCurrentUserConnectWorkspaceAccounts(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode alterar esta conta." });
    return;
  }

  const shouldPreservePostForMeLinkedAccount =
    isPostForMeProviderConnection(connection) && Boolean(connection.providerAccountId?.trim());

  const updatedConnection = await prisma.socialConnection.update({
    where: { id: request.params.id },
    data: {
      authStatus: shouldPreservePostForMeLinkedAccount ? "CONNECTED" : "AUTH_REQUIRED",
      authLaunchUrl: null,
      lastSeenAt: shouldPreservePostForMeLinkedAccount ? connection.lastSeenAt : null,
      providerStatus: shouldPreservePostForMeLinkedAccount
        ? "connected"
        : isPostForMeManagedPlatform(connection.platform) && connection.providerStatus === "auth_in_progress"
          ? "disconnected"
          : connection.providerStatus,
    },
  });

  response.json(mapConnection(updatedConnection));
});

app.post("/connections/:id/disconnect", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const connection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  const workspace = connection.company as WorkspacePermissionContext;
  if (!canCurrentUserConnectWorkspaceAccounts(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode desconectar esta conta." });
    return;
  }

  if (workspace.status !== "ACTIVE") {
    response.status(409).json({ error: "Este workspace está inativo." });
    return;
  }

  if (
    isPostForMeProviderConnection(connection) &&
    connection.providerAccountId &&
    (await shouldDisconnectPostForMeSocialAccountRemotely({
      providerAccountId: connection.providerAccountId,
      excludeConnectionIds: [connection.id],
    }))
  ) {
    try {
      await disconnectPostForMeSocialAccount(connection.providerAccountId);
    } catch (error) {
      await appendLog({
        companyId: connection.companyId,
        level: "WARN",
        errorCode: "POST_FOR_ME_DISCONNECT_FAILED",
        message:
          error instanceof Error && error.message
            ? `Falha ao desconectar conta remota do Post for Me: ${error.message}`
            : "Falha ao desconectar conta remota do Post for Me.",
      });
    }
  }

  const updatedConnection = await prisma.socialConnection.update({
    where: { id: request.params.id },
    data: {
      authStatus: "AUTH_REQUIRED",
      secretCipher: isLegacyMetaOAuthPlatform(connection.platform) || isPostForMeManagedPlatform(connection.platform)
        ? null
        : connection.secretCipher,
      tokenExpiresAt: isLegacyMetaOAuthPlatform(connection.platform) || isPostForMeManagedPlatform(connection.platform)
        ? null
        : connection.tokenExpiresAt,
      lastAuthAt:
        connection.platform === "whatsapp" || isLegacyMetaOAuthPlatform(connection.platform) || isPostForMeManagedPlatform(connection.platform)
        ? null
        : connection.lastAuthAt,
      authLaunchUrl:
        connection.platform === "whatsapp" || isLegacyMetaOAuthPlatform(connection.platform) || isPostForMeManagedPlatform(connection.platform)
        ? null
        : connection.authLaunchUrl,
      lastSeenAt: null,
      providerAccountId: isPostForMeManagedPlatform(connection.platform) ? null : connection.providerAccountId,
      providerStatus: isPostForMeManagedPlatform(connection.platform) ? "disconnected" : connection.providerStatus,
      ...(isPostForMeManagedPlatform(connection.platform) ? { providerMetadata: Prisma.JsonNull } : {}),
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
  const connection = await findConnectionWithWorkspaceContext(request.params.id);

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
    return;
  }

  const workspace = connection.company as WorkspacePermissionContext;
  const canConnectAccounts = canCurrentUserConnectWorkspaceAccounts(authRequest, workspace);
  const canManageWorkspace = canCurrentUserManageWorkspace(authRequest, workspace);
  if (!canConnectAccounts && !canManageWorkspace) {
    response.status(403).json({ error: "Você não pode excluir esta conta." });
    return;
  }

  if (workspace.status !== "ACTIVE" && !canManageWorkspace) {
    response.status(409).json({ error: "Este workspace está inativo." });
    return;
  }

  if (!canConnectAccounts && connection.authStatus === "CONNECTED") {
    response.status(409).json({
      error: "Somente o responsável pela conexão pode remover uma conta ainda ativa.",
    });
    return;
  }

  if (canConnectAccounts && connection.platform === "whatsapp") {
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

  if (
    canConnectAccounts &&
    isPostForMeProviderConnection(connection) &&
    connection.providerAccountId &&
    (await shouldDisconnectPostForMeSocialAccountRemotely({
      providerAccountId: connection.providerAccountId,
      excludeConnectionIds: [connection.id],
    }))
  ) {
    try {
      await disconnectPostForMeSocialAccount(connection.providerAccountId);
    } catch (error) {
      await appendLog({
        companyId: connection.companyId,
        level: "WARN",
        errorCode: "POST_FOR_ME_DISCONNECT_FAILED",
        message:
          error instanceof Error && error.message
            ? `Falha ao desconectar conta remota do Post for Me antes da exclusão: ${error.message}`
            : "Falha ao desconectar conta remota do Post for Me antes da exclusão.",
      });

      response.status(502).json({
        error:
          error instanceof Error && error.message
            ? `Não foi possível excluir a conta porque a desconexão remota falhou: ${error.message}`
            : "Não foi possível excluir a conta porque a desconexão remota falhou.",
      });
      return;
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
    select: {
      id: true,
      name: true,
      color: true,
      createdByUserId: true,
      kind: true,
      status: true,
      createdAt: true,
      members: {
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
        },
      },
      invites: {
        where: {
          revokedAt: null,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          inviteKey: true,
          role: true,
          usedAt: true,
          revokedAt: true,
          createdAt: true,
          acceptedByUserId: true,
        },
      },
    },
  });
  response.json(companies.map((company) => mapWorkspaceForClient(authRequest, company)));
});

app.post("/companies", async (request, response) => {
  const payload = createCompanySchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const billingAccess = await ensureBillingWritableAccess(authRequest);
  if (!isRootUser(authRequest) && !billingAccess?.plan) {
    response.status(403).json({
      error: "Somente a conta central com plano próprio pode criar novos workspaces.",
    });
    return;
  }
  const workspaceKind = payload.kind;
  const clientWorkspaceLimit = billingAccess?.plan?.workspaceLimit ?? billingAccess?.plan?.maxProfiles ?? 0;
  const agencyBonusWorkspaceLimit = billingAccess?.plan?.agencyBonusWorkspaceLimit ?? 0;
  const reachedClientWorkspaceLimit =
    workspaceKind === "CLIENT" &&
    billingAccess &&
    billingAccess.plan &&
    billingAccess.usage.workspaceClientUsed >= clientWorkspaceLimit;
  const reachedAgencyBonusWorkspaceLimit =
    workspaceKind === "AGENCY_BONUS" &&
    billingAccess &&
    billingAccess.plan &&
    billingAccess.usage.workspaceAgencyBonusUsed >= agencyBonusWorkspaceLimit;

  if (reachedClientWorkspaceLimit) {
    response.status(409).json({
      error: `Seu plano atingiu o limite de ${clientWorkspaceLimit} workspace(s) de cliente.`,
    });
    return;
  }

  if (reachedAgencyBonusWorkspaceLimit) {
    response.status(409).json({
      error: `Seu plano atingiu o limite de ${agencyBonusWorkspaceLimit} workspace(s) bônus da agência.`,
    });
    return;
  }

  const company = await prisma.$transaction(async (transaction) => {
    const createdWorkspace = await transaction.company.create({
      data: {
        name: payload.name.trim(),
        color: trimNullable(payload.color),
        kind: workspaceKind,
        status: "ACTIVE",
        createdByUserId: authRequest.adminUser!.id,
      },
    });

    await transaction.companyMember.create({
      data: {
        companyId: createdWorkspace.id,
        userId: authRequest.adminUser!.id,
        role: "CENTRAL",
      },
    });

    return createdWorkspace;
  });

  const workspace = await findWorkspaceContextById(company.id);
  response.status(201).json(mapWorkspaceForClient(authRequest, workspace!));
});

app.put("/companies/:id", async (request, response) => {
  const payload = updateCompanySchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  let workspace: WorkspacePermissionContext;
  try {
    workspace = await assertWorkspaceVisibleForRequest(authRequest, request.params.id);
  } catch (error) {
    response.status(error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? 404 : 403).json({
      error: error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? "Workspace não encontrado." : "Você não pode editar este workspace.",
    });
    return;
  }

  if (!canCurrentUserManageWorkspace(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode editar este workspace." });
    return;
  }

  const updated = await prisma.company.update({
    where: { id: request.params.id },
    data: {
      name: payload.name?.trim(),
      status: payload.status,
      color: payload.color !== undefined ? trimNullable(payload.color) : undefined,
    },
  });

  const refreshedWorkspace = await findWorkspaceContextById(updated.id);
  response.json(mapWorkspaceForClient(authRequest, refreshedWorkspace!));
});

app.post("/companies/:id/invites", async (request, response) => {
  const payload = createWorkspaceInviteSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  let workspace: WorkspacePermissionContext;
  try {
    workspace = await assertWorkspaceVisibleForRequest(authRequest, request.params.id);
  } catch (error) {
    response.status(error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? 404 : 403).json({
      error: error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? "Workspace não encontrado." : "Você não pode convidar membros para este workspace.",
    });
    return;
  }

  if (!canCurrentUserManageWorkspaceMembers(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode convidar membros para este workspace." });
    return;
  }

  if (payload.role === "CLIENT") {
    const hasPendingClientInvite = workspace.invites.some((invite) => invite.role === "CLIENT" && !invite.usedAt);
    if (hasActiveClientWorkspaceMember(workspace) || hasPendingClientInvite) {
      response.status(409).json({ error: "Este workspace já possui um cliente convidado ou ativo." });
      return;
    }
  }

  const invite = await prisma.companyInvite.create({
    data: {
      companyId: workspace.id,
      inviteKey: createRandomToken(18),
      role: payload.role,
      invitedByUserId: authRequest.adminUser!.id,
    },
    select: {
      id: true,
      inviteKey: true,
      role: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
      acceptedByUserId: true,
    },
  });

  response.status(201).json({
    id: invite.id,
    role: invite.role,
    usedAt: invite.usedAt,
    revokedAt: invite.revokedAt,
    createdAt: invite.createdAt,
    acceptedByUserId: invite.acceptedByUserId,
    inviteUrl: buildWorkspaceInviteUrl(invite.inviteKey),
  });
});

app.delete("/companies/:id/invites/:inviteId", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  let workspace: WorkspacePermissionContext;
  try {
    workspace = await assertWorkspaceVisibleForRequest(authRequest, request.params.id);
  } catch (error) {
    response.status(error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? 404 : 403).json({
      error: error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? "Workspace não encontrado." : "Você não pode revogar convites deste workspace.",
    });
    return;
  }

  if (!canCurrentUserManageWorkspaceMembers(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode revogar convites deste workspace." });
    return;
  }

  const invite = await prisma.companyInvite.findFirst({
    where: {
      id: request.params.inviteId,
      companyId: workspace.id,
      revokedAt: null,
    },
    select: {
      id: true,
      usedAt: true,
    },
  });

  if (!invite) {
    response.status(404).json({ error: "Convite não encontrado." });
    return;
  }

  if (invite.usedAt) {
    response.status(409).json({ error: "Este convite já foi utilizado e não pode ser revogado." });
    return;
  }

  await prisma.companyInvite.update({
    where: { id: invite.id },
    data: {
      revokedAt: new Date(),
    },
  });

  response.status(204).send();
});

app.delete("/companies/:id/members/:memberId", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  let workspace: WorkspacePermissionContext;
  try {
    workspace = await assertWorkspaceVisibleForRequest(authRequest, request.params.id);
  } catch (error) {
    response.status(error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? 404 : 403).json({
      error: error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? "Workspace não encontrado." : "Você não pode remover membros deste workspace.",
    });
    return;
  }

  if (!canCurrentUserManageWorkspaceMembers(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode remover membros deste workspace." });
    return;
  }

  const member = workspace.members.find((entry) => entry.id === request.params.memberId);
  if (!member) {
    response.status(404).json({ error: "Membro não encontrado." });
    return;
  }

  if (normalizeWorkspaceMemberRole(member.role) === "CENTRAL") {
    response.status(409).json({ error: "O membro central do workspace não pode ser removido." });
    return;
  }

  await prisma.companyMember.delete({
    where: { id: member.id },
  });

  response.status(204).send();
});

app.delete("/companies/:id", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  let workspace: WorkspacePermissionContext;
  try {
    workspace = await assertWorkspaceVisibleForRequest(authRequest, request.params.id);
  } catch (error) {
    response.status(error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? 404 : 403).json({
      error: error instanceof Error && error.message === "WORKSPACE_NOT_FOUND" ? "Workspace não encontrado." : "Você não pode excluir este workspace.",
    });
    return;
  }

  if (!canCurrentUserManageWorkspace(authRequest, workspace)) {
    response.status(403).json({ error: "Você não pode excluir este workspace." });
    return;
  }

  const relatedConnections = await prisma.socialConnection.findMany({
    where: {
      companyId: workspace.id,
    },
  });

  for (const connection of relatedConnections) {
    if (connection.platform === "whatsapp") {
      await disconnectWhatsappConnectionSession(connection.id).catch(() => undefined);
    }

    if (
      isPostForMeProviderConnection(connection) &&
      connection.providerAccountId &&
      (await shouldDisconnectPostForMeSocialAccountRemotely({
        providerAccountId: connection.providerAccountId,
        excludeConnectionIds: relatedConnections.map((item) => item.id),
      }))
    ) {
      await disconnectPostForMeSocialAccount(connection.providerAccountId);
    }
  }

  await prisma.company.delete({
    where: { id: workspace.id },
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
      company: {
        select: {
          createdByUserId: true,
          members: {
            select: {
              userId: true,
            },
          },
        },
      },
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
    referencedJobs.some((job) => {
      const userId = authRequest.adminUser?.id;
      if (!userId) {
        return true;
      }
      return (
        job.company.createdByUserId !== userId &&
        !job.company.members.some((member) => member.userId === userId)
      );
    })
  ) {
    response.status(403).json({ error: "Você não pode excluir uma mídia vinculada a posts de outro workspace." });
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

  const connection = await findConnectionWithWorkspaceContext(payload.connectionId);

  if (!connection || connection.platform !== "instagram") {
    response.status(404).json({ error: "Conta do Instagram não encontrada." });
    return;
  }

  if (!canCurrentUserAccessWorkspace(authRequest, connection.company as WorkspacePermissionContext)) {
    response.status(403).json({ error: "Você não pode buscar sugestões para conta de outro workspace." });
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
  const workspace = await assertWorkspaceVisibleForRequest(authRequest, payload.companyId);
  if (workspace.status !== "ACTIVE") {
    response.status(409).json({ error: "Este workspace está inativo e não aceita novas publicações." });
    return;
  }
  const billingAccess = isRootUser(authRequest) ? null : await ensureWorkspaceOwnerBillingWritableAccess(workspace);
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
  const resolvedLocation = await resolveAutomaticMetaLocation({
    publicationType: payload.publicationType,
    socialConnectionId: payload.socialConnectionId,
    locationName: payload.locationName,
    locationId: payload.locationId,
  });
  const hashtags = normalizeHashtags(payload.publicationType, payload.hashtags);
  const metadata = ensureMetaPublicationMetadata(
    payload.publicationType,
    payload.caption,
    payload.fileCaptions,
    resolvedLocation.locationName,
    resolvedLocation.locationId,
    payload.schedulerGroupId,
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
  if (!payload.dataPostagem && !(payload.scheduledDateLocal && payload.scheduledTimeLocal)) {
    response.status(400).json({ error: "Data e horário são obrigatórios para salvar a postagem." });
    return;
  }

  const scheduledAt = resolveScheduledAtFromPayload({
    dataPostagem: payload.dataPostagem,
    scheduledDateLocal: payload.scheduledDateLocal,
    scheduledTimeLocal: payload.scheduledTimeLocal,
    timeZone: payload.timeZone,
    fallbackTimeZone: authRequest.adminUser?.timeZone,
  });
  if (!scheduledAt) {
    response.status(400).json({ error: "Data/hora inválida." });
    return;
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
      hashtags: hashtags.length > 0 ? hashtags : Prisma.JsonNull,
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
        ? `Job ${job.id} salvo como rascunho para ${job.dataPostagem.toISOString()} (execução suspensa até publicação).`
        : `Job ${job.id} agendado para ${job.dataPostagem.toISOString()}.`,
  });
  notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);
  response.status(201).json(job);
});

app.put("/jobs/:id", async (request, response) => {
  const payload = updateJobSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  await ensureMatchingConnection({
    request: authRequest,
    ...payload,
  });
  const existingJob = await findJobWithWorkspaceContext(request.params.id);

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  const workspace = existingJob.company as WorkspacePermissionContext;
  if (!canCurrentUserAccessWorkspace(authRequest, workspace)) {
    response.status(403).json({ error: "Voce nao pode editar esta postagem." });
    return;
  }

  if (workspace.status !== "ACTIVE") {
    response.status(409).json({ error: "Este workspace está inativo e não aceita edições." });
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
  const resolvedLocation = await resolveAutomaticMetaLocation({
    publicationType: payload.publicationType,
    socialConnectionId: payload.socialConnectionId,
    locationName: payload.locationName,
    locationId: payload.locationId,
  });
  const hashtags = normalizeHashtags(payload.publicationType, payload.hashtags);
  const metadata = ensureMetaPublicationMetadata(
    payload.publicationType,
    payload.caption,
    payload.fileCaptions,
    resolvedLocation.locationName,
    resolvedLocation.locationId,
    payload.schedulerGroupId ?? decodeMetaLocationStorage(existingJob.locationName).schedulerGroupId,
  );
  const firstComment = normalizeFirstComment(payload.publicationType, payload.firstComment);
  const normalizedTitle = normalizeJobTitle(payload.title);

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
  const shouldCreateNewJobVersion =
    previousPublicationState === "PUBLISHED" && IMMUTABLE_PUBLICATION_HISTORY_STATUSES.has(existingJob.status);
  const willConsumeMonthlyQuota =
    nextPublicationState === "PUBLISHED" &&
    (shouldCreateNewJobVersion || previousPublicationState !== "PUBLISHED");

  if (!isRootUser(authRequest) && willConsumeMonthlyQuota) {
    const billingAccess = isRootUser(authRequest) ? null : await ensureWorkspaceOwnerBillingWritableAccess(workspace);
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

  if (!payload.dataPostagem && !(payload.scheduledDateLocal && payload.scheduledTimeLocal)) {
    response.status(400).json({ error: "Data e horário são obrigatórios para salvar a postagem." });
    return;
  }

  const scheduledAt = resolveScheduledAtFromPayload({
    dataPostagem: payload.dataPostagem,
    scheduledDateLocal: payload.scheduledDateLocal,
    scheduledTimeLocal: payload.scheduledTimeLocal,
    timeZone: payload.timeZone,
    fallbackTimeZone: authRequest.adminUser?.timeZone,
  });
  if (!scheduledAt) {
    response.status(400).json({ error: "Data/hora inválida." });
    return;
  }

  const nextJobData = {
    companyId: payload.companyId,
    socialConnectionId: payload.socialConnectionId,
    filePath,
    title: normalizedTitle,
    caption: metadata.caption,
    firstComment,
    hashtags: hashtags.length > 0 ? hashtags : Prisma.JsonNull,
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
    status: "PENDING" as const,
    tentativas: 0,
    startedAt: null,
    completedAt: null,
    lastError: null,
  };

  const job = shouldCreateNewJobVersion
    ? await prisma.job.create({
        data: {
          createdByUserId: authRequest.adminUser?.id ?? existingJob.createdByUserId ?? null,
          ...nextJobData,
        },
      })
    : await prisma.job.update({
        where: { id: request.params.id },
        data: nextJobData,
      });

  await appendLog({
    companyId: payload.companyId,
    level: "INFO",
    message:
      nextPublicationState === "DRAFT"
        ? shouldCreateNewJobVersion
          ? `Job ${existingJob.id} foi preservado no histórico e gerou o rascunho ${job.id} para ${job.dataPostagem.toISOString()}.`
          : `Job ${job.id} foi editado e salvo como rascunho para ${job.dataPostagem.toISOString()} (execução suspensa até publicação).`
        : shouldCreateNewJobVersion
          ? `Job ${existingJob.id} foi preservado no histórico e gerou o novo agendamento ${job.id} para ${job.dataPostagem.toISOString()}.`
          : `Job ${job.id} foi editado e reagendado para ${job.dataPostagem.toISOString()}.`,
  });
  notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

  response.json(job);
});

app.post("/jobs/:id/retry", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await findJobWithWorkspaceContext(request.params.id);

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!canCurrentUserAccessWorkspace(authRequest, existingJob.company as WorkspacePermissionContext)) {
    response.status(403).json({ error: "Voce nao pode reenfileirar esta postagem." });
    return;
  }

  if (normalizePublicationState(existingJob.publicationState) === "DRAFT") {
    response.status(409).json({ error: "Rascunhos não podem ser reenfileirados. Use 'Publicar'." });
    return;
  }

  const job = await prisma.job.create({
    data: {
      companyId: existingJob.companyId,
      createdByUserId: authRequest.adminUser?.id ?? existingJob.createdByUserId ?? null,
      socialConnectionId: existingJob.socialConnectionId,
      filePath: existingJob.filePath,
      title: existingJob.title,
      caption: existingJob.caption,
      firstComment: existingJob.firstComment,
      hashtags: existingJob.hashtags ?? Prisma.JsonNull,
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
      dataPostagem: new Date(),
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
    message: `Job ${existingJob.id} foi preservado no histórico e gerou o novo job ${job.id} para tentativa imediata.`,
  });
  notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

  response.json(job);
});

app.post("/jobs/:id/reschedule-failed-media", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await findJobWithWorkspaceContext(request.params.id);

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!canCurrentUserAccessWorkspace(authRequest, existingJob.company as WorkspacePermissionContext)) {
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
      hashtags: existingJob.hashtags ?? Prisma.JsonNull,
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
  notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

  response.json({
    job,
    scheduledAt: retryAt.toISOString(),
    mediaCount: mediaRetryBundle.mediaCount,
    totalCount: mediaRetryBundle.totalCount,
    remainingOnly: mediaRetryBundle.remainingOnly,
  });
});

app.post("/jobs/:id/duplicate-draft", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await findJobWithWorkspaceContext(request.params.id);

  if (!existingJob) {
    response.status(404).json({ error: "Postagem não encontrada." });
    return;
  }

  if (!canCurrentUserAccessWorkspace(authRequest, existingJob.company as WorkspacePermissionContext)) {
    response.status(403).json({ error: "Você não pode duplicar esta postagem." });
    return;
  }

  const nextTitle = await resolveNextDuplicateJobTitle(
    existingJob.title?.trim() || existingJob.caption?.trim() || "Sem título",
    existingJob.companyId,
  );

  const duplicatedJob = await prisma.job.create({
    data: {
      companyId: existingJob.companyId,
      createdByUserId: authRequest.adminUser?.id ?? existingJob.createdByUserId ?? null,
      socialConnectionId: existingJob.socialConnectionId,
      filePath: existingJob.filePath,
      title: nextTitle,
      caption: existingJob.caption,
      firstComment: existingJob.firstComment,
      hashtags: existingJob.hashtags ?? Prisma.JsonNull,
      whatsappBackgroundColor: existingJob.whatsappBackgroundColor,
      whatsappRelinkEnabled: existingJob.whatsappRelinkEnabled,
      whatsappRelinkConnectionIds:
        existingJob.whatsappRelinkEnabled && existingJob.whatsappRelinkConnectionIds
          ? existingJob.whatsappRelinkConnectionIds
          : Prisma.DbNull,
      whatsappRelinkDispatchedAt: null,
      instagramPermalink: null,
      locationName: existingJob.locationName,
      publicationType: existingJob.publicationType,
      publicationState: "DRAFT",
      postStory: existingJob.postStory,
      postReel: existingJob.postReel,
      postWhatsapp: existingJob.postWhatsapp,
      modoWhatsapp: existingJob.modoWhatsapp,
      dataPostagem: existingJob.dataPostagem,
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
    message: `Job ${existingJob.id} duplicado como rascunho (${duplicatedJob.id}).`,
  });
  notifyLiveUpdateForWorkspace(duplicatedJob.companyId, ["jobs", "dashboard"]);

  response.status(201).json(serializeJobForClient(duplicatedJob));
});

app.post("/jobs/:id/cancel", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await findJobWithWorkspaceContext(request.params.id);

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!canCurrentUserAccessWorkspace(authRequest, existingJob.company as WorkspacePermissionContext)) {
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
  notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

  response.json(job);
});

app.post("/jobs/:id/publish", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await findJobWithWorkspaceContext(request.params.id);

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  const workspace = existingJob.company as WorkspacePermissionContext;
  if (!canCurrentUserAccessWorkspace(authRequest, workspace)) {
    response.status(403).json({ error: "Voce nao pode publicar este rascunho." });
    return;
  }

  if (workspace.status !== "ACTIVE") {
    response.status(409).json({ error: "Este workspace está inativo e não aceita publicações." });
    return;
  }

  if (normalizePublicationState(existingJob.publicationState) !== "DRAFT") {
    response.status(409).json({ error: "Apenas rascunhos podem ser publicados por esta ação." });
    return;
  }

  if (!isRootUser(authRequest)) {
    const billingAccess = isRootUser(authRequest) ? null : await ensureWorkspaceOwnerBillingWritableAccess(workspace);
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
  notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

  response.json({
    ...job,
    willRunImmediately,
  });
});

app.post("/jobs/:id/activate", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await findJobWithWorkspaceContext(request.params.id);

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!canCurrentUserAccessWorkspace(authRequest, existingJob.company as WorkspacePermissionContext)) {
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
  const job = await prisma.job.create({
    data: {
      companyId: existingJob.companyId,
      createdByUserId: authRequest.adminUser?.id ?? existingJob.createdByUserId ?? null,
      socialConnectionId: existingJob.socialConnectionId,
      filePath: existingJob.filePath,
      title: existingJob.title,
      caption: existingJob.caption,
      firstComment: existingJob.firstComment,
      hashtags: existingJob.hashtags ?? Prisma.JsonNull,
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
      dataPostagem: existingJob.dataPostagem,
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
    message: willRunImmediately
      ? `Job ${existingJob.id} foi preservado no histórico e gerou o novo job ${job.id}, que será executado imediatamente.`
      : `Job ${existingJob.id} foi preservado no histórico e gerou o novo job ${job.id} para execução em ${job.dataPostagem.toISOString()}.`,
  });
  notifyLiveUpdateForWorkspace(job.companyId, ["jobs", "dashboard"]);

  response.json(job);
});

app.delete("/jobs/:id", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const existingJob = await findJobWithWorkspaceContext(request.params.id);

  if (!existingJob) {
    response.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  if (!canCurrentUserAccessWorkspace(authRequest, existingJob.company as WorkspacePermissionContext)) {
    response.status(403).json({ error: "Voce nao pode excluir esta postagem." });
    return;
  }

  await prisma.job.delete({ where: { id: request.params.id } });
  await appendLog({
    companyId: existingJob.companyId,
    level: "WARN",
    message: `Job ${existingJob.id} foi excluido.`,
  });
  notifyLiveUpdateForWorkspace(existingJob.companyId, ["jobs", "dashboard"]);

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
    const rootUsage = await withPrismaConnectionRetry(
      async () => ({
        profilesUsed: await prisma.company.count(),
        workspaceClientUsed: await prisma.company.count({ where: { kind: "CLIENT" } }),
        workspaceAgencyBonusUsed: await prisma.company.count({ where: { kind: "AGENCY_BONUS" } }),
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
      }),
      {
        maxAttempts: 3,
        retryDelayMs: 350,
      },
    );
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
        workspaceLimit: bestPlan?.workspaceLimit ?? 999999,
        agencyBonusWorkspaceLimit: bestPlan?.agencyBonusWorkspaceLimit ?? 999999,
        maxConnections: bestPlan?.maxConnections ?? 999999,
        maxMonthlyPublications: bestPlan?.maxMonthlyPublications ?? 999999999,
      },
      usage: rootUsage,
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
    where: isRootUser(authRequest) ? undefined : { isActive: true, isPublic: true },
    orderBy: [{ displayOrder: "asc" }, { isTrial: "desc" }, { createdAt: "asc" }],
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
      isPublic: plan.isPublic,
      isTrial: plan.isTrial,
      maxProfiles: plan.maxProfiles,
      workspaceLimit: plan.workspaceLimit,
      agencyBonusWorkspaceLimit: plan.agencyBonusWorkspaceLimit,
      maxConnections: plan.maxConnections,
      maxMonthlyPublications: plan.maxMonthlyPublications,
      displayOrder: plan.displayOrder,
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
      isPublic: payload.isPublic,
      isTrial: payload.isTrial,
      maxProfiles: payload.maxProfiles,
      workspaceLimit: payload.workspaceLimit,
      agencyBonusWorkspaceLimit: payload.agencyBonusWorkspaceLimit,
      maxConnections: payload.maxConnections,
      maxMonthlyPublications: payload.maxMonthlyPublications,
      displayOrder: payload.displayOrder,
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
      isPublic: payload.isPublic,
      isTrial: payload.isTrial,
      maxProfiles: payload.maxProfiles,
      workspaceLimit: payload.workspaceLimit,
      agencyBonusWorkspaceLimit: payload.agencyBonusWorkspaceLimit,
      maxConnections: payload.maxConnections,
      maxMonthlyPublications: payload.maxMonthlyPublications,
      displayOrder: payload.displayOrder,
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

app.get("/billing/post-for-me-webhook", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode visualizar a configuração do webhook da Post for Me." });
    return;
  }

  const settings = await getPostForMeWebhookSettingsSnapshot(request);
  response.json(settings);
});

app.post("/billing/post-for-me-webhook/register", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode configurar o webhook da Post for Me." });
    return;
  }

  const payload = registerPostForMeWebhookSchema.parse(request.body ?? {});
  const currentSettings = await getPostForMeWebhookSettingsSnapshot(request);

  if (currentSettings.configured && !payload.force) {
    response.json({
      ...currentSettings,
      reused: true,
    });
    return;
  }

  const publicEndpointUrl = currentSettings.publicEndpointUrl;
  if (!publicEndpointUrl) {
    response.status(400).json({
      error: "Não foi possível resolver a URL pública do backend para registrar o webhook da Post for Me.",
    });
    return;
  }

  try {
    const webhook = await createPostForMeWebhook({
      url: publicEndpointUrl,
      eventTypes: [...POST_FOR_ME_ACCOUNT_WEBHOOK_EVENT_TYPES],
    });

    if (!webhook.secret) {
      response.status(502).json({
        error: "A Post for Me não devolveu o secret do webhook. Não foi possível concluir o cadastro automático.",
      });
      return;
    }

    await Promise.all([
      upsertBillingSetting(BILLING_SETTING_POST_FOR_ME_WEBHOOK_ID, webhook.id ?? ""),
      upsertBillingSetting(BILLING_SETTING_POST_FOR_ME_WEBHOOK_URL, webhook.url ?? publicEndpointUrl),
      upsertBillingSetting(BILLING_SETTING_POST_FOR_ME_WEBHOOK_SECRET, webhook.secret),
    ]);

    const nextSettings = await getPostForMeWebhookSettingsSnapshot(request);
    response.status(201).json({
      ...nextSettings,
      reused: false,
    });
  } catch (error) {
    response.status(502).json({
      error:
        error instanceof Error && error.message
          ? `Falha ao registrar webhook na Post for Me: ${error.message}`
          : "Falha ao registrar webhook na Post for Me.",
    });
  }
});

app.post("/billing/post-for-me-webhook/backfill-renewal-avisos", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  if (!isRootUser(authRequest)) {
    response.status(403).json({ error: "Apenas root pode executar o backfill de avisos da Post for Me." });
    return;
  }

  const result = await backfillPostForMeRenewalAvisos();
  response.json(result);
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

app.post("/avisos/:id/mark-read", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const aviso = await prisma.aviso.findFirst({
    where: {
      id: request.params.id,
      userId: authRequest.adminUser!.id,
    },
    select: {
      id: true,
      userId: true,
      readAt: true,
    },
  });

  if (!aviso) {
    response.status(404).json({ error: "Aviso não encontrado." });
    return;
  }

  if (!aviso.readAt) {
    await prisma.aviso.update({
      where: {
        id: aviso.id,
      },
      data: {
        readAt: new Date(),
      },
    });
    notifyLiveUpdateForUser(aviso.userId, ["avisos"]);
  }

  response.json({ updated: 1 });
});

app.delete("/avisos/:id", async (request, response) => {
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  const aviso = await prisma.aviso.findFirst({
    where: {
      id: request.params.id,
      userId: authRequest.adminUser!.id,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!aviso) {
    response.status(404).json({ error: "Aviso não encontrado." });
    return;
  }

  await prisma.aviso.delete({
    where: {
      id: aviso.id,
    },
  });

  notifyLiveUpdateForUser(aviso.userId, ["avisos"]);
  response.status(204).send();
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
  notifyLiveUpdateForUsers(
    recipients.map((recipient) => recipient.id),
    ["avisos"],
  );

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
  startPostForMeMetaPostSyncWorker();
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
