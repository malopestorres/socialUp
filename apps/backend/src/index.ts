import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PublicationType, WhatsappMode } from "@socialup/shared";
import { z } from "zod";
import { adminAuthMiddleware, type AdminUserAuth } from "./admin-auth.js";
import {
  consumeInstagramOAuthState,
  createInstagramOAuthLaunchUrl,
  exchangeInstagramOAuthCodeForConnection,
  executeInstagramCarouselJobWithGraphApi,
  executeInstagramJobWithGraphApi,
  isInstagramLoginRequiredErrorMessage,
  listInstagramLocationCandidatesForConnection,
  refreshInstagramAccessTokenForConnection,
  type InstagramLocationSuggestion,
  searchInstagramLocationsForConnection,
} from "./instagram-graph-api.js";
import { prisma } from "./prisma.js";
import { createRandomToken, verifyPassword, hashPassword } from "./security.js";
import {
  dismissWhatsappQr,
  disconnectWhatsappConnection as disconnectWhatsappConnectionSession,
  executeWhatsappJobWithEvolutionApi,
  getWhatsappConnectionOverlay,
  isWhatsappEvolutionHardcodedEnabled,
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
const INSTAGRAM_PROACTIVE_TOKEN_REFRESH_COOLDOWN_MS = parseEnvPositiveInt(
  process.env.INSTAGRAM_PROACTIVE_TOKEN_REFRESH_COOLDOWN_MS,
  30 * 60 * 1000,
);
const INSTAGRAM_TOKEN_KEEPALIVE_INTERVAL_MS = parseEnvPositiveInt(
  process.env.INSTAGRAM_TOKEN_KEEPALIVE_INTERVAL_MS,
  5 * 60 * 1000,
);
const INSTAGRAM_TOKEN_KEEPALIVE_BATCH_SIZE = parseEnvPositiveInt(
  process.env.INSTAGRAM_TOKEN_KEEPALIVE_BATCH_SIZE,
  25,
);

function parseEnvPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    };
  }

  if (!raw.startsWith(JOB_MEDIA_BUNDLE_STORAGE_PREFIX)) {
    return {
      files: [raw],
      sequential: false,
    };
  }

  const encodedPayload = raw.slice(JOB_MEDIA_BUNDLE_STORAGE_PREFIX.length).trim();
  if (!encodedPayload) {
    return {
      files: [],
      sequential: false,
    };
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64").toString("utf8")) as {
      files?: unknown;
      sequential?: unknown;
    };

    const files = Array.isArray(parsed.files)
      ? parsed.files
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0)
      : [];

    return {
      files,
      sequential: parsed.sequential === true,
    };
  } catch {
    return {
      files: [raw],
      sequential: false,
    };
  }
}

function encodeJobMediaBundleStorage(input: JobMediaBundle): string {
  const files = input.files.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const sequential = input.sequential === true;

  if (files.length === 0) {
    return "";
  }

  if (files.length === 1 && !sequential) {
    return files[0]!;
  }

  const payload = Buffer.from(
    JSON.stringify({
      files,
      sequential,
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
app.use(express.json());
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

const createOrganizationSchema = z.object({
  name: z.string().min(2),
});

const createCompanySchema = z.object({
  name: z.string().min(2),
  organizationId: z.string().min(1),
});

const socialPlatformSchema = z.enum(["instagram", "whatsapp"]);

const createConnectionSchema = z.object({
  companyId: z.string().min(1),
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
  socialConnectionId: z.string().min(1),
  filePath: z.string().optional().nullable(),
  filePaths: z.array(z.string()).optional().nullable(),
  sequential: z.boolean().optional(),
  title: z.string().trim().max(120).optional().nullable(),
  caption: z.string().optional().nullable(),
  locationName: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
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
  socialConnectionId: z.string().min(1),
  filePath: z.string().optional().nullable(),
  filePaths: z.array(z.string()).optional().nullable(),
  sequential: z.boolean().optional(),
  title: z.string().trim().max(120).optional().nullable(),
  caption: z.string().optional().nullable(),
  locationName: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  publicationType: z.enum([
    "instagram_story",
    "instagram_reel",
    "instagram_post",
    "whatsapp_status_midia",
    "whatsapp_status_texto",
  ]),
  dataPostagem: z.string().datetime(),
});

const deleteUploadQuerySchema = z.object({
  filePath: z.string().trim().min(1),
});

const avisoPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

const avisoRecentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

const createBroadcastAvisoSchema = z.object({
  title: z.string().trim().min(2).max(120),
  message: z.string().trim().min(2).max(2000),
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
  sequential?: boolean,
): string {
  if (publicationType === "whatsapp_status_texto") {
    return filePath ?? "";
  }

  const mergedFiles = [
    ...(Array.isArray(filePaths) ? filePaths : []),
    filePath ?? "",
  ]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const uniqueFiles = Array.from(new Set(mergedFiles));

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

  return encodeJobMediaBundleStorage({
    files: validatedFiles,
    sequential: normalizedSequential && validatedFiles.length > 1,
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

function ensureInstagramMetadata(
  publicationType: PublicationType,
  caption?: string | null,
  locationName?: string | null,
  locationId?: string | null,
): { caption: string | null; locationName: string | null } {
  const normalizedCaption = caption?.trim() || null;
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
    if (publicationType !== "instagram_story" && !normalizedCaption) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["caption"],
          message: "Legenda obrigatoria para publicacoes do Instagram.",
        },
      ]);
    }

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
    caption: publicationType === "instagram_story" ? null : normalizedCaption,
    locationName: encodeInstagramLocationStorage(effectiveLocationName, effectiveLocationId),
  };
}

async function ensureMatchingConnection(input: {
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
        message: "A conta social precisa pertencer a mesma unidade da postagem.",
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

function jobVisibilityWhere(
  request: Request & { adminUser?: AdminUserAuth },
  companyId?: string,
  status?: string,
) {
  return {
    companyId: companyId ?? undefined,
    status: status ?? undefined,
    createdByUserId: isRootUser(request) ? undefined : request.adminUser?.id,
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

function renderInstagramOAuthCallbackHtml(input: {
  success: boolean;
  message: string;
  connectionId?: string | null;
}): string {
  const title = input.success ? "Instagram conectado" : "Falha na autorizacao do Instagram";
  const payload = JSON.stringify({
    type: "socialup-instagram-oauth",
    success: input.success,
    message: input.message,
    connectionId: input.connectionId ?? null,
  });
  const toneColor = input.success ? "#0f5132" : "#842029";
  const toneBackground = input.success ? "#d1e7dd" : "#f8d7da";
  const actionButtonBackground = input.success ? "#198754" : "#6b7280";
  const actionButtonHover = input.success ? "#157347" : "#4b5563";

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f8f9fc; color: #1f2937; }
      .card { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; box-shadow: 0 6px 24px rgba(15, 23, 42, 0.08); }
      .status { margin-top: 12px; border-radius: 10px; padding: 12px; font-weight: 600; color: ${toneColor}; background: ${toneBackground}; }
      p { line-height: 1.45; margin: 0; }
      .hint { margin-top: 12px; color: #6b7280; font-size: 0.92rem; }
      .action-row { margin-top: 16px; display: flex; justify-content: flex-end; }
      .close-btn {
        border: 0;
        border-radius: 10px;
        padding: 10px 16px;
        background: ${actionButtonBackground};
        color: #fff;
        font-weight: 700;
        cursor: pointer;
        transition: background 120ms ease;
      }
      .close-btn:hover { background: ${actionButtonHover}; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${escapeHtml(title)}</h1>
      <div class="status">${escapeHtml(input.message)}</div>
      <p class="hint">Esta janela pode ser fechada agora.</p>
      <div class="action-row">
        <button type="button" class="close-btn" id="oauth-close-btn">Fechar janela</button>
      </div>
    </main>
    <script>
      (function () {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(${payload}, "*");
          }
        } catch (_) {}
        var closeButton = document.getElementById("oauth-close-btn");
        if (closeButton) {
          closeButton.addEventListener("click", function () {
            window.close();
          });
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

const runningServerJobs = new Set<string>();
const busyConnections = new Set<string>();
const instagramLastProactiveTokenRefreshByConnection = new Map<string, number>();

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
          title: "Aguardando autenticacao",
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

function appendStorySequenceCacheBuster(mediaUrl: string, jobId: string, index: number, fileName: string): string {
  const targetUrl = new URL(mediaUrl);
  targetUrl.searchParams.set("_su_story_job", jobId);
  targetUrl.searchParams.set("_su_story_idx", String(index + 1));
  targetUrl.searchParams.set("_su_story_file", fileName);
  targetUrl.searchParams.set("_su_story_ts", String(Date.now()));
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
    locationName: string | null;
    publicationType?: string | null;
    postStory?: boolean;
    postReel?: boolean;
    postWhatsapp?: boolean;
  },
): Promise<void> {
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

    const mediaUrls = mediaFiles.map((filePath) => resolvePublicUploadUrl(filePath));
    await executeInstagramCarouselJobWithGraphApi(
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
      },
      mediaUrls,
    );
    return;
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
      let published: {
        creationId: string;
        publishedMediaId: string;
      };
      try {
        published = await executeInstagramJobWithGraphApi(
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
          },
          mediaUrl,
        );
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

      if (index < mediaFiles.length - 1 && INSTAGRAM_STORY_SEQUENCE_STEP_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, INSTAGRAM_STORY_SEQUENCE_STEP_DELAY_MS));
      }
    }
    return;
  }

  const mediaUrl = resolvePublicUploadUrl(mediaFiles[0]!);
  await executeInstagramJobWithGraphApi(
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
    },
    mediaUrl,
  );
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

function startServerInstagramJobWorker(): void {
  const tick = async () => {
    try {
      const candidateJobs = await prisma.job.findMany({
        where: {
          publicationType: {
            in: ["instagram_post", "instagram_reel", "instagram_story"],
          },
          status: {
            in: ["PENDING", "WAITING_LOGIN"],
          },
          dataPostagem: {
            lte: new Date(),
          },
        },
        orderBy: [{ dataPostagem: "asc" }, { criadoEm: "asc" }],
        take: 10,
      });

      for (const job of candidateJobs) {
        if (runningServerJobs.has(job.id)) {
          continue;
        }

        if (!job.socialConnectionId) {
          continue;
        }

        const connection = await prisma.socialConnection.findFirst({
          where: {
            id: job.socialConnectionId,
            companyId: job.companyId,
            platform: platformForPublication(normalizePublicationType(job)),
            authStatus: "CONNECTED",
          },
        });

        if (!connection || busyConnections.has(connection.id)) {
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

        runningServerJobs.add(job.id);
        busyConnections.add(connection.id);

        void (async () => {
          const effectiveConnection = {
            id: connection.id,
            loginIdentifier: connection.loginIdentifier,
            secretCipher: connection.secretCipher,
          };

          try {
            await appendLog({
              companyId: job.companyId,
              level: "INFO",
              message: `Job ${job.id} iniciado pelo worker interno da unidade.`,
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
                      lastError: "Aguardando autenticacao do Instagram.",
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
                    message:
                      `Job ${job.id} aguardando novo login antes da execução: ${proactiveRefreshMessage}`,
                  });

                  await appendJobAvisoSafely(job, {
                    title: "Aguardando autenticacao",
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

            await executeInstagramJobWithResolvedMediaBundle(effectiveConnection, job);

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
              message: `Job ${job.id} concluido pelo worker interno.`,
            });

            await appendJobAvisoSafely(job, {
              title: "Postagem enviada",
              kind: "JOB_SENT",
              message: "Publicacao concluida com sucesso.",
            });
          } catch (error) {
            let message = error instanceof Error ? error.message : "Erro desconhecido no worker interno.";
            let waitingLogin = isInstagramLoginRequiredErrorMessage(message);
            const sequentialStoryJob = isSequentialStoryJob(job);
            const publishedCountBeforeFailure = sequentialStoryJob
              ? parseSequentialStoryPublishedCountFromError(message)
              : null;
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

                await executeInstagramJobWithResolvedMediaBundle(effectiveConnection, job);

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

                  await executeInstagramJobWithResolvedMediaBundle(effectiveConnection, job);

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
            const attemptNumber = job.tentativas + 1;
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
              return;
            }

            await prisma.job.update({
              where: { id: job.id },
              data: {
                status: waitingLogin ? "WAITING_LOGIN" : "FAILED",
                lastError: waitingLogin
                  ? "Aguardando autenticacao do Instagram."
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
              message: `Job ${job.id} falhou no worker interno: ${message}`,
            });

            await appendJobAvisoSafely(job, waitingLogin
              ? {
                  title: "Aguardando autenticacao",
                  kind: "JOB_WAITING_LOGIN",
                  message: "A conta do Instagram precisa ser autenticada para continuar.",
                }
              : {
                  title: "Falha no agendamento",
                  kind: "JOB_FAILED",
                  message: summarizeFailureMessageForAviso(normalizePublicationType(job), message),
                });
          } finally {
            runningServerJobs.delete(job.id);
            busyConnections.delete(connection.id);
          }
        })();
      }
    } catch (error) {
      console.error("Server Instagram job worker error", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, 10_000);
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
        if (busyConnections.has(connection.id) || !shouldAttemptProactiveInstagramTokenRefresh(connection.id, nowMs)) {
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

function startServerWhatsappJobWorker(): void {
  const tick = async () => {
    try {
      const candidateJobs = await prisma.job.findMany({
        where: {
          publicationType: {
            in: ["whatsapp_status_midia", "whatsapp_status_texto"],
          },
          status: {
            in: ["PENDING", "WAITING_LOGIN"],
          },
          dataPostagem: {
            lte: new Date(),
          },
        },
        orderBy: [{ dataPostagem: "asc" }, { criadoEm: "asc" }],
        take: 10,
      });

      for (const job of candidateJobs) {
        if (runningServerJobs.has(job.id) || !job.socialConnectionId) {
          continue;
        }

        const connection = await prisma.socialConnection.findFirst({
          where: {
            id: job.socialConnectionId,
            companyId: job.companyId,
            platform: "whatsapp",
            authStatus: "CONNECTED",
          },
        });

        if (!connection || busyConnections.has(connection.id)) {
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

        runningServerJobs.add(job.id);
        busyConnections.add(connection.id);

        void (async () => {
          try {
            await appendLog({
              companyId: job.companyId,
              level: "INFO",
              message: `Job ${job.id} iniciado pelo worker interno do WhatsApp.`,
            });

            const delivery = await executeWhatsappJobWithEvolutionApi(connection, job, uploadsDir);

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
              message: `Job ${job.id} enviado pelo worker interno do WhatsApp sem confirmacao de publicacao. remoteJid=${delivery.remoteJid ?? "status@broadcast"} messageId=${delivery.messageId ?? "indisponivel"}`,
            });

            await appendJobAvisoSafely(job, {
              title: "Postagem enviada sem confirmacao",
              kind: "JOB_SENT_UNCONFIRMED",
              message: "A API aceitou o envio, mas ainda sem confirmacao final do WhatsApp.",
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Erro desconhecido no worker interno do WhatsApp.";
            const waitingLogin = message === "LOGIN_REQUIRED_WHATSAPP";
            const errorCode = normalizeAutomationErrorCode(message);

            await prisma.job.update({
              where: { id: job.id },
              data: {
                status: waitingLogin ? "WAITING_LOGIN" : "FAILED",
                lastError: waitingLogin
                  ? "Aguardando autenticacao do WhatsApp."
                  : message,
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
              message: `Job ${job.id} falhou no worker interno do WhatsApp: ${message}`,
            });

            await appendJobAvisoSafely(job, waitingLogin
              ? {
                  title: "Aguardando autenticacao",
                  kind: "JOB_WAITING_LOGIN",
                  message: "A conta do WhatsApp precisa ser autenticada para continuar.",
                }
              : {
                  title: "Falha no agendamento",
                  kind: "JOB_FAILED",
                  message: summarizeFailureMessageForAviso(normalizePublicationType(job), message),
                });
          } finally {
            runningServerJobs.delete(job.id);
            busyConnections.delete(connection.id);
          }
        })();
      }
    } catch (error) {
      console.error("Server WhatsApp job worker error", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, 10_000);
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

app.get("/oauth/instagram/callback", async (request, response) => {
  const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
  const code = typeof request.query.code === "string" ? request.query.code.trim() : "";
  const oauthError = typeof request.query.error === "string" ? request.query.error.trim() : "";
  const oauthErrorDescription =
    typeof request.query.error_description === "string" ? request.query.error_description.trim() : "";
  const consumedState = consumeInstagramOAuthState(state);

  if (!state || !consumedState) {
    response
      .status(400)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send(
        renderInstagramOAuthCallbackHtml({
          success: false,
          message: "A autorização expirou ou não é válida. Gere um novo login no painel.",
        }),
      );
    return;
  }

  const connection = await prisma.socialConnection.findUnique({
    where: { id: consumedState.connectionId },
  });

  if (!connection || connection.platform !== "instagram") {
    response
      .status(404)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send(
        renderInstagramOAuthCallbackHtml({
          success: false,
          connectionId: consumedState.connectionId,
          message: "Conta de Instagram não encontrada para concluir a autorização.",
        }),
      );
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

    response
      .status(400)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send(
        renderInstagramOAuthCallbackHtml({
          success: false,
          connectionId: connection.id,
          message: `Autorização cancelada: ${errorMessage}`,
        }),
      );
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

    response
      .status(400)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send(
        renderInstagramOAuthCallbackHtml({
          success: false,
          connectionId: connection.id,
          message: "Não foi possível concluir a autorização: código OAuth ausente.",
        }),
      );
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

    response
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send(
        renderInstagramOAuthCallbackHtml({
          success: true,
          connectionId: connection.id,
          message: `Conta conectada com sucesso${oauthResult.instagramUsername ? ` (@${oauthResult.instagramUsername})` : ""}.`,
        }),
      );
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

    response
      .status(400)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send(
        renderInstagramOAuthCallbackHtml({
          success: false,
          connectionId: connection.id,
          message: `Falha ao concluir autorização: ${message}`,
        }),
      );
  }
});

app.use(
  ["/organizations", "/companies", "/connections", "/upload", "/jobs", "/dashboard", "/logs", "/avisos"],
  adminAuthMiddleware,
);

app.get("/connections", async (request, response) => {
  const companyId = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
  const connections = await prisma.socialConnection.findMany({
    where: companyId ? { companyId } : undefined,
    orderBy: [{ companyId: "asc" }, { createdAt: "desc" }],
  });

  response.json(connections.map((connection) => mapConnection(connection)));
});

app.get("/connections/:id/instagram-location-candidates", async (request, response) => {
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
    select: {
      id: true,
      platform: true,
      secretCipher: true,
    },
  });

  if (!connection || connection.platform !== "instagram") {
    response.status(404).json({ error: "Conta do Instagram não encontrada." });
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
  const loginIdentifier = payload.loginIdentifier?.trim() || null;
  const secretCipher = encodeSecret(payload.secret);

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
    message: `Conta ${payload.displayName} (${payload.platform}) criada e pronta para autenticacao.`,
  });

  response.status(201).json(mapConnection(connection));
});

app.put("/connections/:id", async (request, response) => {
  const payload = updateConnectionSchema.parse(request.body);
  const existingConnection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!existingConnection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
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
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
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
    launchUrl = createInstagramOAuthLaunchUrl(connection.id);
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
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
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
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
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
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
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
  const connection = await prisma.socialConnection.findUnique({
    where: { id: request.params.id },
  });

  if (!connection) {
    response.status(404).json({ error: "Conexao nao encontrada." });
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
      const nextFilePath = nextFiles.length > 0
        ? encodeJobMediaBundleStorage({
            files: nextFiles,
            sequential: mediaBundle.sequential && nextFiles.length > 1,
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
      platform: true,
      authStatus: true,
      secretCipher: true,
    },
  });

  if (!connection || connection.platform !== "instagram") {
    response.status(404).json({ error: "Conta do Instagram não encontrada." });
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

app.get("/jobs", async (request, response) => {
  const companyId = typeof request.query.companyId === "string" ? request.query.companyId : undefined;
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  const authRequest = request as Request & { adminUser?: AdminUserAuth };

  const jobs = await prisma.job.findMany({
    where: jobVisibilityWhere(authRequest, companyId, status),
    orderBy: { criadoEm: "desc" },
  });

  response.json(
    jobs.map((job) => {
      const locationMetadata = decodeInstagramLocationStorage(job.locationName);
      const mediaBundle = decodeJobMediaBundleStorage(job.filePath);
      return {
        id: job.id,
        companyId: job.companyId,
        socialConnectionId: job.socialConnectionId,
        filePath: mediaBundle.files[0] ?? job.filePath,
        filePaths: mediaBundle.files,
        sequential: mediaBundle.sequential,
        title: job.title,
        caption: job.caption,
        locationName: locationMetadata.locationName,
        locationId: locationMetadata.locationId,
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
      };
    }),
  );
});

app.post("/jobs", async (request, response) => {
  const payload = createJobSchema.parse(request.body);
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  await ensureMatchingConnection(payload);
  const legacyFields = deriveLegacyJobFields(payload.publicationType);
  const filePath = ensureFilePathForPublication(
    payload.publicationType,
    payload.filePath,
    payload.filePaths,
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
    resolvedLocation.locationName,
    resolvedLocation.locationId,
  );
  const normalizedTitle = normalizeJobTitle(payload.title);
  const job = await prisma.job.create({
    data: {
      companyId: payload.companyId,
      createdByUserId: authRequest.adminUser!.id,
      socialConnectionId: payload.socialConnectionId,
      filePath,
      title: normalizedTitle,
      caption: metadata.caption,
      locationName: metadata.locationName,
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
  const authRequest = request as Request & { adminUser?: AdminUserAuth };
  await ensureMatchingConnection(payload);
  const legacyFields = deriveLegacyJobFields(payload.publicationType);
  const filePath = ensureFilePathForPublication(
    payload.publicationType,
    payload.filePath,
    payload.filePaths,
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
    resolvedLocation.locationName,
    resolvedLocation.locationId,
  );
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

  const job = await prisma.job.update({
    where: { id: request.params.id },
    data: {
      companyId: payload.companyId,
      socialConnectionId: payload.socialConnectionId,
      filePath,
      title: normalizedTitle,
      caption: metadata.caption,
      locationName: metadata.locationName,
      publicationType: payload.publicationType,
      postStory: legacyFields.postStory,
      postReel: legacyFields.postReel,
      postWhatsapp: legacyFields.postWhatsapp,
      modoWhatsapp: legacyFields.modoWhatsapp,
      dataPostagem: new Date(payload.dataPostagem),
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
    message: `Job ${job.id} foi editado e reagendado para ${job.dataPostagem.toISOString()}.`,
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
    prisma.job.findMany({ where, select: { status: true } }),
    prisma.socialConnection.count({
      where: {
        companyId: companyId ?? undefined,
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

startServerInstagramJobWorker();
startInstagramTokenKeepAliveWorker();
startServerWhatsappJobWorker();

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
