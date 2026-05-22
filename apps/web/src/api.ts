function resolveApiUrl(): string {
  const envApiUrl =
    typeof import.meta !== "undefined" &&
    typeof import.meta.env !== "undefined" &&
    typeof import.meta.env.VITE_API_URL === "string"
      ? import.meta.env.VITE_API_URL.trim()
      : "";
  if (envApiUrl) {
    return envApiUrl.replace(/\/+$/, "");
  }

  if (typeof window === "undefined") {
    return "http://localhost:4000";
  }

  const hostname = window.location.hostname.trim().toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:4000";
  }

  if (hostname.endsWith("socialup.space")) {
    return "https://api.socialup.space";
  }

  return "http://localhost:4000";
}

const API_URL = resolveApiUrl();
const PERSISTENT_SESSION_STORAGE_KEY = "socialup-admin-session";
const TEMPORARY_SESSION_STORAGE_KEY = "socialup-admin-session-temporary";
const POPUP_SESSION_HANDOFF_STORAGE_KEY = "socialup-admin-session-popup-handoff";
const POPUP_SESSION_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

function getPopupSessionHandoffToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const raw = window.localStorage.getItem(POPUP_SESSION_HANDOFF_STORAGE_KEY);
  if (!raw) {
    return "";
  }

  try {
    const parsed = JSON.parse(raw) as { token?: string; createdAtMs?: number };
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    const createdAtMs = typeof parsed.createdAtMs === "number" ? parsed.createdAtMs : 0;
    if (!token || !Number.isFinite(createdAtMs) || createdAtMs <= 0) {
      window.localStorage.removeItem(POPUP_SESSION_HANDOFF_STORAGE_KEY);
      return "";
    }

    if (Date.now() - createdAtMs > POPUP_SESSION_HANDOFF_MAX_AGE_MS) {
      window.localStorage.removeItem(POPUP_SESSION_HANDOFF_STORAGE_KEY);
      return "";
    }

    return token;
  } catch {
    window.localStorage.removeItem(POPUP_SESSION_HANDOFF_STORAGE_KEY);
    return "";
  }
}

function getSessionToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return (
    window.localStorage.getItem(PERSISTENT_SESSION_STORAGE_KEY) ??
    window.sessionStorage.getItem(TEMPORARY_SESSION_STORAGE_KEY) ??
    getPopupSessionHandoffToken() ??
    ""
  );
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers ?? {});
  const sessionToken = getSessionToken();

  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (sessionToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }

  return headers;
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await response.json()) as { error?: string };
    return body.error || `HTTP ${response.status}`;
  }

  const text = await response.text();
  return text || `HTTP ${response.status}`;
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${input}`, {
    ...init,
    headers: buildHeaders(init),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  get: request,
  postJson<T>(input: string, body: unknown): Promise<T> {
    return request<T>(input, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  putJson<T>(input: string, body: unknown): Promise<T> {
    return request<T>(input, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },
  async delete(input: string): Promise<void> {
    await request<void>(input, {
      method: "DELETE",
    });
  },
  async postFile(input: string, file: File): Promise<{ filePath: string; originalName: string }> {
    const formData = new FormData();
    formData.append("file", file);

    return request<{ filePath: string; originalName: string }>(input, {
      method: "POST",
      body: formData,
    });
  },
  setSessionToken(token: string, remember = true): void {
    if (typeof window === "undefined") {
      return;
    }

    if (token) {
      if (remember) {
        window.localStorage.setItem(PERSISTENT_SESSION_STORAGE_KEY, token);
        window.sessionStorage.removeItem(TEMPORARY_SESSION_STORAGE_KEY);
        window.localStorage.removeItem(POPUP_SESSION_HANDOFF_STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(TEMPORARY_SESSION_STORAGE_KEY, token);
        window.localStorage.removeItem(PERSISTENT_SESSION_STORAGE_KEY);
      }
      return;
    }

    window.localStorage.removeItem(PERSISTENT_SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(TEMPORARY_SESSION_STORAGE_KEY);
    window.localStorage.removeItem(POPUP_SESSION_HANDOFF_STORAGE_KEY);
  },
  setPopupSessionHandoffToken(token: string): void {
    if (typeof window === "undefined") {
      return;
    }

    const normalizedToken = token.trim();
    if (!normalizedToken) {
      window.localStorage.removeItem(POPUP_SESSION_HANDOFF_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      POPUP_SESSION_HANDOFF_STORAGE_KEY,
      JSON.stringify({
        token: normalizedToken,
        createdAtMs: Date.now(),
      }),
    );
  },
  getSessionToken,
  sessionStorageKey: PERSISTENT_SESSION_STORAGE_KEY,
  baseUrl: API_URL,
  createEventSource(input: string): EventSource {
    if (typeof window === "undefined") {
      throw new Error("EventSource indisponível fora do navegador.");
    }

    const sessionToken = getSessionToken().trim();
    const url = new URL(`${API_URL}${input}`);
    if (sessionToken) {
      url.searchParams.set("sessionToken", sessionToken);
    }

    return new window.EventSource(url.toString());
  },
};
