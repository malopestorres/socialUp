import { createRandomToken } from "./security.js";

type GoogleOAuthStateEntry = {
  createdAtMs: number;
};

type GoogleOAuthTokenResponse = {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  token_type?: string;
  refresh_token?: string;
};

type GoogleUserInfoResponse = {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
};

export type GoogleOAuthProfile = {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  metadata: Record<string, unknown>;
};

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const GOOGLE_OAUTH_REDIRECT_URI = (process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
const GOOGLE_OAUTH_AUTHORIZE_URL = (
  process.env.GOOGLE_OAUTH_AUTHORIZE_URL || "https://accounts.google.com/o/oauth2/v2/auth"
).trim();
const GOOGLE_OAUTH_TOKEN_URL = (
  process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token"
).trim();
const GOOGLE_OAUTH_USERINFO_URL = (
  process.env.GOOGLE_OAUTH_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo"
).trim();
const GOOGLE_OAUTH_PROMPT = (process.env.GOOGLE_OAUTH_PROMPT || "select_account").trim();
const GOOGLE_OAUTH_ACCESS_TYPE = (process.env.GOOGLE_OAUTH_ACCESS_TYPE || "offline").trim();
const GOOGLE_OAUTH_STATE_TTL_MS = parsePositiveInt(process.env.GOOGLE_OAUTH_STATE_TTL_MS, 15 * 60 * 1000);
const GOOGLE_OAUTH_SCOPES = (process.env.GOOGLE_OAUTH_SCOPES || "openid,email,profile")
  .split(",")
  .map((scope) => scope.trim())
  .filter((scope) => scope.length > 0);

const googleOAuthStateByToken = new Map<string, GoogleOAuthStateEntry>();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanupExpiredOAuthStateEntries(nowMs: number): void {
  for (const [token, entry] of googleOAuthStateByToken.entries()) {
    if (nowMs - entry.createdAtMs > GOOGLE_OAUTH_STATE_TTL_MS) {
      googleOAuthStateByToken.delete(token);
    }
  }
}

function ensureGoogleConfigured(redirectUri: string): void {
  const missing: string[] = [];
  if (!GOOGLE_CLIENT_ID) {
    missing.push("GOOGLE_CLIENT_ID");
  }
  if (!GOOGLE_CLIENT_SECRET) {
    missing.push("GOOGLE_CLIENT_SECRET");
  }
  if (!redirectUri.trim()) {
    missing.push("GOOGLE_OAUTH_REDIRECT_URI");
  }
  if (GOOGLE_OAUTH_SCOPES.length === 0) {
    missing.push("GOOGLE_OAUTH_SCOPES");
  }

  if (missing.length > 0) {
    throw new Error(`GOOGLE_CONFIG_MISSING:${missing.join(",")}`);
  }
}

function normalizeGoogleErrorDetail(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.error_description === "string" && record.error_description.trim()) {
    return record.error_description.trim();
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }
  return "";
}

export function resolveGoogleOAuthRedirectUri(publicBaseUrl: string | null): string | null {
  if (GOOGLE_OAUTH_REDIRECT_URI) {
    return GOOGLE_OAUTH_REDIRECT_URI;
  }

  const normalizedBaseUrl = (publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) {
    return null;
  }

  return `${normalizedBaseUrl}/auth/google/callback`;
}

export function createGoogleOAuthLaunchUrl(input: { redirectUri: string }): string {
  ensureGoogleConfigured(input.redirectUri);
  const nowMs = Date.now();
  cleanupExpiredOAuthStateEntries(nowMs);

  const stateToken = createRandomToken(18);
  googleOAuthStateByToken.set(stateToken, { createdAtMs: nowMs });

  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", stateToken);
  url.searchParams.set("include_granted_scopes", "true");

  if (GOOGLE_OAUTH_ACCESS_TYPE) {
    url.searchParams.set("access_type", GOOGLE_OAUTH_ACCESS_TYPE);
  }

  if (GOOGLE_OAUTH_PROMPT) {
    url.searchParams.set("prompt", GOOGLE_OAUTH_PROMPT);
  }

  return url.toString();
}

export function consumeGoogleOAuthState(stateToken: string): boolean {
  cleanupExpiredOAuthStateEntries(Date.now());
  const normalizedStateToken = stateToken.trim();
  if (!normalizedStateToken) {
    return false;
  }

  const entry = googleOAuthStateByToken.get(normalizedStateToken);
  googleOAuthStateByToken.delete(normalizedStateToken);
  return Boolean(entry);
}

export async function exchangeGoogleOAuthCodeForProfile(input: {
  code: string;
  redirectUri: string;
}): Promise<GoogleOAuthProfile> {
  ensureGoogleConfigured(input.redirectUri);

  const tokenResponse = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
  });

  const rawTokenBody = await tokenResponse.text();
  const parsedTokenBody = rawTokenBody
    ? (() => {
        try {
          return JSON.parse(rawTokenBody) as GoogleOAuthTokenResponse | Record<string, unknown>;
        } catch {
          return rawTokenBody;
        }
      })()
    : null;

  if (!tokenResponse.ok) {
    const detail = normalizeGoogleErrorDetail(parsedTokenBody);
    throw new Error(`GOOGLE_TOKEN_EXCHANGE_FAILED${detail ? `:${detail}` : ""}`);
  }

  const tokenPayload = (parsedTokenBody ?? {}) as GoogleOAuthTokenResponse;
  const accessToken = typeof tokenPayload.access_token === "string" ? tokenPayload.access_token.trim() : "";
  if (!accessToken) {
    throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED:missing_access_token");
  }

  const userInfoResponse = await fetch(GOOGLE_OAUTH_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const rawUserInfoBody = await userInfoResponse.text();
  const parsedUserInfoBody = rawUserInfoBody
    ? (() => {
        try {
          return JSON.parse(rawUserInfoBody) as GoogleUserInfoResponse | Record<string, unknown>;
        } catch {
          return rawUserInfoBody;
        }
      })()
    : null;

  if (!userInfoResponse.ok) {
    const detail = normalizeGoogleErrorDetail(parsedUserInfoBody);
    throw new Error(`GOOGLE_USERINFO_FAILED${detail ? `:${detail}` : ""}`);
  }

  const userInfo = (parsedUserInfoBody ?? {}) as GoogleUserInfoResponse;
  const providerUserId = typeof userInfo.sub === "string" ? userInfo.sub.trim() : "";
  const email = typeof userInfo.email === "string" ? userInfo.email.trim().toLowerCase() : "";
  const emailVerified =
    userInfo.email_verified === true || userInfo.email_verified === "true";
  const displayName = typeof userInfo.name === "string" ? userInfo.name.trim() : "";
  const avatarUrl = typeof userInfo.picture === "string" ? userInfo.picture.trim() : "";

  if (!providerUserId) {
    throw new Error("GOOGLE_PROFILE_INVALID:missing_sub");
  }

  if (!email) {
    throw new Error("GOOGLE_PROFILE_INVALID:missing_email");
  }

  if (!emailVerified) {
    throw new Error("GOOGLE_EMAIL_NOT_VERIFIED");
  }

  return {
    providerUserId,
    email,
    emailVerified,
    displayName: displayName || null,
    avatarUrl: avatarUrl || null,
    metadata: {
      givenName: typeof userInfo.given_name === "string" ? userInfo.given_name.trim() || null : null,
      familyName: typeof userInfo.family_name === "string" ? userInfo.family_name.trim() || null : null,
      locale: typeof userInfo.locale === "string" ? userInfo.locale.trim() || null : null,
    },
  };
}
