type PostForMePlatform = "instagram" | "facebook" | "threads";

type PostForMePlacement = "timeline" | "reels" | "stories";

type PostForMeSocialAccountRecord = {
  id: string;
  platform: PostForMePlatform | null;
  name: string | null;
  username: string | null;
  status: string | null;
  externalId: string | null;
  tokenExpiresAt: string | null;
  raw: Record<string, unknown>;
};

type PostForMeSocialPostRecord = {
  id: string;
  status: string | null;
  externalId: string | null;
  raw: Record<string, unknown>;
};

type PostForMePlatformPostRecord = {
  id: string | null;
  platform: string | null;
  socialPostResultId: string | null;
  socialPostId: string | null;
  socialAccountId: string | null;
  platformUrl: string | null;
  raw: Record<string, unknown>;
};

type PostForMeSocialPostResultRecord = {
  id: string;
  status: string | null;
  postId: string | null;
  error: string | null;
  platformPosts: PostForMePlatformPostRecord[];
  raw: Record<string, unknown>;
};

const POST_FOR_ME_API_KEY = (process.env.POST_FOR_ME_API_KEY || "").trim();
const POST_FOR_ME_API_BASE_URL = (process.env.POST_FOR_ME_API_BASE_URL || "https://api.postforme.dev/v1")
  .trim()
  .replace(/\/+$/, "");
const POST_FOR_ME_TIMEOUT_MS = parsePositiveInt(process.env.POST_FOR_ME_TIMEOUT_MS, 30_000);
const POST_FOR_ME_RETRY_ATTEMPTS = parsePositiveInt(process.env.POST_FOR_ME_RETRY_ATTEMPTS, 3);

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ensurePostForMeConfigured(): void {
  const missing: string[] = [];
  if (!POST_FOR_ME_API_KEY) {
    missing.push("POST_FOR_ME_API_KEY");
  }

  if (missing.length > 0) {
    throw new Error(`POST_FOR_ME_CONFIG_MISSING:${missing.join(",")}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseString(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function normalizeErrorDetail(payload: unknown): string {
  const record = asRecord(payload);
  if (!record) {
    return "";
  }

  const error = asRecord(record.error);
  const nestedMessage = parseString(error?.message);
  if (nestedMessage) {
    return nestedMessage;
  }

  const nestedDetail = parseString(error?.detail);
  if (nestedDetail) {
    return nestedDetail;
  }

  const nestedCode = parseString(error?.code);
  if (nestedCode) {
    return nestedCode;
  }

  const errors = Array.isArray(record.errors) ? record.errors : Array.isArray(error?.errors) ? error?.errors : null;
  if (errors) {
    for (const item of errors) {
      const itemRecord = asRecord(item);
      const itemMessage = parseString(itemRecord?.message) || parseString(itemRecord?.detail) || parseString(item);
      if (itemMessage) {
        return itemMessage;
      }
    }
  }

  return parseString(record.message) || parseString(record.detail) || "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePostForMeNetworkError(error: unknown, path: string): Error {
  if (!(error instanceof Error)) {
    return new Error(`POST_FOR_ME_NETWORK_ERROR:${path}:UNKNOWN_NETWORK_ERROR`);
  }

  const cause = asRecord((error as Error & { cause?: unknown }).cause);
  const causeCode = parseString(cause?.code);
  if (causeCode === "UND_ERR_CONNECT_TIMEOUT") {
    return new Error(`POST_FOR_ME_NETWORK_ERROR:${path}:CONNECT_TIMEOUT`);
  }

  if (error.name === "AbortError") {
    return new Error(`POST_FOR_ME_NETWORK_ERROR:${path}:REQUEST_TIMEOUT`);
  }

  const message = parseString(error.message) || "NETWORK_ERROR";
  return new Error(`POST_FOR_ME_NETWORK_ERROR:${path}:${message}`);
}

async function postForMeRequest<T>(
  path: string,
  options?: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    query?: Record<string, string | number | boolean | Array<string | number | boolean> | null | undefined>;
    jsonBody?: Record<string, unknown>;
  },
): Promise<T> {
  ensurePostForMeConfigured();
  let lastError: Error | null = null;
  const maxAttempts = Math.max(1, POST_FOR_ME_RETRY_ATTEMPTS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = new URL(path.startsWith("/") ? `${POST_FOR_ME_API_BASE_URL}${path}` : `${POST_FOR_ME_API_BASE_URL}/${path}`);
    for (const [key, value] of Object.entries(options?.query ?? {})) {
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), POST_FOR_ME_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: options?.method || "GET",
        headers: {
          Authorization: `Bearer ${POST_FOR_ME_API_KEY}`,
          Accept: "application/json",
          ...(options?.jsonBody ? { "Content-Type": "application/json" } : {}),
        },
        body: options?.jsonBody ? JSON.stringify(options.jsonBody) : undefined,
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
        throw new Error(`POST_FOR_ME_HTTP_${response.status}:${path}${detail ? `:${detail}` : ""}`);
      }

      return payload as T;
    } catch (error) {
      const normalizedError = normalizePostForMeNetworkError(error, path);
      lastError = normalizedError;
      const isNetworkError = normalizedError.message.startsWith("POST_FOR_ME_NETWORK_ERROR:");
      if (!isNetworkError || attempt >= maxAttempts) {
        throw normalizedError;
      }
      await sleep(Math.min(1_500 * attempt, 4_000));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`POST_FOR_ME_NETWORK_ERROR:${path}:UNKNOWN_NETWORK_ERROR`);
}

function normalizePostForMePlatform(value: unknown): PostForMePlatform | null {
  const normalized = parseString(value)?.toLowerCase();
  if (normalized === "instagram" || normalized === "facebook" || normalized === "threads") {
    return normalized;
  }
  return null;
}

function parsePostForMeSocialAccountRecord(value: unknown): PostForMeSocialAccountRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = parseString(record.id);
  if (!id) {
    return null;
  }

  return {
    id,
    platform: normalizePostForMePlatform(record.platform),
    name: parseString(record.name) || parseString(record.display_name),
    username:
      parseString(record.username) ||
      parseString(record.handle) ||
      parseString(record.login_identifier),
    status: parseString(record.status)?.toLowerCase() || null,
    externalId: parseString(record.external_id),
    tokenExpiresAt:
      parseString(record.access_token_expires_at) ||
      parseString(record.token_expires_at) ||
      parseString(record.expires_at),
    raw: record,
  };
}

function parsePostForMeSocialAccountList(payload: unknown): PostForMeSocialAccountRecord[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => parsePostForMeSocialAccountRecord(entry))
      .filter((entry): entry is PostForMeSocialAccountRecord => Boolean(entry));
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const nestedCandidates = [record.data, record.items, record.social_accounts];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((entry) => parsePostForMeSocialAccountRecord(entry))
        .filter((entry): entry is PostForMeSocialAccountRecord => Boolean(entry));
    }
  }

  const single = parsePostForMeSocialAccountRecord(record);
  return single ? [single] : [];
}

function parsePostForMeAuthUrl(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  return (
    parseString(record.url) ||
    parseString(record.auth_url) ||
    parseString(record.authUrl) ||
    parseString(record.redirect_url)
  );
}

function parsePostForMeSocialPostList(payload: unknown): PostForMeSocialPostRecord[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => parsePostForMeSocialPostRecord(entry))
      .filter((entry): entry is PostForMeSocialPostRecord => Boolean(entry));
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const nestedCandidates = [record.data, record.items, record.social_posts];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((entry) => parsePostForMeSocialPostRecord(entry))
        .filter((entry): entry is PostForMeSocialPostRecord => Boolean(entry));
    }
  }

  const single = parsePostForMeSocialPostRecord(record);
  return single ? [single] : [];
}

export function isPostForMeManagedPlatform(platform: string): platform is PostForMePlatform {
  return platform === "instagram" || platform === "facebook" || platform === "threads";
}

function parsePostForMeSocialPostRecord(value: unknown): PostForMeSocialPostRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = parseString(record.id);
  if (!id) {
    return null;
  }

  return {
    id,
    status: parseString(record.status)?.toLowerCase() || null,
    externalId: parseString(record.external_id),
    raw: record,
  };
}

function parsePostForMePlatformPostRecord(value: unknown): PostForMePlatformPostRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: parseString(record.id),
    platform: parseString(record.platform)?.toLowerCase() || null,
    socialPostResultId: parseString(record.social_post_result_id),
    socialPostId: parseString(record.social_post_id),
    socialAccountId: parseString(record.social_account_id),
    platformUrl:
      parseString(record.platform_url) ||
      parseString(record.url) ||
      parseString(record.permalink),
    raw: record,
  };
}

function parsePostForMeSocialPostResultRecord(value: unknown): PostForMeSocialPostResultRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id =
    parseString(record.id) ||
    parseString(record.social_post_result_id) ||
    parseString(record.post_result_id);
  if (!id) {
    return null;
  }

  const platformPosts = Array.isArray(record.platform_posts)
    ? record.platform_posts
        .map((entry) => parsePostForMePlatformPostRecord(entry))
        .filter((entry): entry is PostForMePlatformPostRecord => Boolean(entry))
    : [];

  return {
    id,
    status: parseString(record.status)?.toLowerCase() || null,
    postId: parseString(record.post_id) || parseString(record.social_post_id),
    error: normalizeErrorDetail(record.error) || parseString(record.error),
    platformPosts,
    raw: record,
  };
}

function parsePostForMeSocialPostResultList(payload: unknown): PostForMeSocialPostResultRecord[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => parsePostForMeSocialPostResultRecord(entry))
      .filter((entry): entry is PostForMeSocialPostResultRecord => Boolean(entry));
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const nestedCandidates = [record.data, record.items, record.results, record.social_post_results];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((entry) => parsePostForMeSocialPostResultRecord(entry))
        .filter((entry): entry is PostForMeSocialPostResultRecord => Boolean(entry));
    }
  }

  const single = parsePostForMeSocialPostResultRecord(record);
  return single ? [single] : [];
}

export type {
  PostForMePlacement,
  PostForMePlatform,
  PostForMePlatformPostRecord,
  PostForMeSocialAccountRecord,
  PostForMeSocialPostRecord,
  PostForMeSocialPostResultRecord,
};

export async function createPostForMeSocialAccountAuthUrl(input: {
  platform: PostForMePlatform;
  externalId: string;
}): Promise<string> {
  const platformData =
    input.platform === "instagram"
      ? {
          instagram: {
            connection_type: "instagram",
          },
        }
      : undefined;

  const payload = await postForMeRequest<unknown>("/social-accounts/auth-url", {
    method: "POST",
    jsonBody: {
      platform: input.platform,
      external_id: input.externalId,
      ...(platformData ? { platform_data: platformData } : {}),
    },
  });

  const launchUrl = parsePostForMeAuthUrl(payload);
  if (!launchUrl) {
    throw new Error("POST_FOR_ME_AUTH_URL_MISSING");
  }

  return appendPostForMeMetaReauthHints(launchUrl, input.platform);
}

function appendPostForMeMetaReauthHints(url: string, platform: PostForMePlatform): string {
  if (platform !== "instagram" && platform !== "facebook" && platform !== "threads") {
    return url;
  }

  try {
    const parsedUrl = new URL(url);
    if (platform === "instagram") {
      parsedUrl.searchParams.set("prompt", "select_account");
      parsedUrl.searchParams.set("auth_type", "reauthenticate");
      parsedUrl.searchParams.set("force_reauth", "true");
      parsedUrl.searchParams.set("force_login", "true");
      return parsedUrl.toString();
    }

    parsedUrl.searchParams.set("prompt", "select_account");
    parsedUrl.searchParams.delete("auth_type");
    parsedUrl.searchParams.delete("force_reauth");
    parsedUrl.searchParams.set("force_login", "true");
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

export async function listPostForMeSocialAccounts(input: {
  platform?: PostForMePlatform;
  externalId?: string | null;
}): Promise<PostForMeSocialAccountRecord[]> {
  const payload = await postForMeRequest<unknown>("/social-accounts", {
    query: {
      platform: input.platform,
      external_id: input.externalId ?? undefined,
    },
  });

  return parsePostForMeSocialAccountList(payload);
}

export async function disconnectPostForMeSocialAccount(socialAccountId: string): Promise<void> {
  await postForMeRequest(`/social-accounts/${encodeURIComponent(socialAccountId)}/disconnect`, {
    method: "POST",
  });
}

export async function listPostForMeSocialPosts(input: {
  externalId?: string | null;
  platform?: PostForMePlatform;
  status?: string | null;
  limit?: number;
}): Promise<PostForMeSocialPostRecord[]> {
  const payload = await postForMeRequest<unknown>("/social-posts", {
    query: {
      external_id: input.externalId ?? undefined,
      platform: input.platform ?? undefined,
      status: input.status ? input.status.trim().toLowerCase() : undefined,
      limit: input.limit ?? undefined,
    },
  });

  return parsePostForMeSocialPostList(payload);
}

export async function listPostForMeSocialPostResults(input: {
  postId?: string | null;
  platform?: PostForMePlatform;
  socialAccountId?: string | null;
  limit?: number;
}): Promise<PostForMeSocialPostResultRecord[]> {
  const payload = await postForMeRequest<unknown>("/social-post-results", {
    query: {
      post_id: input.postId ?? undefined,
      platform: input.platform ?? undefined,
      social_account_id: input.socialAccountId ?? undefined,
      limit: input.limit ?? undefined,
    },
  });

  return parsePostForMeSocialPostResultList(payload);
}

export async function createPostForMeSocialPost(input: {
  caption?: string | null;
  socialAccountIds: string[];
  mediaUrls?: string[];
  placement?: PostForMePlacement;
  platform?: PostForMePlatform;
  locationId?: string | null;
  externalId?: string | null;
}): Promise<PostForMeSocialPostRecord> {
  const platformConfiguration =
    input.platform && (input.placement || parseString(input.locationId))
      ? {
          ...(input.placement ? { placement: input.placement } : {}),
          ...(parseString(input.locationId) ? { location: parseString(input.locationId) } : {}),
        }
      : undefined;

  const payload = await postForMeRequest<unknown>("/social-posts", {
    method: "POST",
    jsonBody: {
      caption: parseString(input.caption) ?? undefined,
      social_accounts: input.socialAccountIds,
      media: (input.mediaUrls ?? [])
        .map((url) => parseString(url))
        .filter((url): url is string => Boolean(url))
        .map((url) => ({ url })),
      external_id: parseString(input.externalId) ?? undefined,
      platform_configurations:
        input.platform && platformConfiguration
          ? {
              [input.platform]: platformConfiguration,
            }
          : undefined,
    },
  });

  const post = parsePostForMeSocialPostRecord(payload);
  if (!post) {
    throw new Error("POST_FOR_ME_SOCIAL_POST_MISSING");
  }

  return post;
}
