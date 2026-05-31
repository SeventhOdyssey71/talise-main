/**
 * Turnstile bot-gate tests for the legacy `POST /api/waitlist` endpoint
 * (audit F9: unauthenticated outbound-email-spam amplifier).
 *
 * Lives in the integration suite because that's the only Vitest config
 * the repo wires up (`test:integration`). Fully hermetic — DB, email,
 * rate-limit and Cloudflare siteverify are all mocked, so no network and
 * zero wall-clock cost.
 *
 * Behavior matrix under test:
 *   - secret SET + valid token   → 200, email sent, row inserted
 *   - secret SET + invalid token → 403, no email, no row
 *   - secret SET + missing token → 403, no email, no row
 *   - secret UNSET               → 200 (rate-limit only) + loud warning
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── In-memory DB fake (just enough for the legacy insert path) ────────────
type WaitlistRow = {
  email: string;
  created_at: number;
  confirmation_sent: boolean;
};
const store = new Map<string, WaitlistRow>();

vi.mock("@/lib/db", () => {
  const execute = async (arg: {
    sql: string;
    args?: ReadonlyArray<unknown>;
  }) => {
    const sql = arg.sql.toLowerCase().replace(/\s+/g, " ").trim();
    const args = arg.args ?? [];

    // INSERT INTO waitlist_signups (...) ... ON CONFLICT (email) DO NOTHING RETURNING email
    if (
      sql.startsWith("insert into waitlist_signups") &&
      sql.includes("on conflict (email) do nothing")
    ) {
      const email = args[0] as string;
      const createdAt = args[1] as number;
      if (store.has(email)) return { rows: [], rowsAffected: 0 };
      store.set(email, { email, created_at: createdAt, confirmation_sent: false });
      return { rows: [{ email }], rowsAffected: 1 };
    }

    // UPDATE waitlist_signups SET confirmation_sent = true ... WHERE email = ?
    if (sql.startsWith("update waitlist_signups set confirmation_sent")) {
      const email = args[args.length - 1] as string;
      const row = store.get(email);
      if (row) row.confirmation_sent = true;
      return { rows: [], rowsAffected: row ? 1 : 0 };
    }

    return { rows: [], rowsAffected: 0 };
  };
  return { ensureSchema: async () => {}, db: () => ({ execute }) };
});

// Email send — toggleable spy.
const sendMock = vi.fn(async () => ({ ok: true, id: "noop" }));
vi.mock("@/lib/email", () => ({
  sendWaitlistConfirmation: (..._a: unknown[]) => sendMock(),
}));

// Rate-limit — always allow (we're testing the Turnstile gate, not throttling).
// The route uses the async variant; provide both so the mock is robust to
// either being imported.
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ ok: true }),
  rateLimitAsync: async () => ({ ok: true }),
  getClientIp: () => "203.0.113.7",
}));

// Cloudflare siteverify — we stub global fetch and flip success per-test.
let siteverifySuccess = true;
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ success: siteverifySuccess }),
}));

function newReq(body: Record<string, unknown>) {
  return new Request("http://x/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.clear();
  sendMock.mockClear();
  fetchMock.mockClear();
  siteverifySuccess = true;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("waitlist Turnstile gate — secret SET", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
  });

  it("valid token → 200, email sent, row inserted", async () => {
    const { POST } = await import("@/app/api/waitlist/route");
    const res = await POST(
      newReq({ email: "good@example.com", turnstileToken: "tok-valid" })
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(store.has("good@example.com")).toBe(true);
  });

  it("invalid token → 403, no email, no row", async () => {
    siteverifySuccess = false;
    const { POST } = await import("@/app/api/waitlist/route");
    const res = await POST(
      newReq({ email: "bad@example.com", turnstileToken: "tok-bad" })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/verification required/i);
    expect(sendMock).not.toHaveBeenCalled();
    expect(store.has("bad@example.com")).toBe(false);
  });

  it("missing token → 403, no email, no row (siteverify not even called)", async () => {
    const { POST } = await import("@/app/api/waitlist/route");
    const res = await POST(newReq({ email: "none@example.com" }));
    expect(res.status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
    expect(store.has("none@example.com")).toBe(false);
  });

  it("accepts the cf-turnstile-response alias field", async () => {
    const { POST } = await import("@/app/api/waitlist/route");
    const res = await POST(
      newReq({ email: "alias@example.com", "cf-turnstile-response": "tok" })
    );
    expect(res.status).toBe(200);
    expect(store.has("alias@example.com")).toBe(true);
  });
});

describe("waitlist Turnstile gate — secret UNSET", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  it("proceeds (rate-limit only) and logs the unprotected warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { POST } = await import("@/app/api/waitlist/route");
    const res = await POST(newReq({ email: "dev@example.com" }));
    expect(res.status).toBe(200);
    // No siteverify call when the secret is absent.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(store.has("dev@example.com")).toBe(true);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("UNPROTECTED"))
    ).toBe(true);
    warn.mockRestore();
  });
});
