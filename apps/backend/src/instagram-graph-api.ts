import { randomBytes } from "node:crypto";
import type { PublicationType } from "@socialup/shared";

type GraphRequestOptions = {
  method?: "GET" | "POST";
  accessToken?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: Record<string, string | number | boolean | null | undefined>;
  baseUrl?: string;
};

type FacebookOAuthTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  user_id?: string | number;
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
  returnToUrl: string | null;
};

type InstagramAccountCandidate = {
  instagramUserId: string;
  instagramUsername: string | null;
};

type InstagramAccessTokenRefreshResult = {
  accessToken: string;
  tokenExpiresInSeconds: number | null;
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
const INSTAGRAM_OAUTH_APP_ID = (process.env.INSTAGRAM_OAUTH_APP_ID || INSTAGRAM_GRAPH_APP_ID).trim();
const INSTAGRAM_OAUTH_APP_SECRET = (process.env.INSTAGRAM_OAUTH_APP_SECRET || INSTAGRAM_GRAPH_APP_SECRET).trim();
const INSTAGRAM_OAUTH_REDIRECT_URI = (process.env.INSTAGRAM_OAUTH_REDIRECT_URI || INSTAGRAM_GRAPH_REDIRECT_URI).trim();
const INSTAGRAM_OAUTH_FLOW = (process.env.INSTAGRAM_OAUTH_FLOW || "instagram_login").trim().toLowerCase();
const INSTAGRAM_DEFAULT_SCOPES =
  INSTAGRAM_OAUTH_FLOW === "facebook_login"
    ? "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management"
    : "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights";
const INSTAGRAM_GRAPH_SCOPES = (
  process.env.INSTAGRAM_GRAPH_SCOPES || INSTAGRAM_DEFAULT_SCOPES
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
const INSTAGRAM_MEDIA_PUBLISH_THROTTLE_RETRY_DELAY_MS = parsePositiveInt(
  process.env.INSTAGRAM_MEDIA_PUBLISH_THROTTLE_RETRY_DELAY_MS,
  15_000,
);
const INSTAGRAM_MEDIA_PUBLISH_RETRY_ATTEMPTS = parsePositiveInt(
  process.env.INSTAGRAM_MEDIA_PUBLISH_RETRY_ATTEMPTS,
  8,
);
const INSTAGRAM_MEDIA_PUBLISH_RETRY_MAX_TOTAL_MS = parsePositiveInt(
  process.env.INSTAGRAM_MEDIA_PUBLISH_RETRY_MAX_TOTAL_MS,
  60_000,
);
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${INSTAGRAM_GRAPH_API_VERSION}`;
const INSTAGRAM_CONTENT_GRAPH_BASE_URL = (
  process.env.INSTAGRAM_CONTENT_GRAPH_BASE_URL ||
  (INSTAGRAM_OAUTH_FLOW === "facebook_login"
    ? `https://graph.facebook.com/${INSTAGRAM_GRAPH_API_VERSION}`
    : `https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}`)
)
  .trim()
  .replace(/\/+$/, "");
const FACEBOOK_OAUTH_BASE_URL = `https://www.facebook.com/${INSTAGRAM_GRAPH_API_VERSION}`;
const INSTAGRAM_OAUTH_AUTHORIZE_URL = (
  process.env.INSTAGRAM_OAUTH_AUTHORIZE_URL ||
  (INSTAGRAM_OAUTH_FLOW === "facebook_login"
    ? `${FACEBOOK_OAUTH_BASE_URL}/dialog/oauth`
    : "https://www.instagram.com/oauth/authorize")
).trim();

const oauthStateByToken = new Map<string, OAuthStateEntry>();
let cachedAppAccessToken: { token: string; expiresAtMs: number | null } | null = null;

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
    const decoded = Buffer.from(secretCipher, "base64").toString("utf8").trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function isInstagramTooManyActionsErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized.includes("user is performing too many actions") || normalized.includes("too many actions");
}

function isInstagramRefreshTooEarlyErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("not been at least 24 hours") ||
    normalized.includes("has not been 24 hours") ||
    normalized.includes("can only be refreshed after 24 hours") ||
    normalized.includes("token must be at least 24 hours old") ||
    normalized.includes("cannot be refreshed yet")
  );
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
  if (!INSTAGRAM_OAUTH_APP_ID) {
    missing.push("INSTAGRAM_OAUTH_APP_ID (ou INSTAGRAM_GRAPH_APP_ID)");
  }
  if (!INSTAGRAM_OAUTH_APP_SECRET) {
    missing.push("INSTAGRAM_OAUTH_APP_SECRET (ou INSTAGRAM_GRAPH_APP_SECRET)");
  }
  if (!INSTAGRAM_OAUTH_REDIRECT_URI) {
    missing.push("INSTAGRAM_OAUTH_REDIRECT_URI (ou INSTAGRAM_GRAPH_REDIRECT_URI)");
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
  const appClientId = INSTAGRAM_GRAPH_APP_ID || INSTAGRAM_OAUTH_APP_ID;
  const appClientSecret = INSTAGRAM_GRAPH_APP_SECRET || INSTAGRAM_OAUTH_APP_SECRET;
  if (!appClientId || !appClientSecret) {
    throw new Error("INSTAGRAM_GRAPH_CONFIG_MISSING:INSTAGRAM_GRAPH_APP_ID,INSTAGRAM_GRAPH_APP_SECRET");
  }

  const appTokenResponse = await graphRequest<FacebookOAuthTokenResponse>("/oauth/access_token", {
    query: {
      client_id: appClientId,
      client_secret: appClientSecret,
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

export function isInstagramLoginRequiredErrorMessage(message: string): boolean {
  const normalized = message.trim();
  return normalized === "LOGIN_REQUIRED_INSTAGRAM" || normalized.startsWith("LOGIN_REQUIRED_INSTAGRAM:");
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

function parseIdLike(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return null;
}

async function graphRequest<T>(path: string, options: GraphRequestOptions = {}): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = (options.baseUrl || GRAPH_API_BASE_URL).trim().replace(/\/+$/, "");
  const url = new URL(`${baseUrl}${normalizedPath}`);
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
        const detail = graphErrorMessageFromPayload(payload);
        throw new Error(detail ? `LOGIN_REQUIRED_INSTAGRAM:${detail}` : "LOGIN_REQUIRED_INSTAGRAM");
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
      const detail = graphErrorMessageFromPayload(payload);
      throw new Error(detail ? `LOGIN_REQUIRED_INSTAGRAM:${detail}` : "LOGIN_REQUIRED_INSTAGRAM");
    }
    const detail = graphErrorMessageFromPayload(payload);
    throw new Error(`INSTAGRAM_GRAPH_API_HTTP_${response.status}:${normalizedPath}${detail ? `:${detail}` : ""}`);
  }
  return payload as T;
}

async function instagramOauthTokenRequest(code: string): Promise<FacebookOAuthTokenResponse> {
  const formBody = new URLSearchParams({
    client_id: INSTAGRAM_OAUTH_APP_ID,
    client_secret: INSTAGRAM_OAUTH_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: INSTAGRAM_OAUTH_REDIRECT_URI,
    code,
  });

  const response = await fetch("https://api.instagram.com/oauth/access_token", {
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
      const detail = graphErrorMessageFromPayload(payload);
      throw new Error(detail ? `LOGIN_REQUIRED_INSTAGRAM:${detail}` : "LOGIN_REQUIRED_INSTAGRAM");
    }
    const detail = graphErrorMessageFromPayload(payload);
    throw new Error(`INSTAGRAM_GRAPH_API_HTTP_${response.status}:/oauth/access_token${detail ? `:${detail}` : ""}`);
  }

  return payload as FacebookOAuthTokenResponse;
}

async function instagramExchangeLongLivedToken(shortLivedToken: string): Promise<FacebookOAuthTokenResponse> {
  return graphRequest<FacebookOAuthTokenResponse>("/access_token", {
    baseUrl: "https://graph.instagram.com",
    query: {
      grant_type: "ig_exchange_token",
      client_secret: INSTAGRAM_OAUTH_APP_SECRET,
      access_token: shortLivedToken,
    },
  });
}

async function instagramMeRequest(accessToken: string): Promise<InstagramAccountCandidate | null> {
  const url = new URL(`https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}/me`);
  url.searchParams.set("fields", "user_id,username,id");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(INSTAGRAM_GRAPH_TIMEOUT_MS),
  });
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    if (isGraphAuthFailure(response.status, payload)) {
      const detail = graphErrorMessageFromPayload(payload);
      throw new Error(detail ? `LOGIN_REQUIRED_INSTAGRAM:${detail}` : "LOGIN_REQUIRED_INSTAGRAM");
    }
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const instagramUserId = parseIdLike(record.user_id) || parseIdLike(record.id);
  if (!instagramUserId) {
    return null;
  }

  const username = typeof record.username === "string" && record.username.trim().length > 0 ? record.username.trim() : null;
  return {
    instagramUserId,
    instagramUsername: username,
  };
}

export async function resolveInstagramConnectionRuntimeMetadata(input: {
  loginIdentifier: string | null;
  secretCipher: string | null;
}): Promise<{ instagramUserId: string | null; instagramUsername: string | null }> {
  const fallbackUserIdRaw = input.loginIdentifier?.trim() || "";
  const fallbackUserId = /^\d+$/.test(fallbackUserIdRaw) ? fallbackUserIdRaw : null;
  const fallback = {
    instagramUserId: fallbackUserId,
    instagramUsername: null,
  };

  const accessToken = decodeSecret(input.secretCipher)?.trim() || "";
  if (!accessToken) {
    return fallback;
  }

  try {
    const me = await instagramMeRequest(accessToken);
    if (!me) {
      return fallback;
    }
    return {
      instagramUserId: me.instagramUserId,
      instagramUsername: me.instagramUsername,
    };
  } catch {
    return fallback;
  }
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

function extractFacebookPageLocation(account: FacebookPageAccount): {
  city: string | null;
  country: string | null;
  street: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  hasLocationData: boolean;
} {
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

  return {
    city,
    country,
    street,
    zip,
    latitude,
    longitude,
    hasLocationData,
  };
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
    if (error instanceof Error && isInstagramLoginRequiredErrorMessage(error.message)) {
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
    if (error instanceof Error && isInstagramLoginRequiredErrorMessage(error.message)) {
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
    const { city, country, street, zip, latitude, longitude, hasLocationData } = extractFacebookPageLocation(account);

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

async function resolveInstagramLocationIdFromLinkedPage(input: {
  accessToken: string;
  instagramUserId: string;
}): Promise<string | null> {
  const meAccounts = await graphRequest<FacebookMeAccountsResponse>("/me/accounts", {
    accessToken: input.accessToken,
    query: {
      fields: "id,name,location,instagram_business_account{id,username}",
      limit: 200,
    },
  });

  const normalizedInstagramUserId = input.instagramUserId.trim();
  if (!normalizedInstagramUserId) {
    return null;
  }

  const linkedPages = (meAccounts.data ?? [])
    .map((account) => {
      const pageId = account.id?.trim() || "";
      const linkedInstagramUserId = account.instagram_business_account?.id?.trim() || "";
      const { hasLocationData } = extractFacebookPageLocation(account);
      return {
        pageId,
        linkedInstagramUserId,
        hasLocationData,
      };
    })
    .filter((entry) => entry.pageId.length > 0);

  const linkedPageWithLocation = linkedPages.find(
    (entry) => entry.linkedInstagramUserId === normalizedInstagramUserId && entry.hasLocationData,
  );
  if (linkedPageWithLocation) {
    return linkedPageWithLocation.pageId;
  }

  const fallbackPageWithLocation = linkedPages.find((entry) => entry.hasLocationData);
  return fallbackPageWithLocation?.pageId ?? null;
}

function buildMediaContainerPayload(input: {
  publicationType: PublicationType;
  mediaUrl: string;
  mediaKind: "image" | "video";
  caption: string | null;
  altText?: string | null;
  locationId?: string | null;
}): Record<string, string | number | boolean> {
  const normalizedAltText = input.altText?.trim() || "";

  if (input.publicationType === "instagram_post") {
    if (input.mediaKind !== "image") {
      throw new Error("INSTAGRAM_GRAPH_POST_IMAGE_REQUIRED");
    }

    const payload: Record<string, string | number | boolean> = {
      image_url: input.mediaUrl,
      caption: input.caption ?? "",
    };
    if (normalizedAltText) {
      payload.alt_text = normalizedAltText.slice(0, 1000);
    }
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
      baseUrl: INSTAGRAM_CONTENT_GRAPH_BASE_URL,
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
  const startedAtMs = Date.now();
  for (let attempt = 1; attempt <= INSTAGRAM_MEDIA_PUBLISH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await graphRequest<MediaPublishResponse>(`/${input.instagramUserId}/media_publish`, {
        method: "POST",
        accessToken: input.accessToken,
        baseUrl: INSTAGRAM_CONTENT_GRAPH_BASE_URL,
        body: {
          creation_id: input.creationId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const normalizedMessage = message.toLowerCase();
      const isMediaIdUnavailable = normalizedMessage.includes("media id is not available");
      const isThrottled = isInstagramTooManyActionsErrorMessage(message);
      const isRetryable = isMediaIdUnavailable || isThrottled;
      const isLastAttempt = attempt >= INSTAGRAM_MEDIA_PUBLISH_RETRY_ATTEMPTS;

      if (!isRetryable || isLastAttempt) {
        throw error;
      }

      const delayMs = isThrottled
        ? Math.max(
            INSTAGRAM_MEDIA_PUBLISH_RETRY_DELAY_MS,
            INSTAGRAM_MEDIA_PUBLISH_THROTTLE_RETRY_DELAY_MS * Math.min(attempt, 4),
          )
        : INSTAGRAM_MEDIA_PUBLISH_RETRY_DELAY_MS;

      const elapsedMs = Date.now() - startedAtMs;
      if (elapsedMs + delayMs > INSTAGRAM_MEDIA_PUBLISH_RETRY_MAX_TOTAL_MS) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("INSTAGRAM_GRAPH_MEDIA_PUBLISH_RETRY_EXHAUSTED");
}

export function createInstagramOAuthLaunchUrl(
  connectionId: string,
  options?: {
    returnToUrl?: string | null;
  },
): string {
  ensureInstagramOAuthConfigured();
  const nowMs = Date.now();
  cleanupExpiredOAuthStateEntries(nowMs);

  const stateToken = randomBytes(18).toString("hex");
  oauthStateByToken.set(stateToken, {
    connectionId,
    createdAtMs: nowMs,
    returnToUrl: normalizeOAuthReturnToUrl(options?.returnToUrl),
  });

  const launchUrl = new URL(INSTAGRAM_OAUTH_AUTHORIZE_URL);
  launchUrl.searchParams.set("client_id", INSTAGRAM_OAUTH_APP_ID);
  launchUrl.searchParams.set("redirect_uri", INSTAGRAM_OAUTH_REDIRECT_URI);
  launchUrl.searchParams.set("response_type", "code");
  launchUrl.searchParams.set("scope", INSTAGRAM_GRAPH_SCOPES.join(","));
  launchUrl.searchParams.set("state", stateToken);
  if (INSTAGRAM_OAUTH_FLOW !== "facebook_login") {
    launchUrl.searchParams.set("force_reauth", "true");
  }

  return launchUrl.toString();
}

export function consumeInstagramOAuthState(stateToken: string): { connectionId: string; returnToUrl: string | null } | null {
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

  let shortToken: FacebookOAuthTokenResponse;
  if (INSTAGRAM_OAUTH_FLOW === "facebook_login") {
    shortToken = await graphRequest<FacebookOAuthTokenResponse>("/oauth/access_token", {
      query: {
        client_id: INSTAGRAM_OAUTH_APP_ID,
        client_secret: INSTAGRAM_OAUTH_APP_SECRET,
        redirect_uri: INSTAGRAM_OAUTH_REDIRECT_URI,
        code: authCode,
      },
    });
  } else {
    try {
      shortToken = await instagramOauthTokenRequest(authCode);
    } catch {
      shortToken = await graphRequest<FacebookOAuthTokenResponse>("/oauth/access_token", {
        query: {
          client_id: INSTAGRAM_OAUTH_APP_ID,
          client_secret: INSTAGRAM_OAUTH_APP_SECRET,
          redirect_uri: INSTAGRAM_OAUTH_REDIRECT_URI,
          code: authCode,
        },
      });
    }
  }

  const shortLivedToken = shortToken.access_token?.trim() || "";
  if (!shortLivedToken) {
    throw new Error("INSTAGRAM_GRAPH_OAUTH_SHORT_TOKEN_MISSING");
  }

  let effectiveToken = shortLivedToken;
  let effectiveExpiresIn = typeof shortToken.expires_in === "number" ? shortToken.expires_in : null;

  if (INSTAGRAM_OAUTH_FLOW === "facebook_login") {
    try {
      const longToken = await graphRequest<FacebookOAuthTokenResponse>("/oauth/access_token", {
        query: {
          grant_type: "fb_exchange_token",
          client_id: INSTAGRAM_OAUTH_APP_ID,
          client_secret: INSTAGRAM_OAUTH_APP_SECRET,
          fb_exchange_token: shortLivedToken,
        },
      });

      if (longToken.access_token?.trim()) {
        effectiveToken = longToken.access_token.trim();
        effectiveExpiresIn = typeof longToken.expires_in === "number" ? longToken.expires_in : effectiveExpiresIn;
      }
    } catch (error) {
      if (error instanceof Error && isInstagramLoginRequiredErrorMessage(error.message)) {
        throw error;
      }
    }
  } else {
    try {
      const longToken = await instagramExchangeLongLivedToken(shortLivedToken);
      if (longToken.access_token?.trim()) {
        effectiveToken = longToken.access_token.trim();
        effectiveExpiresIn = typeof longToken.expires_in === "number" ? longToken.expires_in : effectiveExpiresIn;
      }
    } catch {
      // Compat fallback: alguns apps antigos ainda aceitam o caminho de exchange via Graph/Facebook.
      try {
        const fallbackLongToken = await graphRequest<FacebookOAuthTokenResponse>("/oauth/access_token", {
          query: {
            grant_type: "fb_exchange_token",
            client_id: INSTAGRAM_OAUTH_APP_ID,
            client_secret: INSTAGRAM_OAUTH_APP_SECRET,
            fb_exchange_token: shortLivedToken,
          },
        });
        if (fallbackLongToken.access_token?.trim()) {
          effectiveToken = fallbackLongToken.access_token.trim();
          effectiveExpiresIn =
            typeof fallbackLongToken.expires_in === "number" ? fallbackLongToken.expires_in : effectiveExpiresIn;
        }
      } catch {
        // Se ambos falharem, mantém o token atual; o refresh worker tentará renovar novamente.
      }
    }
  }

  if (INSTAGRAM_OAUTH_FLOW !== "facebook_login" && effectiveToken === shortLivedToken) {
    throw new Error("INSTAGRAM_GRAPH_OAUTH_LONG_TOKEN_EXCHANGE_FAILED");
  }

  const candidates: InstagramAccountCandidate[] = [];
  const dedupe = new Set<string>();

  try {
    const meAccounts = await graphRequest<FacebookMeAccountsResponse>("/me/accounts", {
      accessToken: effectiveToken,
      query: {
        fields: "instagram_business_account{id,username}",
        limit: 200,
      },
    });

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
  } catch (error) {
    if (
      error instanceof Error &&
      isInstagramLoginRequiredErrorMessage(error.message) &&
      INSTAGRAM_OAUTH_FLOW === "facebook_login"
    ) {
      throw error;
    }
  }

  if (candidates.length === 0) {
    const directCandidate = await instagramMeRequest(effectiveToken);
    if (directCandidate && !dedupe.has(directCandidate.instagramUserId)) {
      candidates.push(directCandidate);
      dedupe.add(directCandidate.instagramUserId);
    }
  }

  if (candidates.length === 0) {
    const tokenUserId = parseIdLike(shortToken.user_id);
    if (tokenUserId && !dedupe.has(tokenUserId)) {
      candidates.push({
        instagramUserId: tokenUserId,
        instagramUsername: null,
      });
      dedupe.add(tokenUserId);
    }
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

export async function refreshInstagramAccessTokenForConnection(input: {
  secretCipher: string | null;
}): Promise<InstagramAccessTokenRefreshResult> {
  const currentToken = decodeSecret(input.secretCipher)?.trim() || "";
  if (!currentToken) {
    throw new Error("LOGIN_REQUIRED_INSTAGRAM");
  }

  const errors: string[] = [];
  let hasLoginRequiredError = false;
  const pushError = (error: unknown, fallback: string) => {
    const message = error instanceof Error && error.message ? error.message : fallback;
    if (!errors.includes(message)) {
      errors.push(message);
    }
    if (isInstagramLoginRequiredErrorMessage(message)) {
      hasLoginRequiredError = true;
    }
  };

  const shouldUseFacebookExchangeRefresh = INSTAGRAM_OAUTH_FLOW === "facebook_login";
  if (shouldUseFacebookExchangeRefresh && INSTAGRAM_OAUTH_APP_ID && INSTAGRAM_OAUTH_APP_SECRET) {
    try {
      const exchangedToken = await graphRequest<FacebookOAuthTokenResponse>("/oauth/access_token", {
        query: {
          grant_type: "fb_exchange_token",
          client_id: INSTAGRAM_OAUTH_APP_ID,
          client_secret: INSTAGRAM_OAUTH_APP_SECRET,
          fb_exchange_token: currentToken,
        },
      });
      const nextToken = exchangedToken.access_token?.trim() || "";
      if (nextToken) {
        return {
          accessToken: nextToken,
          tokenExpiresInSeconds:
            typeof exchangedToken.expires_in === "number" ? exchangedToken.expires_in : null,
        };
      }
      pushError(new Error("INSTAGRAM_GRAPH_REFRESH_EMPTY_TOKEN_FACEBOOK"), "INSTAGRAM_GRAPH_REFRESH_EMPTY_TOKEN_FACEBOOK");
    } catch (error) {
      pushError(error, "INSTAGRAM_GRAPH_REFRESH_FACEBOOK_FAILED");
    }
  } else if (INSTAGRAM_OAUTH_APP_SECRET) {
    // Fluxo Instagram Login: se o token atual ainda for curto, tenta elevar para long-lived.
    try {
      const exchangedToken = await instagramExchangeLongLivedToken(currentToken);
      const nextToken = exchangedToken.access_token?.trim() || "";
      if (nextToken) {
        return {
          accessToken: nextToken,
          tokenExpiresInSeconds:
            typeof exchangedToken.expires_in === "number" ? exchangedToken.expires_in : null,
        };
      }
      pushError(
        new Error("INSTAGRAM_GRAPH_REFRESH_EMPTY_TOKEN_INSTAGRAM_EXCHANGE"),
        "INSTAGRAM_GRAPH_REFRESH_EMPTY_TOKEN_INSTAGRAM_EXCHANGE",
      );
    } catch (error) {
      pushError(error, "INSTAGRAM_GRAPH_REFRESH_INSTAGRAM_EXCHANGE_FAILED");
    }
  }

  try {
    const refreshedToken = await graphRequest<FacebookOAuthTokenResponse>("/refresh_access_token", {
      baseUrl: `https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}`,
      query: {
        grant_type: "ig_refresh_token",
        access_token: currentToken,
      },
    });
    const nextToken = refreshedToken.access_token?.trim() || "";
    if (nextToken) {
      return {
        accessToken: nextToken,
        tokenExpiresInSeconds:
          typeof refreshedToken.expires_in === "number" ? refreshedToken.expires_in : null,
      };
    }
    pushError(new Error("INSTAGRAM_GRAPH_REFRESH_EMPTY_TOKEN_INSTAGRAM"), "INSTAGRAM_GRAPH_REFRESH_EMPTY_TOKEN_INSTAGRAM");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isInstagramRefreshTooEarlyErrorMessage(message)) {
      return {
        accessToken: currentToken,
        tokenExpiresInSeconds: null,
      };
    }
    pushError(error, "INSTAGRAM_GRAPH_REFRESH_INSTAGRAM_FAILED");
  }

  if (hasLoginRequiredError) {
    throw new Error(errors.find((entry) => isInstagramLoginRequiredErrorMessage(entry)) || "LOGIN_REQUIRED_INSTAGRAM");
  }

  throw new Error(`INSTAGRAM_GRAPH_TOKEN_REFRESH_FAILED:${errors.join(" | ") || "unknown-error"}`);
}

async function resolveOptionalLocationIdForInstagramPublication(input: {
  publicationType: PublicationType;
  locationId?: string | null;
  locationName?: string | null;
  accessToken: string;
  instagramUserId: string;
}): Promise<string | null> {
  if (input.publicationType !== "instagram_post" && input.publicationType !== "instagram_reel") {
    return null;
  }

  let resolvedLocationId: string | null = null;
  const directLocationId = input.locationId?.trim() || "";
  if (directLocationId && /^\d+$/.test(directLocationId)) {
    resolvedLocationId = directLocationId;
  } else if (directLocationId) {
    throw new Error("INSTAGRAM_GRAPH_LOCATION_ID_INVALID");
  }

  const locationName = input.locationName?.trim() || "";
  if (!resolvedLocationId && locationName) {
    try {
      resolvedLocationId = await resolveInstagramLocationId(locationName, input.accessToken);
    } catch {
      resolvedLocationId = null;
    }
  }

  if (!resolvedLocationId) {
    try {
      resolvedLocationId = await resolveInstagramLocationIdFromLinkedPage({
        accessToken: input.accessToken,
        instagramUserId: input.instagramUserId,
      });
    } catch {
      resolvedLocationId = null;
    }
  }

  return resolvedLocationId;
}

export async function executeInstagramCarouselJobWithGraphApi(
  connection: {
    id: string;
    loginIdentifier: string | null;
    secretCipher: string | null;
  },
  job: {
    id: string;
    caption?: string | null;
    locationName?: string | null;
    locationId?: string | null;
    fileAltTexts?: Array<string | null>;
  },
  mediaUrls: string[],
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

  const normalizedMediaUrls = mediaUrls.map((entry) => entry.trim()).filter((entry) => /^https?:\/\//i.test(entry));
  if (normalizedMediaUrls.length < 2) {
    throw new Error("INSTAGRAM_GRAPH_CAROUSEL_REQUIRES_MULTIPLE_MEDIA");
  }

  if (normalizedMediaUrls.length > 10) {
    throw new Error("INSTAGRAM_GRAPH_CAROUSEL_MAX_10_MEDIA");
  }

  let locationId = await resolveOptionalLocationIdForInstagramPublication({
    publicationType: "instagram_post",
    locationId: job.locationId,
    locationName: job.locationName,
    accessToken,
    instagramUserId,
  });

  const childCreationIds: string[] = [];
  for (const [index, mediaUrl] of normalizedMediaUrls.entries()) {
    const mediaKind = inferMediaKind(mediaUrl);
    const normalizedAltText = job.fileAltTexts?.[index]?.trim() || "";
    const childPayload: Record<string, string | number | boolean> =
      mediaKind === "video"
        ? {
            media_type: "VIDEO",
            video_url: mediaUrl,
            is_carousel_item: true,
          }
        : {
            image_url: mediaUrl,
            is_carousel_item: true,
          };
    if (mediaKind === "image" && normalizedAltText) {
      childPayload.alt_text = normalizedAltText.slice(0, 1000);
    }

    const childCreated = await graphRequest<MediaContainerResponse>(`/${instagramUserId}/media`, {
      method: "POST",
      accessToken,
      baseUrl: INSTAGRAM_CONTENT_GRAPH_BASE_URL,
      body: childPayload,
    });

    const childId = childCreated.id?.trim() || "";
    if (!childId) {
      throw new Error("INSTAGRAM_GRAPH_CONTAINER_ID_MISSING");
    }

    if (mediaKind === "video") {
      await waitForMediaContainerReady(childId, accessToken);
    }

    childCreationIds.push(childId);
  }

  const buildParentPayload = (effectiveLocationId: string | null): Record<string, string | number | boolean> => {
    const payload: Record<string, string | number | boolean> = {
      media_type: "CAROUSEL",
      children: childCreationIds.join(","),
      caption: job.caption?.trim() || "",
    };

    if (effectiveLocationId?.trim()) {
      payload.location_id = effectiveLocationId.trim();
    }

    return payload;
  };

  let parentCreated: MediaContainerResponse;
  try {
    parentCreated = await graphRequest<MediaContainerResponse>(`/${instagramUserId}/media`, {
      method: "POST",
      accessToken,
      baseUrl: INSTAGRAM_CONTENT_GRAPH_BASE_URL,
      body: buildParentPayload(locationId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const locationPayloadError =
      Boolean(locationId) &&
      (message.toLowerCase().includes("location_id") || message.toLowerCase().includes("location"));

    if (!locationPayloadError) {
      throw error;
    }

    locationId = null;
    parentCreated = await graphRequest<MediaContainerResponse>(`/${instagramUserId}/media`, {
      method: "POST",
      accessToken,
      baseUrl: INSTAGRAM_CONTENT_GRAPH_BASE_URL,
      body: buildParentPayload(null),
    });
  }

  const creationId = parentCreated.id?.trim() || "";
  if (!creationId) {
    throw new Error("INSTAGRAM_GRAPH_CONTAINER_ID_MISSING");
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
    altText?: string | null;
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
  let locationId = await resolveOptionalLocationIdForInstagramPublication({
    publicationType: job.publicationType,
    locationId: job.locationId,
    locationName: job.locationName,
    accessToken,
    instagramUserId,
  });

  const payload = buildMediaContainerPayload({
    publicationType: job.publicationType,
    mediaUrl: normalizedMediaUrl,
    mediaKind,
    caption: job.caption?.trim() || null,
    altText: job.altText?.trim() || null,
    locationId,
  });

  let created: MediaContainerResponse;
  try {
    created = await graphRequest<MediaContainerResponse>(`/${instagramUserId}/media`, {
      method: "POST",
      accessToken,
      baseUrl: INSTAGRAM_CONTENT_GRAPH_BASE_URL,
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
        altText: job.altText?.trim() || null,
        locationId: null,
      });
      created = await graphRequest<MediaContainerResponse>(`/${instagramUserId}/media`, {
        method: "POST",
        accessToken,
        baseUrl: INSTAGRAM_CONTENT_GRAPH_BASE_URL,
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

export async function fetchInstagramPublishedMediaPermalinkWithGraphApi(
  connection: {
    secretCipher: string | null;
  },
  publishedMediaId: string,
): Promise<string | null> {
  const accessToken = decodeSecret(connection.secretCipher);
  if (!accessToken) {
    throw new Error("LOGIN_REQUIRED_INSTAGRAM");
  }

  const mediaId = publishedMediaId.trim();
  if (!mediaId) {
    throw new Error("INSTAGRAM_GRAPH_MEDIA_ID_REQUIRED");
  }

  const payload = await graphRequest<{ permalink?: string }>(`/${mediaId}`, {
    method: "GET",
    accessToken,
    baseUrl: INSTAGRAM_CONTENT_GRAPH_BASE_URL,
    query: {
      fields: "permalink",
    },
  });

  const permalink = payload.permalink?.trim() || "";
  return permalink || null;
}

export async function publishInstagramMediaCommentWithGraphApi(
  connection: {
    secretCipher: string | null;
  },
  input: {
    mediaId: string;
    message: string;
  },
): Promise<void> {
  const accessToken = decodeSecret(connection.secretCipher);
  if (!accessToken) {
    throw new Error("LOGIN_REQUIRED_INSTAGRAM");
  }

  const mediaId = input.mediaId.trim();
  if (!mediaId) {
    throw new Error("INSTAGRAM_GRAPH_COMMENT_MEDIA_ID_MISSING");
  }

  const message = input.message.trim();
  if (!message) {
    return;
  }

  await graphRequest<Record<string, unknown>>(`/${mediaId}/comments`, {
    method: "POST",
    accessToken,
    baseUrl: INSTAGRAM_CONTENT_GRAPH_BASE_URL,
    body: {
      message,
    },
  });
}
