import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const FIREBASE_PROJECT_ID = (process.env.FIREBASE_PROJECT_ID || "").trim();
const FIREBASE_CLIENT_EMAIL = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || "").trim();

function normalizeFirebasePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY);
}

function getFirebaseAdminAuth() {
  if (!isFirebaseAdminConfigured()) {
    throw new Error("FIREBASE_ADMIN_NOT_CONFIGURED");
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: normalizeFirebasePrivateKey(FIREBASE_PRIVATE_KEY),
      }),
      projectId: FIREBASE_PROJECT_ID,
    });
  }

  return getAuth();
}

export async function verifyFirebaseGoogleIdToken(idToken: string): Promise<{
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  metadata: Record<string, unknown>;
}> {
  const normalizedToken = idToken.trim();
  if (!normalizedToken) {
    throw new Error("FIREBASE_ID_TOKEN_MISSING");
  }

  const decoded = await getFirebaseAdminAuth().verifyIdToken(normalizedToken, true);
  const signInProvider =
    decoded.firebase && typeof decoded.firebase.sign_in_provider === "string"
      ? decoded.firebase.sign_in_provider.trim().toLowerCase()
      : "";

  if (signInProvider !== "google.com") {
    throw new Error("FIREBASE_GOOGLE_PROVIDER_REQUIRED");
  }

  const email = typeof decoded.email === "string" ? decoded.email.trim().toLowerCase() : "";
  if (!email) {
    throw new Error("FIREBASE_GOOGLE_EMAIL_MISSING");
  }

  if (decoded.email_verified !== true) {
    throw new Error("FIREBASE_GOOGLE_EMAIL_NOT_VERIFIED");
  }

  const providerUserId =
    typeof decoded.uid === "string" && decoded.uid.trim()
      ? decoded.uid.trim()
      : typeof decoded.sub === "string" && decoded.sub.trim()
        ? decoded.sub.trim()
        : "";

  if (!providerUserId) {
    throw new Error("FIREBASE_GOOGLE_SUB_MISSING");
  }

  return {
    providerUserId,
    email,
    emailVerified: true,
    displayName: typeof decoded.name === "string" && decoded.name.trim() ? decoded.name.trim() : null,
    avatarUrl: typeof decoded.picture === "string" && decoded.picture.trim() ? decoded.picture.trim() : null,
    metadata: {
      firebase: decoded.firebase ?? null,
      signInProvider,
      authTime: typeof decoded.auth_time === "number" ? decoded.auth_time : null,
      issuedAt: typeof decoded.iat === "number" ? decoded.iat : null,
      issuer: typeof decoded.iss === "string" ? decoded.iss : null,
      audience: typeof decoded.aud === "string" ? decoded.aud : null,
    },
  };
}
