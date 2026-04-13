import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithPopup,
  signOut,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDw4EOGpZRhJsDtNPb9zN-mZHk-eeVdLjM",
  authDomain:
    typeof window !== "undefined" && window.location.hostname.trim().toLowerCase() !== "localhost"
      ? "auth.socialup.space"
      : "social-up-40c02.firebaseapp.com",
  projectId: "social-up-40c02",
  storageBucket: "social-up-40c02.firebasestorage.app",
  messagingSenderId: "190696358071",
  appId: "1:190696358071:web:a2088eed89c85621dd4d32",
};

function getFirebaseApp() {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

function getFirebaseAuthClient() {
  return getAuth(getFirebaseApp());
}

export function resolveFirebaseGoogleLoginErrorMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  if (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request" ||
    code === "auth/popup-blocked"
  ) {
    return "Login com Google cancelado.";
  }

  if (code === "auth/unauthorized-domain") {
    return "Este domínio ainda não foi autorizado no Firebase Authentication.";
  }

  if (code === "auth/operation-not-allowed") {
    return "O login com Google ainda não está habilitado no Firebase.";
  }

  if (code === "auth/network-request-failed") {
    return "Falha de rede ao iniciar o login com Google.";
  }

  return error instanceof Error ? error.message : "Falha ao entrar com Google.";
}

export function isFirebaseGoogleLoginCancelledError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  return code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
}

export async function signInWithGoogleViaFirebase(): Promise<{ idToken: string }> {
  const auth = getFirebaseAuthClient();
  await setPersistence(auth, inMemoryPersistence);

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken(true);
  await signOut(auth).catch(() => undefined);

  if (!idToken.trim()) {
    throw new Error("O Firebase não retornou um token válido para o login com Google.");
  }

  return { idToken };
}
