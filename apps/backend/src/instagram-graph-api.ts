import { randomBytes } from "node:crypto";
import type { PublicationType } from "@socialup/shared";

type GraphRequestOptions = {
  method?: "GET" | "POST";
  accessToken?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: Record<string, string | number | boolean | null | undefined>;
};

type FacebookOAuthTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type FacebookPageAccount = {
  id?: string | null;
  name?: string | null;
  location?: {
    city?: string | null;
    country?: string | null;
    street?: string | null;
    zip?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  instagram_business_account?: {
    id?: string | null;
    username?: string | null;
  } | null;
};

type FacebookMeAccountsResponse = {
  data?: FacebookPageAccount[];
};

type MediaContainerResponse = {
  id?: string;
};

type MediaPublishResponse = {
  id?: string;
};

type MediaContainerStatusResponse = {
  status?: string | null;
  status_code?: string | null;
};

type FacebookPageSearchResult = {
  id?: string | null;
  name?: string | null;
  location?: Record<string, unknown> | null;
};

type FacebookPageSearchResponse = {
  data?: FacebookPageSearchResult[];
};

type OAuthStateEntry = {
  connectionId: string;
  createdAtMs: number;
};

type InstagramAccountCandidate = {
  instagramUserId: string;
  instagramUsername: string | null;
};

export type InstagramLocationSuggestion = {
  id: string;
  name: string;
};

export type InstagramLocationCandidate = {
  pageId: string;
  pageName: string;
  hasLocationData: boolean;
  city: string | null;
  country: string | null;
  street: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
};

const INSTAGRAM_GRAPH_API_VERSION = (process.env.INSTAGRAM_GRAPH_API_VERSION || "v24.0").trim();
const INSTAGRAM_GRAPH_APP_ID = (process.env.INSTAGRAM_GRAPH_APP_ID || "").trim();
const INSTAGRAM_GRAPH_APP_SECRET = (process.env.INSTAGRAM_GRAPH_APP_SECRET || "").trim();
const INSTAGRAM_GRAPH_REDIRECT_URI = (process.env.INSTAGRAM_GRAPH_REDIRECT_URI || "").trim();
const INSTAGRAM_GRAPH_SCOPES = (
  process.env.INSTAGRAM_GRAPH_SCOPES ||
  "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management"
)
  .split(",")
  .map((scope) => scope.trim())
  .filter((scope) => scope.length > 0);
const INSTAGRAM_GRAPH_TIMEOUT_MS = parsePositiveInt(process.env.INSTAGRAM_GRAPH_TIMEOUT_MS, 45_000);
const INSTAGRAM_OAUTH_STATE_TTL_MS = parsePositiveInt(process.env.INSTAGRAM_OAUTH_STATE_TTL_MS, 15 * 60 * 1000);
const INSTAGRAM_MEDIA_POLL_INTERVAL_MS = parsePositiveInt(process.env.INSTAGRAM_MEDIA_POLL_INTERVAL_MS, 2_500);
const INSTAGRAM_MEDIA_POLL_TIMEOUT_MS = parsePositiveInt(process.env.INSTAGRAM_MEDIA_POLL_TIMEOUT_MS, 3 * 60 * 1000);
const INSTAGRAM_MEDIA_PUBLISH_RETRY_DELAY_MS = parsePositiveInt(
  process.env.INSTAGRAM_MEDIA_PUBLISH_RETRY_DELAY_MS,
  2_500,
);
const INSTAGRAM_MEDIA_PUBLISH_RETRY_ATTEMPTS = parsePositiveInt(
  process.env.INSTAGRAM_MEDIA_PUBLISH_RETRY_ATTEMPTS,
  8,
);
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${INSTAGRAM_GRAPH_API_VERSION}`;
const FACEBOOK_OAUTH_BASE_URL = `https://www.facebook.com/${INSTAGRAM_GRAPH_API_VERSION}`;

const oauthStateByToken = new Map<string, OAuthStateEntry>();
let cachedAppAccessToken: { token: string; expiresAtMs: number | null } | null = null;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function cleanupExpiredOAuthStateEntries(nowMs: number): void {
  for (const [token, entry] of oauthStateByToken.entries()) {
    if (nowMs - entry.createdAtMs > INSTAGRAM_OAUTH_STATE_TTL_MS) {
      oauthStateByToken.delete(token);
    }
  }
}

function missingInstagramOAuthConfigKeys(): string[] {
  const missing: string[] = [];
  if (!INSTAGRAM_GRAPH_APP_ID) {
    missing.push("INSTAGRAM_GRAPH_APP_ID");
  }
  if (!INSTAGRAM_GRAPH_APP_SECRET) {
    missing.push("INSTAGRAM_GRAPH_APP_SECRET");
  }
  if (!INSTAGRAM_GRAPH_REDIRECT_URI) {
    missing.push("INSTAGRAM_GRAPH_REDIRECT_URI");
  }
  if (INSTAGRAM_GRAPH_SCOPES.length === 0) {
    missing.push("INSTAGRAM_GRAPH_SCOPES");
  }
  return missing;
}

function ensureInstagramOAuthConfigured(): void {
  const missing = missingInstagramOAuthConfigKeys();
  if (missing.length > 0) {
    throw new Error(`INSTAGRAM_GRAPH_CONFIG_MISSING:${missing.join(",")}`);
  }
}

async function getInstagramGraphAppAccessToken(): Promise<string> {
  const nowMs = Date.now();
  if (cachedAppAccessToken?.token) {
    const { token, expiresAtMs } = cachedAppAccessToken;
    if (!expiresAtMs || nowMs < expiresAtMs - 60_000) {
      return token;
    }
  }

  ensureInstagramOAuthConfigured();

  const appTokenResponse = await graphRequest<FacebookOAuthTokenResponse>("/oauth/access_token", {
    query: {
      client_id: INSTAGRAM_GRAPH_APP_ID,
      client_secret: INSTAGRAM_GRAPH_APP_SECRET,
      grant_type: "client_credentials",
    },
  });

  const token = appTokenResponse.access_token?.trim() || "";
  if (!token) {
    throw new Error("INSTAGRAM_GRAPH_APP_TOKEN_MISSING");
  }

  const expiresInSeconds =
    typeof appTokenResponse.expires_in === "number" && appTokenResponse.expires_in > 0
      ? appTokenResponse.expires_in
      : null;
  cachedAppAccessToken = {
    token,
    expiresAtMs: expiresInSeconds ? nowMs + expiresInSeconds * 1000 : null,
  };

  return token;
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

function graphErrorMessageFromPayload(payload: unknown): string {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    const errorMessage = errorRecord.message;
    if (typeof errorMessage === "string" && errorMessage.trim().length > 0) {
      return errorMessage.trim();
    }
    const errorType = errorRecord.type;
    if (typeof errorType === "string" && errorType.trim().length > 0) {
      return errorType.trim();
    }
  }

  const directMessage = record.message;
  if (typeof directMessage === "string" && directMessage.trim().length > 0) {
    return directMessage.trim();
  }

  return "";
}

function graphErrorCodeFromPayload(payload: unknown): number | null {
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

function isGraphAuthFailure(status: number, payload: unknown): boolean {
  const graphCode = graphErrorCodeFromPayload(payload);
  if (graphCode === 190 || graphCode === 102) {
    return true;
  }

  if (status === 401) {
    return true;
  }

  return false;
}

function appendParams(
  target: URLSearchParams,
  input?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!input) {
    return;
  }

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    target.set(key, String(value));
  }
}

async function graphRequest<T>(path: string, options: GraphRequestOptions = {}): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${GRAPH_API_BASE_URL}${normalizedPath}`);
  const query = new URLSearchParams();
  appendParams(query, options.query);

  if (options.accessToken) {
    query.set("access_token", options.accessToken);
  }

  if (options.method === "POST") {
    const formBody = new URLSearchParams();
    appendParams(formBody, options.query);
    if (options.accessToken) {
      formBody.set("access_token", options.accessToken);
    }
    appendParams(formBody, options.body);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(INSTAGRAM_GRAPH_TIMEOUT_MS),
    });
    const payload = await parseResponsePayload(response);
    if (!response.ok) {
      if (isGraphAuthFailure(response.status, payload)) {
        throw new Error("LOGIN_REQUIRED_INSTAGRAM");
      }
      const detail = graphErrorMessageFromPayload(payload);
      throw new Error(`INSTAGRAM_GRAPH_API_HTTP_${response.status}:${normalizedPath}${detail ? `:${detail}` : ""}`);
    }
    return payload as T;
  }

  if (query.size > 0) {
    url.search = query.toString();
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(INSTAGRAM_GRAPH_TIMEOUT_MS),
  });
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    if (isGraphAuthFailure(response.status, payload)) {
      throw new Error("LOGIN_REQUIRED_INSTAGRAM");
    }
    const detail = graphErrorMessageFromPayload(payload);
    throw new Error(`INSTAGRAM_GRAPH_API_HTTP_${response.status}:${normalizedPath}${detail ? `:${detail}` : ""}`);
  }
  return payload as T;
}

function selectInstagramAccount(
  accounts: InstagramAccountCandidate[],
  preferredIdentifier: string | null | undefined,
): InstagramAccountCandidate {
  const preferred = preferredIdentifier?.trim();
  if (preferred) {
    const lowerPreferred = preferred.toLowerCase();
    const byIdentifier = accounts.find(
      (account) =>
        account.instagramUserId === preferred || (account.instagramUsername?.toLowerCase() ?? "") === lowerPreferred,
    );
    if (!byIdentifier) {
      throw new Error("INSTAGRAM_GRAPH_ACCOUNT_NOT_FOUND");
    }
    return byIdentifier;
  }

  if (accounts.length === 1) {
    return accounts[0]!;
  }

  throw new Error("INSTAGRAM_GRAPH_MULTIPLE_ACCOUNTS_REQUIRE_IDENTIFIER");
}

function inferMediaKind(mediaUrl: string): "image" | "video" {
  let pathname = mediaUrl;
  try {
    pathname = new URL(mediaUrl).pathname;
  } catch {
    pathname = mediaUrl;
  }

  const normalized = pathname.toLowerCase();
  if (/\.(jpg|jpeg|png)$/.test(normalized)) {
    return "image";
  }
  if (/\.(mp4|mov|m4v|webm)$/.test(normalized)) {
    return "video";
  }

  throw new Error("INSTAGRAM_GRAPH_MEDIA_FORMAT_UNSUPPORTED");
}

function normalizeLooseTextMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeLocationSuggestions(
  response: FacebookPageSearchResponse,
  limit: number,
): InstagramLocationSuggestion[] {
  const dedupe = new Set<string>();
  const output: InstagramLocationSuggestion[] = [];

  for (const entry of response.data ?? []) {
    const id = entry.id?.trim() || "";
    const name = entry.name?.trim() || "";
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

async function searchInstagramLocationSuggestions(
  query: string,
  accessToken: string,
  limit: number,
): Promise<InstagramLocationSuggestion[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    return [];
  }

  const errors: string[] = [];

  try {
    const pageSearch = await graphRequest<FacebookPageSearchResponse>("/pages/search", {
      accessToken,
      query: {
        q: normalizedQuery,
        fields: "id,name,location",
        limit,
      },
    });
    const suggestions = normalizeLocationSuggestions(pageSearch, limit);
    if (suggestions.length > 0) {
      return suggestions;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "LOGIN_REQUIRED_INSTAGRAM") {
      throw error;
    }
    if (error instanceof Error && error.message) {
      errors.push(error.message);
    }
  }

  try {
    const genericSearch = await graphRequest<FacebookPageSearchResponse>("/search", {
      accessToken,
      query: {
        type: "page",
        q: normalizedQuery,
        fields: "id,name,location",
        limit,
      },
    });
    const suggestions = normalizeLocationSuggestions(genericSearch, limit);
    if (suggestions.length > 0) {
      return suggestions;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "LOGIN_REQUIRED_INSTAGRAM") {
      throw error;
    }
    if (error instanceof Error && error.message) {
      errors.push(error.message);
    }
  }

  if (errors.length > 0) {
    throw new Error(`INSTAGRAM_GRAPH_LOCATION_SEARCH_FAILED:${normalizedQuery}:${errors.join(" | ")}`);
  }

  return [];
}

async function resolveInstagramLocationId(locationName: string, accessToken: string): Promise<string> {
  const normalized = locationName.trim();
  if (!normalized) {
    throw new Error("INSTAGRAM_GRAPH_LOCATION_REQUIRED");
  }

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  const candidates = await searchInstagramLocationSuggestions(normalized, accessToken, 25);

  if (candidates.length === 0) {
    throw new Error(`INSTAGRAM_GRAPH_LOCATION_NOT_FOUND:${normalized}`);
  }

  const needle = normalizeLooseTextMatch(normalized);
  const exactMatch = candidates.find((entry) => normalizeLooseTextMatch(entry.name) === needle);
  return (exactMatch ?? candidates[0]!).id;
}

export async function searchInstagramLocationsForConnection(input: {
  secretCipher: string | null;
  query: string;
  limit?: number;
}): Promise<InstagramLocationSuggestion[]> {
  const accessToken = decodeSecret(input.secretCipher);
  const limit = Math.max(1, Math.min(25, input.limit ?? 8));
  const normalizedQuery = input.query.trim();

  if (accessToken) {
    try {
      return await searchInstagramLocationSuggestions(normalizedQuery, accessToken, limit);
    } catch {
      // If user token search fails (permissions/session/capability), fallback to app token.
    }
  }

  const appAccessToken = await getInstagramGraphAppAccessToken();
  return searchInstagramLocationSuggestions(normalizedQuery, appAccessToken, limit);
}

export async function listInstagramLocationCandidatesForConnection(input: {
  secretCipher: string | null;
  limit?: number;
}): Promise<InstagramLocationCandidate[]> {
  const accessToken = decodeSecret(input.secretCipher);
  if (!accessToken) {
    throw new Error("LOGIN_REQUIRED_INSTAGRAM");
  }

  const limit = Math.max(1, Math.min(200, input.limit ?? 200));
  const meAccounts = await graphRequest<FacebookMeAccountsResponse>("/me/accounts", {
    accessToken,
    query: {
      fields: "id,name,location,instagram_business_account{id,username}",
      limit,
    },
  });

  const candidates: InstagramLocationCandidate[] = [];
  const dedupe = new Set<string>();

  for (const account of meAccounts.data ?? []) {
    const pageId = account.id?.trim() || "";
    const pageName = account.name?.trim() || "";
    if (!pageId || !pageName || dedupe.has(pageId)) {
      continue;
    }
    dedupe.add(pageId);

    const location = account.location ?? null;
    const city = location?.city?.trim() || null;
    const country = location?.country?.trim() || null;
    const street = location?.street?.trim() || null;
    const zip = location?.zip?.trim() || null;
    const latitude = typeof location?.latitude === "number" ? location.latitude : null;
    const longitude = typeof location?.longitude === "number" ? location.longitude : null;
    const hasMeaningfulCoordinates =
      latitude !== null &&
      longitude !== null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      !(latitude === 0 && longitude === 0);
    const hasLocationData = !!(city || country || street || zip || hasMeaningfulCoordinates);

    candidates.push({
      pageId,
      pageName,
      hasLocationData,
      city,
      country,
      street,
      zip,
      latitude,
      longitude,
    });
  }

  return candidates.sort((left, right) => {
    if (left.hasLocationData === right.hasLocationData) {
      return left.pageName.localeCompare(right.pageName, "pt-BR", { sensitivity: "base" });
    }
    return left.hasLocationData ? -1 : 1;
  });
}

function buildMediaContainerPayload(input: {
  publicationType: PublicationType;
  mediaUrl: string;
  mediaKind: "image" | "video";
  caption: string | null;
  locationId?: string | null;
}): Record<string, string | number | boolean> {
  if (input.publicationType === "instagram_post") {
    if (input.mediaKind !== "image") {
      throw new Error("INSTAGRAM_GRAPH_POST_IMAGE_REQUIRED");
    }

    const payload: Record<string, string | number | boolean> = {
      image_url: input.mediaUrl,
      caption: input.caption ?? "",
    };
    if (input.locationId?.trim()) {
      payload.location_id = input.locationId.trim();
    }
    return payload;
  }

  if (input.publicationType === "instagram_reel") {
    if (input.mediaKind !== "video") {
      throw new Error("INSTAGRAM_GRAPH_REEL_VIDEO_REQUIRED");
    }

    const payload: Record<string, string | number | boolean> = {
      media_type: "REELS",
      video_url: input.mediaUrl,
      caption: input.caption ?? "",
      share_to_feed: true,
    };
    if (input.locationId?.trim()) {
      payload.location_id = input.locationId.trim();
    }
    return payload;
  }

  if (input.publicationType === "instagram_story") {
    if (input.mediaKind === "video") {
      return {
        media_type: "STORIES",
        video_url: input.mediaUrl,
      };
    }

    return {
      media_type: "STORIES",
      image_url: input.mediaUrl,
    };
  }

  throw new Error(`INSTAGRAM_GRAPH_PUBLICATION_TYPE_UNSUPPORTED:${input.publicationType}`);
}

async function waitForMediaContainerReady(creationId: string, accessToken: string): Promise<void> {
  const deadline = Date.now() + INSTAGRAM_MEDIA_POLL_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    const status = await graphRequest<MediaContainerStatusResponse>(`/${creationId}`, {
      accessToken,
      query: {
        fields: "status,status_code",
      },
    });
    const statusCode = (status.status_code || status.status || "").toUpperCase();

    if (statusCode === "FINISHED" || statusCode === "PUBLISHED") {
      return;
    }

    if (statusCode === "ERROR" || statusCode === "EXPIRED" || statusCode === "FAILED") {
      throw new Error(`INSTAGRAM_GRAPH_MEDIA_PROCESSING_${statusCode}`);
    }

    await new Promise((resolve) => setTimeout(resolve, INSTAGRAM_MEDIA_POLL_INTERVAL_MS));
  }

  throw new Error("INSTAGRAM_GRAPH_MEDIA_PROCESSING_TIMEOUT");
}

async function publishMediaContainerWithRetry(input: {
  instagramUserId: string;
  accessToken: string;
  creationId: string;
}): Promise<MediaPublishResponse> {
  for (let attempt = 1; attempt <= INSTAGRAM_MEDIA_PUBLISH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await graphRequest<MediaPublishResponse>(`/${input.instagramUserId}/media_publish`, {
        method: "POST",
        accessToken: input.accessToken,
        body: {
          creation_id: input.creationId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const isRetryable = message.includes("Media ID is not available");
      const isLastAttempt = attempt >= INSTAGRAM_MEDIA_PUBLISH_RETRY_ATTEMPTS;

      if (!isRetryable || isLastAttempt) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, INSTAGRAM_MEDIA_PUBLISH_RETRY_DELAY_MS));
    }
  }

  throw new Error("INSTAGRAM_GRAPH_MEDIA_PUBLISH_RETRY_EXHAUSTED");
}

export function createInstagramOAuthLaunchUrl(connectionId: string): string {
  ensureInstagramOAuthConfigured();
  const nowMs = Date.now();
  cleanupExpiredOAuthStateEntries(nowMs);

  const stateToken = randomBytes(18).toString("hex");
  oauthStateByToken.set(stateToken, {
    connectionId,
    createdAtMs: nowMs,
  });

  const query = new URLSearchParams({
    client_id: INSTAGRAM_GRAPH_APP_ID,
    redirect_uri: INSTAGRAM_GRAPH_REDIRECT_URI,
    response_type: "code",
    scope: INSTAGRAM_GRAPH_SCOPES.join(","),
    state: stateToken,
  });

  return `${FACEBOOK_OAUTH_BASE_URL}/dialog/oauth?${query.toString()}`;
}

export function consumeInstagramOAuthState(stateToken: string): { connectionId: string } | null {
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
  };
}

export async function exchangeInstagramOAuthCodeForConnection(input: {
  authorizationCode: string;
  preferredInstagramIdentifier?: string | null;
}): Promise<{
  accessToken: string;
  tokenExpiresInSeconds: number | null;
  instagramUserId: string;
  instagramUsername: string | null;
}> {
  ensureInstagramOAuthConfigured();

  const authCode = input.authorizationCode.trim();
  if (!authCode) {
    throw new Error("INSTAGRAM_GRAPH_OAUTH_CODE_MISSING");
  }

  const shortToken = await graphRequest<FacebookOAuthTokenResponse>("/oauth/access_token", {
    query: {
      client_id: INSTAGRAM_GRAPH_APP_ID,
      client_secret: INSTAGRAM_GRAPH_APP_SECRET,
      redirect_uri: INSTAGRAM_GRAPH_REDIRECT_URI,
      code: authCode,
    },
  });

  const shortLivedToken = shortToken.access_token?.trim() || "";
  if (!shortLivedToken) {
    throw new Error("INSTAGRAM_GRAPH_OAUTH_SHORT_TOKEN_MISSING");
  }

  let effectiveToken = shortLivedToken;
  let effectiveExpiresIn = typeof shortToken.expires_in === "number" ? shortToken.expires_in : null;

  try {
    const longToken = await graphRequest<FacebookOAuthTokenResponse>("/oauth/access_token", {
      query: {
        grant_type: "fb_exchange_token",
        client_id: INSTAGRAM_GRAPH_APP_ID,
        client_secret: INSTAGRAM_GRAPH_APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
    });

    if (longToken.access_token?.trim()) {
      effectiveToken = longToken.access_token.trim();
      effectiveExpiresIn = typeof longToken.expires_in === "number" ? longToken.expires_in : effectiveExpiresIn;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "LOGIN_REQUIRED_INSTAGRAM") {
      throw error;
    }
  }

  const meAccounts = await graphRequest<FacebookMeAccountsResponse>("/me/accounts", {
    accessToken: effectiveToken,
    query: {
      fields: "instagram_business_account{id,username}",
      limit: 200,
    },
  });

  const candidates: InstagramAccountCandidate[] = [];
  const dedupe = new Set<string>();

  for (const account of meAccounts.data ?? []) {
    const instagramAccount = account.instagram_business_account;
    const instagramUserId = instagramAccount?.id?.trim() ?? "";
    if (!instagramUserId || dedupe.has(instagramUserId)) {
      continue;
    }
    dedupe.add(instagramUserId);
    candidates.push({
      instagramUserId,
      instagramUsername: instagramAccount?.username?.trim() || null,
    });
  }

  if (candidates.length === 0) {
    throw new Error("INSTAGRAM_GRAPH_NO_BUSINESS_ACCOUNT_LINKED");
  }

  const selected = selectInstagramAccount(candidates, input.preferredInstagramIdentifier);

  return {
    accessToken: effectiveToken,
    tokenExpiresInSeconds: effectiveExpiresIn,
    instagramUserId: selected.instagramUserId,
    instagramUsername: selected.instagramUsername,
  };
}

export async function executeInstagramJobWithGraphApi(
  connection: {
    id: string;
    loginIdentifier: string | null;
    secretCipher: string | null;
  },
  job: {
    id: string;
    publicationType: PublicationType;
    caption?: string | null;
    locationName?: string | null;
    locationId?: string | null;
  },
  mediaUrl: string,
): Promise<{
  creationId: string;
  publishedMediaId: string;
}> {
  const accessToken = decodeSecret(connection.secretCipher);
  if (!accessToken) {
    throw new Error("LOGIN_REQUIRED_INSTAGRAM");
  }

  const instagramUserId = connection.loginIdentifier?.trim() || "";
  if (!instagramUserId || !/^\d+$/.test(instagramUserId)) {
    throw new Error("LOGIN_REQUIRED_INSTAGRAM");
  }

  const normalizedMediaUrl = mediaUrl.trim();
  if (!/^https?:\/\//i.test(normalizedMediaUrl)) {
    throw new Error("INSTAGRAM_GRAPH_MEDIA_URL_INVALID");
  }

  const mediaKind = inferMediaKind(normalizedMediaUrl);
  let locationId: string | null = null;
  if (job.publicationType === "instagram_post" || job.publicationType === "instagram_reel") {
    const directLocationId = job.locationId?.trim() || "";
    if (directLocationId && /^\d+$/.test(directLocationId)) {
      locationId = directLocationId;
    } else if (directLocationId) {
      throw new Error("INSTAGRAM_GRAPH_LOCATION_ID_INVALID");
    }

    const locationName = job.locationName?.trim() || "";
    if (!locationId && locationName) {
      try {
        locationId = await resolveInstagramLocationId(locationName, accessToken);
      } catch (error) {
        // Location is optional for publish. If resolution fails, continue without location_id.
        locationId = null;
      }
    }
  }

  const payload = buildMediaContainerPayload({
    publicationType: job.publicationType,
    mediaUrl: normalizedMediaUrl,
    mediaKind,
    caption: job.caption?.trim() || null,
    locationId,
  });

  let created: MediaContainerResponse;
  try {
    created = await graphRequest<MediaContainerResponse>(`/${instagramUserId}/media`, {
      method: "POST",
      accessToken,
      body: payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const locationPayloadError =
      Boolean(locationId) &&
      (message.toLowerCase().includes("location_id") || message.toLowerCase().includes("location"));
    if (locationPayloadError) {
      const retryPayloadWithoutLocation = buildMediaContainerPayload({
        publicationType: job.publicationType,
        mediaUrl: normalizedMediaUrl,
        mediaKind,
        caption: job.caption?.trim() || null,
        locationId: null,
      });
      created = await graphRequest<MediaContainerResponse>(`/${instagramUserId}/media`, {
        method: "POST",
        accessToken,
        body: retryPayloadWithoutLocation,
      });
    } else {
      if (message.includes("Only photo or video can be accepted as media type.")) {
        throw new Error(
          "INSTAGRAM_GRAPH_MEDIA_FETCH_INVALID_TYPE: a Meta não conseguiu ler a URL como imagem/vídeo. " +
            "Mantenha o túnel HTTPS ativo, confira INSTAGRAM_GRAPH_PUBLIC_BASE_URL e use imagem até 8 MB.",
        );
      }
      if (message.toLowerCase().includes("the aspect ratio is not supported")) {
        if (job.publicationType === "instagram_post") {
          throw new Error(
            "INSTAGRAM_GRAPH_MEDIA_ASPECT_RATIO_NOT_SUPPORTED: proporcao invalida para Instagram Post. " +
              "Use imagem entre 4:5 (0.80) e 1.91:1.",
          );
        }
        if (job.publicationType === "instagram_story") {
          throw new Error(
            "INSTAGRAM_GRAPH_MEDIA_ASPECT_RATIO_NOT_SUPPORTED: proporcao invalida para Instagram Story. " +
              "Use preferencialmente 9:16.",
          );
        }
        if (job.publicationType === "instagram_reel") {
          throw new Error(
            "INSTAGRAM_GRAPH_MEDIA_ASPECT_RATIO_NOT_SUPPORTED: proporcao invalida para Instagram Reel. " +
              "Use video em 9:16.",
          );
        }
      }
      throw error;
    }
  }

  const creationId = created.id?.trim() || "";
  if (!creationId) {
    throw new Error("INSTAGRAM_GRAPH_CONTAINER_ID_MISSING");
  }

  if (job.publicationType === "instagram_reel" || (job.publicationType === "instagram_story" && mediaKind === "video")) {
    await waitForMediaContainerReady(creationId, accessToken);
  }

  const published = await publishMediaContainerWithRetry({
    instagramUserId,
    accessToken,
    creationId,
  });

  const publishedMediaId = published.id?.trim() || "";
  if (!publishedMediaId) {
    throw new Error("INSTAGRAM_GRAPH_PUBLISH_ID_MISSING");
  }

  return {
    creationId,
    publishedMediaId,
  };
}
