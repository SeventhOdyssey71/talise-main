/**
 * API client — mirrors the iOS Network/APIClient.swift.
 *
 * Base URL resolves to https://app.talise.io (override with EXPO_PUBLIC_API_BASE
 * for local/dev). Every request attaches the bearer session token and the
 * X-App-Attest header; 5xx are retried with backoff. Typed service wrappers
 * (wallet, ramps, cross-border, …) will be added per feature area as screens are
 * ported, each returning the same DTOs the web/iOS clients use.
 */

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "https://app.talise.io";

let bearer: string | null = null;
let appAttest: string | null = null;

/** Session wiring — set once auth lands (from SecureStore on launch). */
export function setBearer(token: string | null) {
  bearer = token;
}
export function setAppAttest(token: string | null) {
  appAttest = token;
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
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  /** retries on 5xx (default 2) */
  retries?: number;
  signal?: AbortSignal;
};

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, headers = {}, retries = 2, signal } = opts;
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const h: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (bearer) h["Authorization"] = `Bearer ${bearer}`;
  if (appAttest) h["X-App-Attest"] = appAttest;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (e) {
      if (attempt++ < retries) {
        await delay(300 * attempt);
        continue;
      }
      throw new ApiError(0, "network", (e as Error).message || "Network error");
    }

    if (res.status >= 500 && attempt++ < retries) {
      await delay(300 * attempt);
      continue;
    }

    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      const code = (json as { code?: string } | null)?.code ?? null;
      const msg = (json as { error?: string; message?: string } | null)?.error
        ?? (json as { message?: string } | null)?.message
        ?? `Request failed (${res.status})`;
      throw new ApiError(res.status, code, msg);
    }
    return json as T;
  }
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
