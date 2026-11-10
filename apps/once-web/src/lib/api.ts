import { QueryClient } from "@tanstack/react-query";
import type { RequestOptions } from "./models";
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 60_000,
      gcTime: 300_000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "",
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const authEvents = new EventTarget();
// Shared identity/PC endpoints stay at the core root; ONCE domain callers use its retained namespace.
export function apiPath(path: string) {
  const shared = /^\/(?:auth|account|pc)(?:\/|\?|$)|^\/admin\/pc(?:\/|\?|$)/.test(path);
  return `/api${shared || path.startsWith("/once/") ? "" : "/once"}${path}`;
}
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  options.signal?.throwIfAborted();
  const headers = new Headers(options.headers);
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  const response = await fetch(apiPath(path), {
    ...options,
    credentials: "same-origin",
    headers,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: unknown;
    pagination?: unknown;
    error?: { message?: string; code?: string };
    message?: string | string[];
    code?: string;
  } | null;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      authEvents.dispatchEvent(new Event("expired"));
    throw new ApiError(
      payload?.error?.message || (payload?.message
        ? [payload.message].flat().join("；")
        : `请求失败（${response.status}）`),
      response.status,
      payload?.error?.code || (typeof payload?.code === "string" ? payload.code : ""),
    );
  }
  if (payload === null) throw new Error("服务返回了无法读取的数据，请重试。");
  return (typeof payload === "object" && "data" in payload && !("pagination" in payload) ? payload.data : payload) as T;
}
function newOperationId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const operationKeys = new Map<string, string>();
const operationStorageKey = (owner: string, signature: string) =>
  `once-operation:${owner}:${signature}`;
export function operationKey(owner: string, signature: string) {
  const key = operationStorageKey(owner, signature);
  let result = operationKeys.get(key);
  if (!result) {
    let saved = "";
    try {
      saved = sessionStorage.getItem(key) || "";
    } catch {
      /* In-memory retries remain available. */
    }
    result = /^[A-Za-z0-9_-]{16,128}$/.test(saved)
      ? saved
      : newOperationId();
    operationKeys.set(key, result);
    try {
      sessionStorage.setItem(key, result);
    } catch {
      /* Keep the same key until this operation completes. */
    }
  }
  return result;
}
export function completeOperation(owner: string, signature: string) {
  const key = operationStorageKey(owner, signature);
  operationKeys.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* No credentials are stored here. */
  }
}
