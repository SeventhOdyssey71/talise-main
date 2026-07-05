/**
 * HTTP client for the Talise backend. Attaches the bearer + the mobile header
 * (`X-Talise-Mobile: 1`) so the server uses `mobileSigningContext` — the same
 * signing path the iOS/Android apps use. Maps common backend errors (401,
 * app-access 403, rate-limit 429, session-rebind) to clear messages.
 */
import type { Session } from "./config.js";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type Api = {
  baseUrl: string;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  /** Raw fetch (for the SSE chat stream) with auth headers applied. */
  raw(path: string, init?: RequestInit): Promise<Response>;
};

/** Build an authed client. Pass a bare bearer for read-only calls, or the full
 *  session (needed for anything that signs). */
export function makeApi(baseUrl: string, auth?: Pick<Session, "bearer"> | string): Api {
  const bearer = typeof auth === "string" ? auth : auth?.bearer;

  const headers = (extra?: Record<string, string>): Record<string, string> => ({
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    // Route the server to the mobile signing context (jwt+salt in mobile_sessions).
    "X-Talise-Mobile": "1",
    ...extra,
  });

  async function handle<T>(res: Response): Promise<T> {
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text };
    }
    if (!res.ok) {
      const body = json as { error?: string; code?: string };
      throw mapError(res.status, body.error, body.code);
    }
    return json as T;
  }

  return {
    baseUrl,
    async get<T>(path: string): Promise<T> {
      const res = await fetch(baseUrl + path, { headers: headers() });
      return handle<T>(res);
    },
    async post<T>(path: string, body?: unknown): Promise<T> {
      const res = await fetch(baseUrl + path, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return handle<T>(res);
    },
    async raw(path: string, init?: RequestInit): Promise<Response> {
      return fetch(baseUrl + path, {
        ...init,
        headers: { ...headers(), ...(init?.headers as Record<string, string>) },
      });
    },
  };
}

function mapError(status: number, error?: string, code?: string): ApiError {
  if (status === 401) {
    if (code === "session_rebind_required") {
      return new ApiError(
        "your session can no longer sign — run `talise login` again",
        401,
        code,
      );
    }
    return new ApiError(error || "not signed in — run `talise login`", 401, code);
  }
  if (status === 403) {
    if (code === "SCREENING_BLOCK") {
      return new ApiError("blocked by a compliance screen", 403, code);
    }
    // App-access allowlist: signed in, but the account can't move money yet.
    return new ApiError(
      error || "this account isn't approved to move money yet (private beta allowlist)",
      403,
      code,
    );
  }
  if (status === 429) {
    return new ApiError("rate limited — slow down and retry shortly", 429, code);
  }
  return new ApiError(error || `request failed (HTTP ${status})`, status, code);
}
