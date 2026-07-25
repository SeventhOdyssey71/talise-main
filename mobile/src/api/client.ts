/**
 * API client — mirrors ios Network/APIClient.swift.
 *
 * Base URL = EXPO_PUBLIC_API_BASE ?? https://app.talise.io (always the FINAL
 * host — a cross-host redirect would strip Authorization). Every request carries
 * Accept, User-Agent, Authorization: Bearer, and (when available) the App-Attest
 * headers. GET requests are de-duplicated in-flight. A 401 fires the session-
 * expired hook then throws. No HTTP retry (matches actual iOS behavior, despite
 * its comments). Two logical clients via `zk: true` (30s vs 15s timeout).
 */

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "https://app.talise.io";

const USER_AGENT = "Talise-Android/1.0.0";

let bearer: string | null = null;

/** Produces the two App-Attest headers over the request body hash, or null. */
type AttestProvider = (body: string) => Promise<Record<string, string> | null>;
let attestProvider: AttestProvider | null = null;
let onUnauthorized: (() => void) | null = null;

export function setBearer(token: string | null) {
  bearer = token;
}
export function setAttestProvider(p: AttestProvider | null) {
  attestProvider = p;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isUnauthorized() {
    return this.status === 401;
  }
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  /** zk pipeline gets a longer timeout (30s vs 15s), like iOS's two sessions. */
  zk?: boolean;
  signal?: AbortSignal;
};

const inflight = new Map<string, Promise<unknown>>();

export function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? "GET";
  if (method === "GET" && !opts.signal) {
    const key = `${method} ${path}`;
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = doRequest<T>(path, opts).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }
  return doRequest<T>(path, opts);
}

async function doRequest<T>(path: string, opts: Options): Promise<T> {
  const { method = "GET", body, headers = {}, zk = false } = opts;
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

  const h: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    ...headers,
  };
  if (bodyStr !== undefined) h["Content-Type"] = "application/json";
  if (bearer) h["Authorization"] = `Bearer ${bearer}`;
  if (attestProvider) {
    const att = await attestProvider(bodyStr ?? "");
    if (att) Object.assign(h, att);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), zk ? 30000 : 15000);
  const signal = opts.signal ?? controller.signal;

  let res: Response;
  try {
    res = await fetch(url, { method, headers: h, body: bodyStr, signal });
  } catch (e) {
    clearTimeout(timeout);
    if ((e as Error).name === "AbortError") throw new ApiError(0, "timeout", "Request timed out.");
    throw new ApiError(0, "network", (e as Error).message || "Network error.");
  }
  clearTimeout(timeout);

  const text = await res.text();
  const json = text ? safeJson(text) : null;

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, (json as { code?: string } | null)?.code ?? "unauthorized", "Session expired.");
  }
  if (!res.ok) {
    const code = (json as { code?: string } | null)?.code ?? null;
    const msg =
      (json as { error?: string } | null)?.error ??
      (json as { message?: string } | null)?.message ??
      `Request failed (${res.status}).`;
    throw new ApiError(res.status, code, msg);
  }
  return json as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
