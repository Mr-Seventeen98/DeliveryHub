import type { ApiResponse } from "@delivery-hub/shared-types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const ACCESS_TOKEN_KEY = "deliveryHub.accessToken";
const REFRESH_BEFORE_EXPIRY_SECONDS = 60;

let refreshPromise: Promise<string> | null = null;

export function getAccessToken(): string | null {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function clearAccessToken(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}

function storeAccessToken(accessToken: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
}

function tokenExpiresWithin(token: string, seconds: number): boolean {
  try {
    const encodedPayload = token.split(".")[1];
    if (!encodedPayload) return true;
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(normalized + padding)) as { exp?: number };
    return !payload.exp || payload.exp <= Date.now() / 1000 + seconds;
  } catch {
    return true;
  }
}

function errorMessage<T>(payload: ApiResponse<T>): string {
  if (payload.success) return "请求失败";
  return Array.isArray(payload.error.message)
    ? payload.error.message.join("；")
    : payload.error.message;
}

async function requestOnce<T>(
  path: string,
  init: RequestInit,
  token: string | null,
): Promise<{ response: Response; payload: ApiResponse<T> }> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const payload = (await response.json()) as ApiResponse<T>;
  return { response, payload };
}

function expireSession(): void {
  clearAccessToken();
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const { response, payload } = await requestOnce<{ accessToken: string }>(
      "/auth/refresh",
      { method: "POST" },
      null,
    );
    if (!payload.success) {
      if (response.status === 401) expireSession();
      throw new Error(errorMessage(payload));
    }
    storeAccessToken(payload.data.accessToken);
    return payload.data.accessToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function validAccessToken(): Promise<string> {
  const token = getAccessToken();
  if (!token) throw new Error("登录状态已失效");
  return tokenExpiresWithin(token, REFRESH_BEFORE_EXPIRY_SECONDS)
    ? refreshAccessToken()
    : token;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const isAuthRequest = path.startsWith("/auth/");
  let token = isAuthRequest ? null : getAccessToken();

  if (token && tokenExpiresWithin(token, REFRESH_BEFORE_EXPIRY_SECONDS)) {
    try {
      token = await refreshAccessToken();
    } catch (error) {
      if (tokenExpiresWithin(token, 0)) throw error;
    }
  }

  let result = await requestOnce<T>(path, init, token);
  if (!isAuthRequest && result.response.status === 401) {
    token = await refreshAccessToken();
    result = await requestOnce<T>(path, init, token);
  }

  if (!result.payload.success) {
    throw new Error(errorMessage(result.payload));
  }
  return result.payload.data;
}

export async function consumeApiEventStream<T>(
  path: string,
  onEvent: (event: T) => void,
  signal: AbortSignal,
): Promise<void> {
  let token = await validAccessToken();
  let response = await openEventStream(path, token, signal);
  if (response.status === 401) {
    token = await refreshAccessToken();
    response = await openEventStream(path, token, signal);
  }
  if (!response.ok || !response.body) {
    throw new Error(`状态推送连接失败（HTTP ${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      const eventType = frame
        .split("\n")
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
      if (payload) {
        const data = JSON.parse(payload) as unknown;
        onEvent((eventType ? { type: eventType, data } : data) as T);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function openEventStream(
  path: string,
  token: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1${path}`, {
    credentials: "include",
    headers: {
      accept: "text/event-stream",
      authorization: `Bearer ${token}`,
    },
    signal,
  });
}

export async function login(username: string, password: string): Promise<void> {
  const result = await apiRequest<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  storeAccessToken(result.accessToken);
}

export async function logout(): Promise<void> {
  try {
    await requestOnce("/auth/logout", { method: "POST" }, null);
  } finally {
    clearAccessToken();
  }
}
