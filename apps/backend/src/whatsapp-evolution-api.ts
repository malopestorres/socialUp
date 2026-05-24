import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { prisma } from "./prisma.js";

export type WhatsappQrStatus =
  | "IDLE"
  | "PREPARING"
  | "WAITING_QR_SCAN"
  | "QR_EXPIRED"
  | "CONNECTED"
  | "ERROR";

type ConnectionIdentity = {
  id: string;
  companyId: string;
  displayName: string;
  platform?: string;
  loginIdentifier: string | null;
  secretCipher: string | null;
};

type JobIdentity = {
  id: string;
  publicationType: string;
  caption?: string | null;
  filePath?: string | null;
  whatsappBackgroundColor?: string | null;
};

type JobMediaBundle = {
  files: string[];
  captions: Array<string | null>;
};

type EvolutionCredentials = {
  instanceName: string;
  apiKey: string;
  baseUrl: string;
};

type QrOverlayState = {
  qrStatus: WhatsappQrStatus;
  qrImageDataUrl: string | null;
  qrGeneratedAt: Date | null;
  workerLastSeenAt: Date | null;
  qrMessage: string | null;
  whatsappOwnerJid: string | null;
  whatsappProfileName: string | null;
};

type EvolutionConnectionStateResponse = {
  instance?: {
    state?: string | null;
    status?: string | null;
  } | null;
  state?: string | null;
  status?: string | null;
};

type EvolutionFetchInstanceRecord = {
  id?: string | null;
  name?: string | null;
  instanceName?: string | null;
  connectionStatus?: string | null;
  ownerJid?: string | null;
  number?: string | null;
  profileName?: string | null;
  profileNameNotify?: string | null;
  instance?: {
    ownerJid?: string | null;
    number?: string | null;
    profileName?: string | null;
    profileNameNotify?: string | null;
    instanceName?: string | null;
    name?: string | null;
  } | null;
  integration?: string | null;
};

type EvolutionConnectResponse = {
  code?: string | null;
  base64?: string | null;
  pairingCode?: string | null;
  message?: string | null;
};

type EvolutionSendStatusResponse = {
  key?: {
    id?: string | null;
    remoteJid?: string | null;
  } | null;
  id?: string | null;
  messageId?: string | null;
};

type EvolutionFindMessagesResponse = {
  messages?: {
    total?: number;
    records?: unknown[];
  } | null;
};

type EvolutionContactRecord = {
  remoteJid?: string | null;
  id?: string | null;
  ownerJid?: string | null;
  number?: string | null;
  pushName?: string | null;
  name?: string | null;
  verifiedName?: string | null;
  isGroup?: boolean | null;
  type?: string | null;
};

type StatusRecipientsResolution = {
  recipients: string[];
  ownerJid: string | null;
  ownerIncluded: boolean;
  contactsTotal: number;
  contactsRejectedGroups: number;
  contactsRejectedInvalid: number;
  contactsRejectedLid: number;
};

type EvolutionRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  jsonBody?: unknown;
};

const EVOLUTION_API_BASE_URL = normalizeBaseUrl(process.env.EVOLUTION_API_BASE_URL || "http://localhost:8080");
const EVOLUTION_API_KEY = (process.env.EVOLUTION_API_KEY || "").trim();
const EVOLUTION_API_TIMEOUT_MS = parsePositiveInt(process.env.EVOLUTION_API_TIMEOUT_MS, 45_000);
const EVOLUTION_QR_POLL_INTERVAL_MS = parsePositiveInt(process.env.EVOLUTION_QR_POLL_INTERVAL_MS, 800);
const EVOLUTION_QR_REUSE_WINDOW_MS = parsePositiveInt(process.env.EVOLUTION_QR_REUSE_WINDOW_MS, 45_000);
const EVOLUTION_INSTANCE_INTEGRATION = (process.env.EVOLUTION_INSTANCE_INTEGRATION || "WHATSAPP-BAILEYS").trim();
const EVOLUTION_STATUS_TEXT_BACKGROUND = process.env.EVOLUTION_STATUS_TEXT_BACKGROUND?.trim() || "#202C33";
const EVOLUTION_STATUS_TEXT_FONT = parseStatusTextFont(process.env.EVOLUTION_STATUS_TEXT_FONT, 1);
const EVOLUTION_STATUS_CONFIRMATION_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.EVOLUTION_STATUS_CONFIRMATION_MAX_ATTEMPTS || "6", 10) || 6,
);
const EVOLUTION_STATUS_CONFIRMATION_DELAY_MS = Math.max(
  500,
  Number.parseInt(process.env.EVOLUTION_STATUS_CONFIRMATION_DELAY_MS || "2000", 10) || 2_000,
);

const HARD_CODED_INSTANCE_NAME = (process.env.EVOLUTION_HARD_CODED_INSTANCE_NAME || "").trim();
const HARD_CODED_INSTANCE_API_KEY = (process.env.EVOLUTION_HARD_CODED_INSTANCE_API_KEY || "").trim();
const JOB_MEDIA_BUNDLE_STORAGE_PREFIX = "__JOB_MEDIA_BUNDLE__";

const qrOverlayByConnectionId = new Map<string, QrOverlayState>();
const qrPollersByConnectionId = new Map<string, NodeJS.Timeout>();

function preserveQrGeneratedAtForSameCode(connectionId: string, nextImageDataUrl: string | null): Date {
  const previous = qrOverlayByConnectionId.get(connectionId);
  if (
    previous?.qrImageDataUrl &&
    nextImageDataUrl &&
    previous.qrImageDataUrl === nextImageDataUrl &&
    previous.qrGeneratedAt instanceof Date
  ) {
    return previous.qrGeneratedAt;
  }

  return new Date();
}

function isSameQrCodeExpired(connectionId: string, nextImageDataUrl: string | null, nowMs = Date.now()): boolean {
  const previous = qrOverlayByConnectionId.get(connectionId);
  if (!previous?.qrImageDataUrl || !nextImageDataUrl || previous.qrImageDataUrl !== nextImageDataUrl) {
    return false;
  }

  const generatedAtMs = previous.qrGeneratedAt instanceof Date ? previous.qrGeneratedAt.getTime() : 0;
  return generatedAtMs > 0 && nowMs - generatedAtMs > EVOLUTION_QR_REUSE_WINDOW_MS;
}

function isReusableQrOverlay(state: QrOverlayState | null | undefined, nowMs = Date.now()): boolean {
  if (!state) {
    return false;
  }

  if (state.qrStatus !== "WAITING_QR_SCAN" && state.qrStatus !== "PREPARING") {
    return false;
  }

  const generatedAtMs = state.qrGeneratedAt instanceof Date ? state.qrGeneratedAt.getTime() : Number.NaN;
  if (!Number.isFinite(generatedAtMs)) {
    // PREPARING pode não ter data ainda, mas só consideramos reutilizável se viu atividade recente.
    const lastSeenMs = state.workerLastSeenAt instanceof Date ? state.workerLastSeenAt.getTime() : 0;
    return lastSeenMs > 0 && nowMs - lastSeenMs <= EVOLUTION_QR_REUSE_WINDOW_MS;
  }

  return nowMs - generatedAtMs <= EVOLUTION_QR_REUSE_WINDOW_MS;
}

function buildAutoWhatsappInstanceName(connectionId: string): string {
  const normalized = connectionId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const suffix = normalized.slice(0, 20) || "default";
  return `socialup_wa_${suffix}`;
}

export function buildFreshWhatsappInstanceName(seed: string): string {
  const normalized = seed.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const prefix = normalized.slice(0, 12) || "default";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  return `socialup_wa_${prefix}_${suffix}`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStatusTextFont(value: string | undefined, fallback: number): number {
  const parsed = parsePositiveInt(value, fallback);
  if (parsed < 1) {
    return 1;
  }
  if (parsed > 5) {
    return 5;
  }
  return parsed;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function decodeJobMediaBundleStorage(filePath: string | null | undefined): JobMediaBundle {
  const raw = filePath?.trim() || "";
  if (!raw) {
    return {
      files: [],
      captions: [],
    };
  }

  if (!raw.startsWith(JOB_MEDIA_BUNDLE_STORAGE_PREFIX)) {
    return {
      files: [raw],
      captions: [],
    };
  }

  const encodedPayload = raw.slice(JOB_MEDIA_BUNDLE_STORAGE_PREFIX.length).trim();
  if (!encodedPayload) {
    return {
      files: [],
      captions: [],
    };
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64").toString("utf8")) as {
      files?: unknown;
      captions?: unknown;
    };

    const files = Array.isArray(parsed.files)
      ? parsed.files
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0)
      : [];
    const rawCaptions = Array.isArray(parsed.captions) ? parsed.captions : [];
    const captions = files.map((_, index) => {
      const rawCaption = rawCaptions[index];
      if (typeof rawCaption !== "string") {
        return null;
      }
      const normalizedCaption = rawCaption.trim();
      return normalizedCaption.length > 0 ? normalizedCaption : null;
    });

    return {
      files,
      captions,
    };
  } catch {
    return {
      files: [raw],
      captions: [],
    };
  }
}

function decodeSecret(secretCipher?: string | null): string | null {
  if (!secretCipher) {
    return null;
  }

  try {
    const decoded = Buffer.from(secretCipher, "base64").toString("utf8").trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function isWhatsappEvolutionHardcodedEnabled(): boolean {
  return Boolean(HARD_CODED_INSTANCE_NAME);
}

function getOrCreateQrOverlay(connectionId: string): QrOverlayState {
  const existing = qrOverlayByConnectionId.get(connectionId);
  if (existing) {
    return existing;
  }

  const created: QrOverlayState = {
    qrStatus: "IDLE",
    qrImageDataUrl: null,
    qrGeneratedAt: null,
    workerLastSeenAt: null,
    qrMessage: null,
    whatsappOwnerJid: null,
    whatsappProfileName: null,
  };
  qrOverlayByConnectionId.set(connectionId, created);
  return created;
}

function setQrOverlay(connectionId: string, patch: Partial<QrOverlayState>): void {
  const current = getOrCreateQrOverlay(connectionId);
  qrOverlayByConnectionId.set(connectionId, {
    ...current,
    ...patch,
    workerLastSeenAt: new Date(),
  });
}

function clearQrPoller(connectionId: string): void {
  const existing = qrPollersByConnectionId.get(connectionId);
  if (existing) {
    clearInterval(existing);
    qrPollersByConnectionId.delete(connectionId);
  }
}

async function getConnectionIdentity(connectionId: string): Promise<ConnectionIdentity | null> {
  return prisma.socialConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      companyId: true,
      displayName: true,
      platform: true,
      loginIdentifier: true,
      secretCipher: true,
    },
  });
}

async function isQrRequestStillActive(connectionId: string): Promise<boolean> {
  const connection = await prisma.socialConnection.findUnique({
    where: { id: connectionId },
    select: {
      platform: true,
      authStatus: true,
    },
  });

  return Boolean(connection && connection.platform === "whatsapp" && connection.authStatus === "AUTH_IN_PROGRESS");
}

function getConnectionCredentials(connection: ConnectionIdentity): EvolutionCredentials {
  if (isWhatsappEvolutionHardcodedEnabled()) {
    const apiKey = HARD_CODED_INSTANCE_API_KEY || EVOLUTION_API_KEY;
    if (!apiKey) {
      throw new Error("WHATSAPP_EVOLUTION_API_KEY_MISSING");
    }

    return {
      instanceName: HARD_CODED_INSTANCE_NAME,
      apiKey,
      baseUrl: EVOLUTION_API_BASE_URL,
    };
  }

  const instanceName = connection.loginIdentifier?.trim() || buildAutoWhatsappInstanceName(connection.id);
  const apiKey = decodeSecret(connection.secretCipher) ?? EVOLUTION_API_KEY;

  if (!apiKey) {
    throw new Error("WHATSAPP_EVOLUTION_API_KEY_MISSING");
  }

  return {
    instanceName,
    apiKey,
    baseUrl: EVOLUTION_API_BASE_URL,
  };
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorDetailFromPayload(payload: unknown): string {
  const normalizeMessage = (value: unknown): string => {
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      return value
        .map((entry) => normalizeMessage(entry))
        .filter((entry) => entry.length > 0)
        .join("; ");
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return (
        normalizeMessage(record.message) ||
        normalizeMessage(record.error) ||
        normalizeMessage(record.description) ||
        ""
      );
    }
    return "";
  };

  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const directMessage =
      normalizeMessage(record.message) ||
      normalizeMessage(record.error) ||
      normalizeMessage(record.description) ||
      "";
    if (directMessage) {
      return directMessage;
    }

    const nested = record.response;
    if (nested && typeof nested === "object") {
      const nestedRecord = nested as Record<string, unknown>;
      const nestedMessage =
        normalizeMessage(nestedRecord.message) ||
        normalizeMessage(nestedRecord.error) ||
        "";
      if (nestedMessage) {
        return nestedMessage;
      }
    }
  }

  return "";
}

function errorHasHttpStatus(error: unknown, status: number): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes(`WHATSAPP_EVOLUTION_API_HTTP_${status}:`);
}

async function evolutionRequest<T>(
  credentials: EvolutionCredentials,
  route: string,
  options: EvolutionRequestOptions = {},
): Promise<T> {
  const safeRoute = route.startsWith("/") ? route : `/${route}`;
  const url = `${credentials.baseUrl}${safeRoute}`;

  const headers = new Headers();
  headers.set("apikey", credentials.apiKey);

  let body: string | undefined;
  if (options.jsonBody !== undefined) {
    body = JSON.stringify(options.jsonBody);
    headers.set("Content-Type", "application/json");
  }

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), EVOLUTION_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: abortController.signal,
    });
    const payload = await parseResponsePayload(response);

    if (!response.ok) {
      const detail = errorDetailFromPayload(payload);
      throw new Error(
        `WHATSAPP_EVOLUTION_API_HTTP_${response.status}:${safeRoute}${detail ? `:${detail}` : ""}`,
      );
    }

    return payload as T;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function markConnectionConnected(
  connectionId: string,
  metadata?: { ownerJid?: string | null; profileName?: string | null },
): Promise<void> {
  await prisma.socialConnection.updateMany({
    where: { id: connectionId, platform: "whatsapp" },
    data: {
      authStatus: "CONNECTED",
      authLaunchUrl: null,
      lastAuthAt: new Date(),
      lastSeenAt: new Date(),
      providerMetadata: {
        whatsappOwnerJid: metadata?.ownerJid ?? null,
        whatsappProfileName: metadata?.profileName ?? null,
      },
    },
  });
}

async function markConnectionAuthRequired(connectionId: string): Promise<void> {
  if (isWhatsappEvolutionHardcodedEnabled()) {
    await prisma.socialConnection.updateMany({
      where: { id: connectionId, platform: "whatsapp" },
      data: {
        authStatus: "AUTH_REQUIRED",
        authLaunchUrl: null,
        lastAuthAt: null,
        lastSeenAt: null,
      },
    });
    return;
  }

  await prisma.socialConnection.updateMany({
    where: { id: connectionId, platform: "whatsapp" },
    data: {
      authStatus: "AUTH_REQUIRED",
      loginIdentifier: buildFreshWhatsappInstanceName(connectionId),
      authLaunchUrl: null,
      lastAuthAt: null,
      lastSeenAt: null,
    },
  });
}

async function fetchInstanceRecord(credentials: EvolutionCredentials): Promise<EvolutionFetchInstanceRecord | null> {
  const query = encodeURIComponent(credentials.instanceName);
  const payload = await evolutionRequest<unknown>(credentials, `/instance/fetchInstances?instanceName=${query}`);
  const matchesInstanceName = (entry: unknown): boolean => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const record = entry as EvolutionFetchInstanceRecord;
    const names = [
      record.name,
      record.instanceName,
      record.instance?.name,
      record.instance?.instanceName,
    ];
    return names.some((name) => typeof name === "string" && name === credentials.instanceName);
  };

  if (Array.isArray(payload)) {
    const first = payload.find(matchesInstanceName);
    if (first) {
      return first as EvolutionFetchInstanceRecord;
    }
    // Alguns provedores retornam array sem nome/instanceName; melhor esforço: usa o primeiro.
    const fallback = payload.find((entry) => entry && typeof entry === "object") ?? null;
    return fallback ? (fallback as EvolutionFetchInstanceRecord) : null;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (matchesInstanceName(record)) {
      return record as EvolutionFetchInstanceRecord;
    }

    const instances = record.instances;
    if (Array.isArray(instances)) {
      const first = instances.find(matchesInstanceName);
      if (first) {
        return first as EvolutionFetchInstanceRecord;
      }
      const fallback = instances.find((entry) => entry && typeof entry === "object") ?? null;
      if (fallback) {
        return fallback as EvolutionFetchInstanceRecord;
      }
    }

    const nestedInstance = record.instance;
    if (nestedInstance && typeof nestedInstance === "object" && matchesInstanceName({ ...record, instance: nestedInstance })) {
      return { ...record, instance: nestedInstance as EvolutionFetchInstanceRecord["instance"] } as EvolutionFetchInstanceRecord;
    }

    // Melhor esforço: se vier um objeto único, tenta usar como registro.
    return record as EvolutionFetchInstanceRecord;
  }

  return null;
}

export async function resolveWhatsappConnectionRuntimeMetadata(input: {
  id: string;
  companyId: string;
  displayName: string;
  platform?: string;
  loginIdentifier: string | null;
  secretCipher: string | null;
}): Promise<{ profileName: string | null; ownerJid: string | null }> {
  const fallback = {
    profileName: null,
    ownerJid: null,
  };

  if (input.platform !== "whatsapp") {
    return fallback;
  }

  try {
    const credentials = getConnectionCredentials({
      id: input.id,
      companyId: input.companyId,
      displayName: input.displayName,
      platform: "whatsapp",
      loginIdentifier: input.loginIdentifier,
      secretCipher: input.secretCipher,
    });
    const instance = await fetchInstanceRecord(credentials);
    let profileName = resolveInstanceProfileName(instance);
    let ownerJid = resolveInstanceOwnerJid(instance);
    if (!ownerJid) {
      try {
        const payload = await evolutionRequest<unknown>(
          credentials,
          `/instance/connectionState/${encodeURIComponent(credentials.instanceName)}`,
        );
        const stateMetadata = resolveOwnerFromConnectionState(payload);
        ownerJid = stateMetadata.ownerJid;
        profileName = profileName ?? stateMetadata.profileName;
      } catch {
        // ignora
      }
    }
    if (!ownerJid) {
      try {
        const contacts = await evolutionRequest<unknown>(
          credentials,
          `/chat/findContacts/${encodeURIComponent(credentials.instanceName)}`,
          {
            method: "POST",
            jsonBody: {
              where: {},
            },
          },
        );
        const contactOwner = pickOwnerFromContacts(contacts);
        ownerJid = contactOwner.ownerJid;
        profileName = profileName ?? contactOwner.profileName;
      } catch {
        // Mantem fallback vazio se contatos não estiverem disponíveis.
      }
    }
    return {
      profileName,
      ownerJid,
    };
  } catch {
    return fallback;
  }
}

export async function resolveWhatsappConnectionRuntimeAuthStatus(input: {
  id: string;
  companyId: string;
  displayName: string;
  platform?: string;
  loginIdentifier: string | null;
  secretCipher: string | null;
}): Promise<"CONNECTED" | "AUTH_IN_PROGRESS" | "AUTH_REQUIRED" | null> {
  if (input.platform !== "whatsapp") {
    return null;
  }

  try {
    const credentials = getConnectionCredentials({
      id: input.id,
      companyId: input.companyId,
      displayName: input.displayName,
      platform: "whatsapp",
      loginIdentifier: input.loginIdentifier,
      secretCipher: input.secretCipher,
    });
    const state = await getEffectiveConnectionState(credentials);
    const normalized = normalizeState(state);

    if (normalized === "open") {
      return "CONNECTED";
    }

    if (normalized === "connecting") {
      return "AUTH_IN_PROGRESS";
    }

    if (normalized === "close" || normalized === "closed") {
      return "AUTH_REQUIRED";
    }

    return null;
  } catch {
    return null;
  }
}

async function ensureInstanceExists(credentials: EvolutionCredentials): Promise<void> {
  try {
    const existing = await fetchInstanceRecord(credentials);
    if (existing) {
      return;
    }
  } catch (error) {
    if (!errorHasHttpStatus(error, 404)) {
      throw error;
    }
  }

  await evolutionRequest(credentials, "/instance/create", {
    method: "POST",
    jsonBody: {
      instanceName: credentials.instanceName,
      integration: EVOLUTION_INSTANCE_INTEGRATION || "WHATSAPP-BAILEYS",
      qrcode: false,
    },
  });
}

async function getConnectionState(credentials: EvolutionCredentials): Promise<string | null> {
  const payload = await evolutionRequest<EvolutionConnectionStateResponse>(
    credentials,
    `/instance/connectionState/${encodeURIComponent(credentials.instanceName)}`,
  );

  const state =
    payload?.instance?.state ??
    payload?.instance?.status ??
    payload?.state ??
    payload?.status ??
    null;

  return typeof state === "string" ? state : null;
}

function normalizeState(state: string | null): string | null {
  return state?.trim().toLowerCase() ?? null;
}

function resolveInstanceOwnerJid(instance: EvolutionFetchInstanceRecord | null): string | null {
  const direct = typeof instance?.ownerJid === "string" ? instance.ownerJid.trim() : "";
  if (direct) {
    return direct;
  }
  const nested = typeof instance?.instance?.ownerJid === "string" ? instance.instance.ownerJid.trim() : "";
  if (nested) {
    return nested;
  }

  const directNumber = typeof instance?.number === "string" ? instance.number.replace(/\D/g, "") : "";
  if (directNumber) {
    return `${directNumber}@s.whatsapp.net`;
  }

  const nestedNumber = typeof instance?.instance?.number === "string" ? instance.instance.number.replace(/\D/g, "") : "";
  return nestedNumber ? `${nestedNumber}@s.whatsapp.net` : null;
}

function resolveInstanceProfileName(instance: EvolutionFetchInstanceRecord | null): string | null {
  const candidates = [
    instance?.profileName,
    instance?.profileNameNotify,
    instance?.instance?.profileName,
    instance?.instance?.profileNameNotify,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function jidFromNumber(value: string | null | undefined): string | null {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function normalizeWhatsappJid(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return null;
  }
  if (normalized.endsWith("@s.whatsapp.net")) {
    return normalized;
  }
  return jidFromNumber(normalized);
}

function pickOwnerFromContacts(rawContacts: unknown): { ownerJid: string | null; profileName: string | null } {
  if (!Array.isArray(rawContacts)) {
    return { ownerJid: null, profileName: null };
  }

  const candidates = rawContacts
    .filter((entry): entry is EvolutionContactRecord => Boolean(entry && typeof entry === "object"))
    .filter((contact) => {
      const jid = normalizeWhatsappJid(contact.ownerJid ?? contact.remoteJid ?? contact.id ?? contact.number ?? null);
      if (!jid || jid === "0@s.whatsapp.net" || jid.endsWith("@lid") || jid.endsWith("@g.us")) {
        return false;
      }
      if (contact.isGroup === true || (typeof contact.type === "string" && contact.type.toLowerCase() === "group")) {
        return false;
      }
      return true;
    });

  const namedCandidate = candidates.find((contact) => {
    const name = contact.pushName || contact.verifiedName || contact.name;
    return typeof name === "string" && name.trim().length > 0;
  });
  const candidate = namedCandidate ?? candidates[0] ?? null;
  if (!candidate) {
    return { ownerJid: null, profileName: null };
  }

  return {
    ownerJid: normalizeWhatsappJid(candidate.ownerJid ?? candidate.remoteJid ?? candidate.id ?? candidate.number ?? null),
    profileName:
      typeof candidate.pushName === "string" && candidate.pushName.trim()
        ? candidate.pushName.trim()
        : typeof candidate.verifiedName === "string" && candidate.verifiedName.trim()
          ? candidate.verifiedName.trim()
          : typeof candidate.name === "string" && candidate.name.trim()
            ? candidate.name.trim()
            : null,
  };
}

function resolveOwnerFromConnectionState(payload: unknown): { ownerJid: string | null; profileName: string | null } {
  if (!payload || typeof payload !== "object") {
    return { ownerJid: null, profileName: null };
  }
  const record = payload as Record<string, unknown>;
  const instance = (record.instance && typeof record.instance === "object" ? (record.instance as Record<string, unknown>) : null) ?? null;
  const ownerJid = normalizeWhatsappJid(
    (typeof record.ownerJid === "string" ? record.ownerJid : null) ??
      (typeof record.number === "string" ? record.number : null) ??
      (instance ? (typeof instance.ownerJid === "string" ? instance.ownerJid : typeof instance.number === "string" ? instance.number : null) : null),
  );
  const profileName =
    (typeof record.profileName === "string" && record.profileName.trim() ? record.profileName.trim() : null) ??
    (typeof record.profileNameNotify === "string" && record.profileNameNotify.trim() ? record.profileNameNotify.trim() : null) ??
    (instance
      ? (typeof instance.profileName === "string" && instance.profileName.trim()
          ? instance.profileName.trim()
          : typeof instance.profileNameNotify === "string" && instance.profileNameNotify.trim()
            ? instance.profileNameNotify.trim()
            : null)
      : null);
  return { ownerJid, profileName };
}

async function getEffectiveConnectionState(credentials: EvolutionCredentials): Promise<string | null> {
  try {
    const state = await getConnectionState(credentials);
    if (state) {
      return state;
    }
  } catch (error) {
    if (!errorHasHttpStatus(error, 404)) {
      throw error;
    }
  }

  const instance = await fetchInstanceRecord(credentials);
  const fallbackState = instance?.connectionStatus ?? null;
  return typeof fallbackState === "string" ? fallbackState : null;
}

async function connectInstance(credentials: EvolutionCredentials): Promise<EvolutionConnectResponse> {
  try {
    return await evolutionRequest<EvolutionConnectResponse>(
      credentials,
      `/instance/connect/${encodeURIComponent(credentials.instanceName)}`,
    );
  } catch (error) {
    if (!errorHasHttpStatus(error, 404)) {
      throw error;
    }

    await ensureInstanceExists(credentials);
    return evolutionRequest<EvolutionConnectResponse>(
      credentials,
      `/instance/connect/${encodeURIComponent(credentials.instanceName)}`,
    );
  }
}

async function logoutInstance(credentials: EvolutionCredentials): Promise<void> {
  await evolutionRequest(credentials, `/instance/logout/${encodeURIComponent(credentials.instanceName)}`, {
    method: "DELETE",
  });
}

async function deleteInstance(credentials: EvolutionCredentials): Promise<void> {
  await evolutionRequest(credentials, `/instance/delete/${encodeURIComponent(credentials.instanceName)}`, {
    method: "DELETE",
  });
}

async function waitForInstanceDeletion(
  credentials: EvolutionCredentials,
  timeoutMs: number = 15_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const existing = await fetchInstanceRecord(credentials);
      if (!existing) {
        return;
      }
    } catch (error) {
      if (errorHasHttpStatus(error, 404)) {
        return;
      }
      throw error;
    }

    await delay(1_000);
  }

  throw new Error("WHATSAPP_INSTANCE_DELETE_PENDING");
}

async function waitForLogoutToInvalidateCurrentSession(
  credentials: EvolutionCredentials,
  timeoutMs: number = 15_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = normalizeState(await getEffectiveConnectionState(credentials));
    if (!state || state === "close" || state === "closed" || state === "connecting") {
      return;
    }

    await delay(1_000);
  }

  throw new Error("WHATSAPP_INSTANCE_LOGOUT_PENDING");
}

function formatStateMessage(state: string | null): string {
  const normalized = normalizeState(state);
  switch (normalized) {
    case "open":
      return "Instancia conectada.";
    case "connecting":
      return "Instancia iniciando sessao. Aguarde alguns segundos.";
    case "close":
    case "closed":
      return "Escaneie o QR Code no WhatsApp.";
    default:
      return "Sincronizando estado da instancia.";
  }
}

function toQrImageDataUrl(base64: string): string {
  if (base64.startsWith("data:image/")) {
    return base64;
  }

  return `data:image/png;base64,${base64}`;
}

async function qrCodeToDataUrl(code: string): Promise<string> {
  return QRCode.toDataURL(code, {
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

function mimeTypeForFile(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".webm":
      return "video/webm";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

function statusMediaTypeFromMimeType(mimeType: string): "image" | "video" | "audio" {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  throw new Error("WHATSAPP_STATUS_MEDIA_UNSUPPORTED");
}

async function appendWhatsappDiagnosticLog(input: {
  companyId: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  errorCode?: string;
}): Promise<void> {
  await prisma.agentLog.create({
    data: {
      companyId: input.companyId,
      level: input.level,
      errorCode: input.errorCode ?? null,
      message: input.message,
    },
  });
}

async function syncQrState(
  connectionId: string,
  credentials: EvolutionCredentials,
  allowExistingConnectedSession: boolean,
): Promise<"CONTINUE" | "STOP"> {
  const state = await getEffectiveConnectionState(credentials);
  const normalizedState = normalizeState(state);

  if (normalizedState === "open") {
    if (!allowExistingConnectedSession) {
      throw new Error("WHATSAPP_INSTANCE_REUSE_BLOCKED");
    }

    let ownerJid: string | null = null;
    let profileName: string | null = null;
    try {
      const instance = await fetchInstanceRecord(credentials);
      ownerJid = resolveInstanceOwnerJid(instance);
      profileName = resolveInstanceProfileName(instance);
    } catch {
      // Mantém conectado mesmo se o metadata fetch falhar.
    }

    setQrOverlay(connectionId, {
      qrStatus: "CONNECTED",
      qrImageDataUrl: null,
      qrMessage: "Conta WhatsApp conectada com sucesso.",
      qrGeneratedAt: null,
      whatsappOwnerJid: ownerJid,
      whatsappProfileName: profileName,
    });
    await markConnectionConnected(connectionId, { ownerJid, profileName });
    return "STOP";
  }

  let connect: EvolutionConnectResponse;
  try {
    connect = await connectInstance(credentials);
  } catch (error) {
    const retryState = normalizeState(await getEffectiveConnectionState(credentials).catch(() => null));

    if (retryState === "open") {
      let ownerJid: string | null = null;
      let profileName: string | null = null;
      try {
        const instance = await fetchInstanceRecord(credentials);
        ownerJid = resolveInstanceOwnerJid(instance);
        profileName = resolveInstanceProfileName(instance);
      } catch {
        // melhor esforço
      }

      setQrOverlay(connectionId, {
        qrStatus: "CONNECTED",
        qrImageDataUrl: null,
        qrMessage: "Conta WhatsApp conectada com sucesso.",
        qrGeneratedAt: null,
        whatsappOwnerJid: ownerJid,
        whatsappProfileName: profileName,
      });
      await markConnectionConnected(connectionId, { ownerJid, profileName });
      return "STOP";
    }

    if (retryState === "connecting") {
      setQrOverlay(connectionId, {
        qrStatus: "PREPARING",
        qrMessage: "Conectando o WhatsApp. Aguarde alguns segundos...",
      });
      return "CONTINUE";
    }

    throw error;
  }
  const qrCodeContent = connect.code?.trim() || "";
  const qrBase64 = connect.base64?.trim() || "";
  const pairingCode = connect.pairingCode?.trim() || "";

  if (qrBase64) {
    const qrImageDataUrl = toQrImageDataUrl(qrBase64);
    if (isSameQrCodeExpired(connectionId, qrImageDataUrl)) {
      await markConnectionAuthRequired(connectionId);
      setQrOverlay(connectionId, {
        qrStatus: "QR_EXPIRED",
        qrImageDataUrl: null,
        qrGeneratedAt: null,
        qrMessage: "QR expirado. Gere um novo QR Code do WhatsApp.",
      });
      return "STOP";
    }

    setQrOverlay(connectionId, {
      qrStatus: "WAITING_QR_SCAN",
      qrImageDataUrl,
      qrMessage: "Escaneie o QR Code no WhatsApp do celular.",
      qrGeneratedAt: preserveQrGeneratedAtForSameCode(connectionId, qrImageDataUrl),
    });
    return "CONTINUE";
  }

  if (qrCodeContent) {
    const qrDataUrl = await qrCodeToDataUrl(qrCodeContent);
    if (isSameQrCodeExpired(connectionId, qrDataUrl)) {
      await markConnectionAuthRequired(connectionId);
      setQrOverlay(connectionId, {
        qrStatus: "QR_EXPIRED",
        qrImageDataUrl: null,
        qrGeneratedAt: null,
        qrMessage: "QR expirado. Gere um novo QR Code do WhatsApp.",
      });
      return "STOP";
    }

    setQrOverlay(connectionId, {
      qrStatus: "WAITING_QR_SCAN",
      qrImageDataUrl: qrDataUrl,
      qrMessage: "Escaneie o QR Code no WhatsApp do celular.",
      qrGeneratedAt: preserveQrGeneratedAtForSameCode(connectionId, qrDataUrl),
    });
    return "CONTINUE";
  }

  if (pairingCode) {
    setQrOverlay(connectionId, {
      qrStatus: "WAITING_QR_SCAN",
      qrImageDataUrl: null,
      qrMessage: `Codigo de pareamento: ${pairingCode}`,
      qrGeneratedAt: new Date(),
    });
    return "CONTINUE";
  }

  setQrOverlay(connectionId, {
    qrStatus: normalizedState === "close" ? "QR_EXPIRED" : "PREPARING",
    qrImageDataUrl: null,
    qrMessage: formatStateMessage(state),
    qrGeneratedAt: null,
  });

  if (normalizedState === "close" || normalizedState === "closed") {
    // QR expirou / sessão fechada sem autenticar: "esquece" a tentativa para não prender em AUTH_IN_PROGRESS.
    await markConnectionAuthRequired(connectionId);
    clearQrPoller(connectionId);
    setQrOverlay(connectionId, {
      qrStatus: "IDLE",
      qrImageDataUrl: null,
      qrGeneratedAt: null,
      qrMessage: null,
      whatsappOwnerJid: null,
      whatsappProfileName: null,
    });
    return "STOP";
  }

  return "CONTINUE";
}

function extractMessageId(payload: EvolutionSendStatusResponse): string | null {
  return payload?.key?.id ?? payload?.messageId ?? payload?.id ?? null;
}

function extractRemoteJid(payload: EvolutionSendStatusResponse): string {
  return payload?.key?.remoteJid ?? "status@broadcast";
}

function normalizeStatusRecipients(rawContacts: unknown): {
  recipients: string[];
  contactsTotal: number;
  contactsRejectedGroups: number;
  contactsRejectedInvalid: number;
  contactsRejectedLid: number;
} {
  if (!Array.isArray(rawContacts)) {
    return {
      recipients: [],
      contactsTotal: 0,
      contactsRejectedGroups: 0,
      contactsRejectedInvalid: 0,
      contactsRejectedLid: 0,
    };
  }

  const recipients = new Set<string>();
  let contactsRejectedGroups = 0;
  let contactsRejectedInvalid = 0;
  let contactsRejectedLid = 0;
  for (const entry of rawContacts) {
    if (!entry || typeof entry !== "object") {
      contactsRejectedInvalid += 1;
      continue;
    }

    const contact = entry as EvolutionContactRecord;
    const remoteJid = typeof contact.remoteJid === "string" ? contact.remoteJid.trim() : "";
    if (!remoteJid) {
      contactsRejectedInvalid += 1;
      continue;
    }

    if (remoteJid === "0@s.whatsapp.net") {
      contactsRejectedInvalid += 1;
      continue;
    }

    if (contact.isGroup === true || (typeof contact.type === "string" && contact.type.toLowerCase() === "group")) {
      contactsRejectedGroups += 1;
      continue;
    }

    if (remoteJid.endsWith("@g.us")) {
      contactsRejectedGroups += 1;
      continue;
    }

    if (remoteJid.endsWith("@lid")) {
      // @lid costuma gerar entrega inconsistente em statusJidList.
      contactsRejectedLid += 1;
      continue;
    }

    if (!remoteJid.endsWith("@s.whatsapp.net")) {
      contactsRejectedInvalid += 1;
      continue;
    }

    recipients.add(remoteJid);
  }

  return {
    recipients: Array.from(recipients),
    contactsTotal: rawContacts.length,
    contactsRejectedGroups,
    contactsRejectedInvalid,
    contactsRejectedLid,
  };
}

async function resolveStatusRecipients(credentials: EvolutionCredentials): Promise<StatusRecipientsResolution> {
  const contacts = await evolutionRequest<unknown>(
    credentials,
    `/chat/findContacts/${encodeURIComponent(credentials.instanceName)}`,
    {
      method: "POST",
      jsonBody: {
        where: {},
      },
    },
  );

  const normalized = normalizeStatusRecipients(contacts);
  let ownerJid: string | null = null;
  try {
    const instance = await fetchInstanceRecord(credentials);
    const candidateOwner = resolveInstanceOwnerJid(instance) ?? "";
    if (candidateOwner.endsWith("@s.whatsapp.net")) {
      ownerJid = candidateOwner;
    }
  } catch {
    // sem ownerJid; continua com lista de contatos.
  }

  const recipients = [...normalized.recipients];
  if (ownerJid) {
    const existingIndex = recipients.indexOf(ownerJid);
    if (existingIndex > 0) {
      recipients.splice(existingIndex, 1);
      recipients.unshift(ownerJid);
    } else if (existingIndex === -1) {
      recipients.unshift(ownerJid);
    }
  }

  return {
    recipients,
    ownerJid,
    ownerIncluded: ownerJid ? recipients.includes(ownerJid) : false,
    contactsTotal: normalized.contactsTotal,
    contactsRejectedGroups: normalized.contactsRejectedGroups,
    contactsRejectedInvalid: normalized.contactsRejectedInvalid,
    contactsRejectedLid: normalized.contactsRejectedLid,
  };
}

function buildTextStatusPayload(
  content: string,
  recipients: string[],
  backgroundColor?: string | null,
): Record<string, unknown> {
  return {
    type: "text",
    content,
    linkPreview: true,
    caption: "",
    backgroundColor: backgroundColor?.trim() || EVOLUTION_STATUS_TEXT_BACKGROUND,
    font: EVOLUTION_STATUS_TEXT_FONT,
    statusJidList: recipients,
    allContacts: false,
  };
}

function buildMediaStatusPayload(input: {
  statusType: "image" | "video" | "audio";
  dataUrl: string;
  caption: string;
  recipients: string[];
  backgroundColor?: string | null;
}): Record<string, unknown> {
  return {
    type: input.statusType,
    content: input.dataUrl,
    caption: input.caption || "",
    backgroundColor: input.backgroundColor?.trim() || EVOLUTION_STATUS_TEXT_BACKGROUND,
    font: EVOLUTION_STATUS_TEXT_FONT,
    statusJidList: input.recipients,
    allContacts: false,
  };
}

function assertAuthorizedState(state: string | null): void {
  const normalized = normalizeState(state);

  if (normalized === "open") {
    return;
  }

  if (normalized === "connecting") {
    throw new Error("WHATSAPP_INSTANCE_STARTING");
  }

  if (!normalized || normalized === "close" || normalized === "closed") {
    throw new Error("LOGIN_REQUIRED_WHATSAPP");
  }

  throw new Error(`WHATSAPP_INSTANCE_STATE_${state ?? "UNKNOWN"}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hasPersistedStatusMessage(
  credentials: EvolutionCredentials,
  messageId: string,
): Promise<boolean> {
  const payload = await evolutionRequest<EvolutionFindMessagesResponse>(
    credentials,
    `/chat/findMessages/${encodeURIComponent(credentials.instanceName)}`,
    {
      method: "POST",
      jsonBody: {
        where: {
          key: {
            id: messageId,
            remoteJid: "status@broadcast",
            fromMe: true,
          },
        },
        offset: 1,
        page: 1,
      },
    },
  );

  const total = payload?.messages?.total ?? 0;
  const records = Array.isArray(payload?.messages?.records) ? payload.messages.records.length : 0;
  return total > 0 || records > 0;
}

async function getPersistedStatusMessageCount(credentials: EvolutionCredentials): Promise<number> {
  const payload = await evolutionRequest<EvolutionFindMessagesResponse>(
    credentials,
    `/chat/findMessages/${encodeURIComponent(credentials.instanceName)}`,
    {
      method: "POST",
      jsonBody: {
        where: {
          key: {
            remoteJid: "status@broadcast",
            fromMe: true,
          },
        },
        offset: 1,
        page: 1,
      },
    },
  );

  const total = payload?.messages?.total;
  if (typeof total === "number" && Number.isFinite(total)) {
    return total;
  }

  return Array.isArray(payload?.messages?.records) ? payload.messages.records.length : 0;
}

function isWhatsappAbortError(error: unknown): boolean {
  return error instanceof Error && error.message.trim().toLowerCase() === "this operation was aborted";
}

async function waitStatusCountIncrease(
  credentials: EvolutionCredentials,
  baselineCount: number,
): Promise<boolean> {
  for (let attempt = 1; attempt <= EVOLUTION_STATUS_CONFIRMATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const currentCount = await getPersistedStatusMessageCount(credentials);
      if (currentCount > baselineCount) {
        return true;
      }
    } catch {
      // Ignora falhas transitórias e tenta novamente.
    }

    if (attempt < EVOLUTION_STATUS_CONFIRMATION_MAX_ATTEMPTS) {
      await delay(EVOLUTION_STATUS_CONFIRMATION_DELAY_MS);
    }
  }

  return false;
}

async function waitStatusPersistenceConfirmation(
  credentials: EvolutionCredentials,
  messageId: string | null,
): Promise<boolean> {
  if (!messageId) {
    return false;
  }

  for (let attempt = 1; attempt <= EVOLUTION_STATUS_CONFIRMATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const persisted = await hasPersistedStatusMessage(credentials, messageId);
      if (persisted) {
        return true;
      }
    } catch {
      // Tenta novamente; falhas transitórias não devem derrubar o envio.
    }

    if (attempt < EVOLUTION_STATUS_CONFIRMATION_MAX_ATTEMPTS) {
      await delay(EVOLUTION_STATUS_CONFIRMATION_DELAY_MS);
    }
  }

  return false;
}

export function getWhatsappConnectionOverlay(connectionId: string): Partial<Record<string, unknown>> {
  const state = qrOverlayByConnectionId.get(connectionId);
  if (!state) {
    return {};
  }

  return {
    qrStatus: state.qrStatus,
    qrImageDataUrl: state.qrImageDataUrl,
    qrGeneratedAt: state.qrGeneratedAt,
    workerLastSeenAt: state.workerLastSeenAt,
    qrMessage: state.qrMessage,
    whatsappOwnerJid: state.whatsappOwnerJid,
    whatsappProfileName: state.whatsappProfileName,
  };
}

export async function requestWhatsappQr(connectionId: string, forceRegenerate: boolean): Promise<void> {
  clearQrPoller(connectionId);

  let connection = await getConnectionIdentity(connectionId);
  if (!connection || connection.platform !== "whatsapp") {
    throw new Error("WHATSAPP_CONNECTION_NOT_FOUND");
  }

  if (forceRegenerate && !isWhatsappEvolutionHardcodedEnabled()) {
    const nextInstanceName = buildFreshWhatsappInstanceName(connection.id);
    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        loginIdentifier: nextInstanceName,
        authStatus: "AUTH_IN_PROGRESS",
        authLaunchUrl: "https://web.whatsapp.com/",
        lastAuthAt: null,
        lastSeenAt: new Date(),
      },
    });

    connection = {
      ...connection,
      loginIdentifier: nextInstanceName,
    };
  }

  let credentials: EvolutionCredentials;
  try {
    credentials = getConnectionCredentials(connection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "WHATSAPP_EVOLUTION_CREDENTIALS_MISSING";
    setQrOverlay(connectionId, {
      qrStatus: "ERROR",
      qrImageDataUrl: null,
      qrGeneratedAt: null,
      qrMessage: message,
    });
    throw error;
  }

  const existingOverlay = qrOverlayByConnectionId.get(connectionId);
  if (!forceRegenerate && isReusableQrOverlay(existingOverlay)) {
    // Reaproveita o QR recente, mas só se a Evolution ainda não marcou a sessão como fechada/expirada.
    try {
      const state = normalizeState(await getEffectiveConnectionState(credentials));
      if (state === "close" || state === "closed") {
        // QR expirou de fato no provedor; segue fluxo normal para gerar outro.
      } else {
        setQrOverlay(connectionId, {
          qrStatus: existingOverlay?.qrStatus ?? "WAITING_QR_SCAN",
          qrImageDataUrl: existingOverlay?.qrImageDataUrl ?? null,
          qrGeneratedAt: existingOverlay?.qrGeneratedAt ?? null,
          qrMessage: existingOverlay?.qrMessage ?? "Escaneie o QR Code no WhatsApp do celular.",
        });
        return;
      }
    } catch {
      // Se não conseguir validar com a Evolution, reaproveita para evitar spam de geração.
      setQrOverlay(connectionId, {
        qrStatus: existingOverlay?.qrStatus ?? "WAITING_QR_SCAN",
        qrImageDataUrl: existingOverlay?.qrImageDataUrl ?? null,
        qrGeneratedAt: existingOverlay?.qrGeneratedAt ?? null,
        qrMessage: existingOverlay?.qrMessage ?? "Escaneie o QR Code no WhatsApp do celular.",
      });
      return;
    }
  }

  setQrOverlay(connectionId, {
    qrStatus: "PREPARING",
    qrImageDataUrl: null,
    qrGeneratedAt: null,
    qrMessage: "Preparando QR Code do WhatsApp...",
  });

  try {
    await ensureInstanceExists(credentials);

    if (forceRegenerate) {
      try {
        await deleteInstance(credentials);
        await waitForInstanceDeletion(credentials);
      } catch (error) {
        if (!errorHasHttpStatus(error, 400) && !errorHasHttpStatus(error, 404)) {
          await logoutInstance(credentials);
          await waitForLogoutToInvalidateCurrentSession(credentials);
        }
      }

      await ensureInstanceExists(credentials);
    }

    let running = false;
    const tick = async () => {
      if (running) {
        return;
      }
      running = true;

      try {
        const stillActive = await isQrRequestStillActive(connectionId);
        if (!stillActive) {
          clearQrPoller(connectionId);
          return;
        }
        const outcome = await syncQrState(connectionId, credentials, !forceRegenerate);
        if (outcome === "STOP") {
          clearQrPoller(connectionId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "WHATSAPP_EVOLUTION_QR_ERROR";
        setQrOverlay(connectionId, {
          qrStatus: "ERROR",
          qrImageDataUrl: null,
          qrGeneratedAt: null,
          qrMessage: message,
        });
      } finally {
        running = false;
      }
    };

    await tick();

    const state = qrOverlayByConnectionId.get(connectionId)?.qrStatus ?? "IDLE";
    if (state === "PREPARING" || state === "WAITING_QR_SCAN") {
      const interval = setInterval(() => {
        void tick();
      }, EVOLUTION_QR_POLL_INTERVAL_MS);
      qrPollersByConnectionId.set(connectionId, interval);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "WHATSAPP_EVOLUTION_QR_ERROR";
    setQrOverlay(connectionId, {
      qrStatus: "ERROR",
      qrImageDataUrl: null,
      qrGeneratedAt: null,
      qrMessage: message,
    });
    throw error;
  }
}

export async function dismissWhatsappQr(connectionId: string): Promise<void> {
  clearQrPoller(connectionId);
  setQrOverlay(connectionId, {
    qrStatus: "IDLE",
    qrImageDataUrl: null,
    qrGeneratedAt: null,
    qrMessage: null,
  });
}

export async function markWhatsappConnected(connectionId: string): Promise<void> {
  clearQrPoller(connectionId);
  const connection = await getConnectionIdentity(connectionId);
  let ownerJid: string | null = null;
  let profileName: string | null = null;

  if (connection) {
    try {
      const credentials = getConnectionCredentials(connection);
      const instance = await fetchInstanceRecord(credentials);
      ownerJid = resolveInstanceOwnerJid(instance);
      profileName = resolveInstanceProfileName(instance);
    } catch {
      // Mantem o conectado mesmo se a Evolution demorar para devolver metadados.
    }
  }

  setQrOverlay(connectionId, {
    qrStatus: "CONNECTED",
    qrImageDataUrl: null,
    qrGeneratedAt: null,
    qrMessage: null,
    whatsappOwnerJid: ownerJid,
    whatsappProfileName: profileName,
  });

  await markConnectionConnected(connectionId, { ownerJid, profileName });
}

export async function disconnectWhatsappConnection(connectionId: string): Promise<void> {
  clearQrPoller(connectionId);

  const connection = await getConnectionIdentity(connectionId);
  if (connection) {
    try {
      const credentials = getConnectionCredentials(connection);
      await logoutInstance(credentials);
    } catch {
      // Ignore logout failures while disconnecting.
    }

    if (!isWhatsappEvolutionHardcodedEnabled()) {
      await prisma.socialConnection.updateMany({
        where: { id: connectionId, platform: "whatsapp" },
        data: {
          loginIdentifier: buildFreshWhatsappInstanceName(connectionId),
          authLaunchUrl: null,
          lastAuthAt: null,
          lastSeenAt: null,
        },
      });
    }
  }

  setQrOverlay(connectionId, {
    qrStatus: "IDLE",
    qrImageDataUrl: null,
    qrGeneratedAt: null,
    qrMessage: null,
  });
}

export async function executeWhatsappJobWithEvolutionApi(
  connection: ConnectionIdentity,
  job: JobIdentity,
  uploadsDir: string,
): Promise<{ remoteJid: string; messageId: string | null; confirmed: boolean }> {
  const credentials = getConnectionCredentials(connection);
  await ensureInstanceExists(credentials);
  const state = await getEffectiveConnectionState(credentials);
  assertAuthorizedState(state);
  const statusRecipients = await resolveStatusRecipients(credentials);
  if (statusRecipients.recipients.length === 0) {
    throw new Error("WHATSAPP_STATUS_RECIPIENTS_NOT_FOUND");
  }

  await appendWhatsappDiagnosticLog({
    companyId: connection.companyId,
    level: "INFO",
    errorCode: "WHATSAPP_STATUS_RECIPIENTS_READY",
    message:
      `Job ${job.id} enviando status para ${statusRecipients.recipients.length} recipients válidos ` +
      `(ownerIncluded=${statusRecipients.ownerIncluded ? "yes" : "no"}; ` +
      `contactsTotal=${statusRecipients.contactsTotal}; ` +
      `droppedGroups=${statusRecipients.contactsRejectedGroups}; ` +
      `droppedLid=${statusRecipients.contactsRejectedLid}; ` +
      `droppedInvalid=${statusRecipients.contactsRejectedInvalid}) via WhatsApp.`,
  });

  const route = `/message/sendStatus/${encodeURIComponent(credentials.instanceName)}`;

  if (job.publicationType === "whatsapp_status_texto") {
    const message = job.caption?.trim() ?? "";

    if (!message) {
      throw new Error("WHATSAPP_STATUS_TEXT_REQUIRED");
    }

    if (message.length > 700) {
      throw new Error("WHATSAPP_STATUS_TEXT_TOO_LONG");
    }

    const baselineCount = await getPersistedStatusMessageCount(credentials).catch(() => null);
    let response: EvolutionSendStatusResponse;
    try {
      response = await evolutionRequest<EvolutionSendStatusResponse>(credentials, route, {
        method: "POST",
        jsonBody: buildTextStatusPayload(message, statusRecipients.recipients, job.whatsappBackgroundColor),
      });
    } catch (error) {
      if (typeof baselineCount === "number" && isWhatsappAbortError(error)) {
        const recovered = await waitStatusCountIncrease(credentials, baselineCount);
        if (recovered) {
          await appendWhatsappDiagnosticLog({
            companyId: connection.companyId,
            level: "WARN",
            errorCode: "WHATSAPP_STATUS_RECOVERED_AFTER_ABORT",
            message: `Job ${job.id} teve abort no envio do status texto, mas o histórico do WhatsApp confirmou um novo status.`,
          });
          return {
            remoteJid: "status@broadcast",
            messageId: null,
            confirmed: true,
          };
        }
      }
      throw error;
    }

    const messageId = extractMessageId(response);
    const confirmed = await waitStatusPersistenceConfirmation(credentials, messageId);

    return {
      remoteJid: extractRemoteJid(response),
      messageId,
      confirmed,
    };
  }

  const mediaBundle = decodeJobMediaBundleStorage(job.filePath);
  const sourceFilePaths = mediaBundle.files.length > 0
    ? mediaBundle.files
    : (job.filePath?.trim() ? [job.filePath.trim()] : []);
  if (sourceFilePaths.length === 0) {
    throw new Error("WHATSAPP_STATUS_MEDIA_REQUIRED");
  }
  const normalizedJobCaption = job.caption?.trim() ?? "";
  let lastRemoteJid = "status@broadcast";
  let lastMessageId: string | null = null;
  let allConfirmed = true;

  for (const [index, sourceFilePath] of sourceFilePaths.entries()) {
    const absoluteFilePath = path.join(uploadsDir, path.basename(sourceFilePath));
    const fileBuffer = await fs.readFile(absoluteFilePath);
    const fileName = path.basename(absoluteFilePath);
    const mimeType = mimeTypeForFile(fileName);
    const statusType = statusMediaTypeFromMimeType(mimeType);
    const dataUrl = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
    const caption =
      sourceFilePaths.length > 1
        ? mediaBundle.captions[index]?.trim() ?? ""
        : mediaBundle.captions[0]?.trim() ?? normalizedJobCaption;

    if (caption.length > 1024) {
      throw new Error("WHATSAPP_STATUS_CAPTION_TOO_LONG");
    }

    const baselineCount = await getPersistedStatusMessageCount(credentials).catch(() => null);
    let response: EvolutionSendStatusResponse;
    try {
      response = await evolutionRequest<EvolutionSendStatusResponse>(credentials, route, {
        method: "POST",
        jsonBody: buildMediaStatusPayload({
          statusType,
          dataUrl,
          caption,
          recipients: statusRecipients.recipients,
          backgroundColor: job.whatsappBackgroundColor,
        }),
      });
    } catch (error) {
      if (typeof baselineCount === "number" && isWhatsappAbortError(error)) {
        const recovered = await waitStatusCountIncrease(credentials, baselineCount);
        if (recovered) {
          await appendWhatsappDiagnosticLog({
            companyId: connection.companyId,
            level: "WARN",
            errorCode: "WHATSAPP_STATUS_RECOVERED_AFTER_ABORT",
            message: `Job ${job.id} teve abort no envio do status mídia, mas o histórico do WhatsApp confirmou um novo status.`,
          });
          lastRemoteJid = "status@broadcast";
          lastMessageId = null;
          allConfirmed = allConfirmed && true;
          continue;
        }
      }
      throw error;
    }

    lastRemoteJid = extractRemoteJid(response);
    lastMessageId = extractMessageId(response);
    const confirmed = await waitStatusPersistenceConfirmation(credentials, lastMessageId);
    allConfirmed = allConfirmed && confirmed;
  }

  return {
    remoteJid: lastRemoteJid,
    messageId: lastMessageId,
    confirmed: allConfirmed,
  };
}
