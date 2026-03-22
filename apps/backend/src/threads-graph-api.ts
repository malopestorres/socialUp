import { randomBytes } from "node:crypto";

type ThreadsOAuthStateEntry = {
  connectionId: string;
  createdAtMs: number;
  returnToUrl: string | null;
};

type ThreadsOAuthTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  user_id?: string | number;
};

type ThreadsMeResponse = {
  id?: string | number;
  username?: string;
  name?: string;
};

const THREADS_APP_ID = (process.env.THREADS_APP_ID || "").trim();
const THREADS_APP_SECRET = (process.env.THREADS_APP_SECRET || "").trim();
const THREADS_REDIRECT_URI = (process.env.THREADS_REDIRECT_URI || "").trim();
const THREADS_SCOPES = (process.env.THREADS_SCOPES || "threads_basic,threads_content_publish")
  .split(",")
  .map((scope) => scope.trim())
  .filter((scope) => scope.length > 0);
const THREADS_OAUTH_AUTHORIZE_URL = (process.env.THREADS_OAUTH_AUTHORIZE_URL || "https://threads.net/oauth/authorize")
  .trim();
const THREADS_GRAPH_API_BASE_URL = (process.env.THREADS_GRAPH_API_BASE_URL || "https://graph.threads.net")
  .trim()
  .replace(/\/+$/, "");
const THREADS_TIMEOUT_MS = parsePositiveInt(process.env.THREADS_TIMEOUT_MS, 30_000);
const THREADS_OAUTH_STATE_TTL_MS = parsePositiveInt(process.env.THREADS_OAUTH_STATE_TTL_MS, 15 * 60 * 1000);

const oauthStateByToken = new Map<string, ThreadsOAuthStateEntry>();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOAuthReturnToUrl(value: string | null | undefined): string | null {
  const normalized = (value || "").trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeSecret(secretCipher?: string | null): string | null {
  if (!secretCipher) {
    return null;
  }

  try {
    return Buffer.from(secretCipher, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function parseIdLike(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function cleanupExpiredOAuthStateEntries(nowMs: number): void {
  for (const [token, entry] of oauthStateByToken.entries()) {
    if (nowMs - entry.createdAtMs > THREADS_OAUTH_STATE_TTL_MS) {
      oauthStateByToken.delete(token);
    }
  }
}

function ensureThreadsConfigured(): void {
  const missing: string[] = [];
  if (!THREADS_APP_ID) {
    missing.push("THREADS_APP_ID");
  }
  if (!THREADS_APP_SECRET) {
    missing.push("THREADS_APP_SECRET");
  }
  if (!THREADS_REDIRECT_URI) {
    missing.push("THREADS_REDIRECT_URI");
  }
  if (THREADS_SCOPES.length === 0) {
    missing.push("THREADS_SCOPES");
  }

  if (missing.length > 0) {
    throw new Error(`THREADS_CONFIG_MISSING:${missing.join(",")}`);
  }
}

function normalizeErrorDetail(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    const message = typeof errorRecord.message === "string" ? errorRecord.message.trim() : "";
    if (message) {
      return message;
    }
  }

  const message = typeof record.message === "string" ? record.message.trim() : "";
  return message;
}

function threadsErrorCodeFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (!error || typeof error !== "object") {
    return null;
  }

  const errorRecord = error as Record<string, unknown>;
  const code = errorRecord.code;
  return typeof code === "number" ? code : null;
}

function isThreadsAuthFailure(status: number, payload: unknown): boolean {
  const errorCode = threadsErrorCodeFromPayload(payload);
  return status === 401 || errorCode === 190 || errorCode === 102;
}

export function isThreadsLoginRequiredErrorMessage(message: string): boolean {
  const normalized = message.trim();
  return normalized === "LOGIN_REQUIRED_THREADS" || normalized.startsWith("LOGIN_REQUIRED_THREADS:");
}

function isThreadsTesterPermissionErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("threads_basic permission") && normalized.includes("threads testers");
}

async function threadsRequest<T>(
  path: string,
  options?: {
    method?: "GET" | "POST";
    accessToken?: string | null;
    query?: Record<string, string | number | boolean | null | undefined>;
    body?: URLSearchParams | string | null;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const baseUrl = THREADS_GRAPH_API_BASE_URL;
  const url = new URL(path.startsWith("/") ? `${baseUrl}${path}` : `${baseUrl}/${path}`);
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), THREADS_TIMEOUT_MS);
  try {
    const headers = new Headers(options?.headers ?? {});
    if (options?.accessToken) {
      headers.set("Authorization", `Bearer ${options.accessToken}`);
    }
    if (options?.body instanceof URLSearchParams) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    }

    const response = await fetch(url, {
      method: options?.method || "GET",
      headers,
      body: options?.body ?? undefined,
      signal: controller.signal,
    });

    const rawBody = await response.text();
    const payload = rawBody
      ? (() => {
          try {
            return JSON.parse(rawBody);
          } catch {
            return rawBody;
          }
        })()
      : null;

    if (!response.ok) {
      const detail = normalizeErrorDetail(payload);
      if (isThreadsAuthFailure(response.status, payload)) {
        throw new Error(`LOGIN_REQUIRED_THREADS${detail ? `:${detail}` : ""}`);
      }

      throw new Error(
        `THREADS_GRAPH_API_HTTP_${response.status}:${path}${detail ? `:${detail}` : ""}`,
      );
    }

    return (payload ?? {}) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`THREADS_GRAPH_API_TIMEOUT:${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchThreadsMe(accessToken: string): Promise<{ threadsUserId: string | null; threadsUsername: string | null }> {
  const payload = await threadsRequest<ThreadsMeResponse>("/me", {
    accessToken,
    query: {
      fields: "id,username,name",
    },
  });

  return {
    threadsUserId: parseIdLike(payload.id),
    threadsUsername: (payload.username || payload.name || "").trim() || null,
  };
}

export function createThreadsOAuthLaunchUrl(
  connectionId: string,
  options?: {
    returnToUrl?: string | null;
  },
): string {
  ensureThreadsConfigured();
  const nowMs = Date.now();
  cleanupExpiredOAuthStateEntries(nowMs);

  const stateToken = randomBytes(18).toString("hex");
  oauthStateByToken.set(stateToken, {
    connectionId,
    createdAtMs: nowMs,
    returnToUrl: normalizeOAuthReturnToUrl(options?.returnToUrl),
  });

  const launchUrl = new URL(THREADS_OAUTH_AUTHORIZE_URL);
  launchUrl.searchParams.set("client_id", THREADS_APP_ID);
  launchUrl.searchParams.set("redirect_uri", THREADS_REDIRECT_URI);
  launchUrl.searchParams.set("response_type", "code");
  launchUrl.searchParams.set("scope", THREADS_SCOPES.join(","));
  launchUrl.searchParams.set("state", stateToken);
  return launchUrl.toString();
}

export function consumeThreadsOAuthState(stateToken: string): { connectionId: string; returnToUrl: string | null } | null {
  if (!stateToken || stateToken.trim().length === 0) {
    return null;
  }

  cleanupExpiredOAuthStateEntries(Date.now());
  const entry = oauthStateByToken.get(stateToken);
  oauthStateByToken.delete(stateToken);
  if (!entry) {
    return null;
  }

  return {
    connectionId: entry.connectionId,
    returnToUrl: entry.returnToUrl,
  };
}

export async function exchangeThreadsOAuthCodeForConnection(input: {
  authorizationCode: string;
}): Promise<{
  accessToken: string;
  tokenExpiresInSeconds: number | null;
  threadsUserId: string;
  threadsUsername: string | null;
}> {
  ensureThreadsConfigured();
  const authCode = input.authorizationCode.trim();
  if (!authCode) {
    throw new Error("THREADS_OAUTH_CODE_MISSING");
  }

  const codeExchange = await threadsRequest<ThreadsOAuthTokenResponse>("/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: THREADS_APP_ID,
      client_secret: THREADS_APP_SECRET,
      code: authCode,
      grant_type: "authorization_code",
      redirect_uri: THREADS_REDIRECT_URI,
    }),
  });

  const shortLivedToken = codeExchange.access_token?.trim() || "";
  if (!shortLivedToken) {
    throw new Error("THREADS_OAUTH_SHORT_TOKEN_MISSING");
  }

  let longLived: ThreadsOAuthTokenResponse;
  try {
    longLived = await threadsRequest<ThreadsOAuthTokenResponse>("/access_token", {
      accessToken: shortLivedToken,
      query: {
        grant_type: "th_exchange_token",
        client_secret: THREADS_APP_SECRET,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "THREADS_OAUTH_LONG_TOKEN_EXCHANGE_FAILED";
    if (isThreadsTesterPermissionErrorMessage(message)) {
      throw new Error(
        "THREADS_PERMISSION_REQUIRED_TESTER:adicione sua conta em Threads Testers ou envie o app para app review com threads_basic",
      );
    }
    throw error;
  }

  const effectiveToken = longLived.access_token?.trim() || shortLivedToken;
  if (!effectiveToken) {
    throw new Error("THREADS_OAUTH_LONG_TOKEN_MISSING");
  }

  const metadata = await fetchThreadsMe(effectiveToken);
  const threadsUserId = metadata.threadsUserId || parseIdLike(codeExchange.user_id);
  if (!threadsUserId) {
    throw new Error("THREADS_OAUTH_USER_ID_MISSING");
  }

  return {
    accessToken: effectiveToken,
    tokenExpiresInSeconds: typeof longLived.expires_in === "number" ? longLived.expires_in : null,
    threadsUserId,
    threadsUsername: metadata.threadsUsername,
  };
}

export async function refreshThreadsAccessTokenForConnection(input: {
  secretCipher: string | null;
}): Promise<{
  accessToken: string;
  tokenExpiresInSeconds: number | null;
}> {
  const currentToken = decodeSecret(input.secretCipher)?.trim() || "";
  if (!currentToken) {
    throw new Error("LOGIN_REQUIRED_THREADS");
  }

  const refreshed = await threadsRequest<ThreadsOAuthTokenResponse>("/refresh_access_token", {
    accessToken: currentToken,
    query: {
      grant_type: "th_refresh_token",
    },
  });

  return {
    accessToken: refreshed.access_token?.trim() || currentToken,
    tokenExpiresInSeconds: typeof refreshed.expires_in === "number" ? refreshed.expires_in : null,
  };
}

export async function resolveThreadsConnectionRuntimeMetadata(input: {
  loginIdentifier?: string | null;
  secretCipher: string | null;
}): Promise<{ threadsUserId: string | null; threadsUsername: string | null }> {
  const accessToken = decodeSecret(input.secretCipher)?.trim() || "";
  if (!accessToken) {
    return {
      threadsUserId: null,
      threadsUsername: input.loginIdentifier?.trim() || null,
    };
  }

  try {
    return await fetchThreadsMe(accessToken);
  } catch (error) {
    if (error instanceof Error && isThreadsLoginRequiredErrorMessage(error.message)) {
      throw error;
    }

    return {
      threadsUserId: null,
      threadsUsername: input.loginIdentifier?.trim() || null,
    };
  }
}
