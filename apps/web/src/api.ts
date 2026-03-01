const API_URL = "http://localhost:4000";
const SESSION_STORAGE_KEY = "socialup-admin-session";

function getSessionToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "";
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
  setSessionToken(token: string): void {
    if (typeof window === "undefined") {
      return;
    }

    if (token) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, token);
      return;
    }

    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  },
  getSessionToken,
  sessionStorageKey: SESSION_STORAGE_KEY,
  baseUrl: API_URL,
};
