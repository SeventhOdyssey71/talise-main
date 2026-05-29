/**
 * Waitlist handle-claim tests.
 *
 * These live alongside the mainnet integration suite because that's
 * the only Vitest config the repo currently wires up (`pnpm
 * test:integration`). They're hermetic — no network, no DB — so they
 * add zero wall-clock time to the suite.
 *
 * Coverage:
 *   1. `normalizeWaitlistHandle` — charset, length, reserved, common
 *      paste-formats (leading `@`, `.talise.sui` suffix).
 *   2. "claim flow" happy path — POST /api/waitlist/handle/claim end
 *      to end against an in-memory fake of `lib/db` and stubbed
 *      `lib/email` + `lib/suins-operator`. Asserts the DB row reflects
 *      the claim.
 *   3. "dup handle" race — two emails racing for the same handle:
 *      first wins, second 409s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── In-memory DB fake ────────────────────────────────────────────────────
//
// Strictly enough surface area to cover the two routes under test:
//   • SELECT claimed_handle FROM waitlist_signups WHERE email = ? LIMIT 1
//   • UPDATE waitlist_signups SET claimed_handle, handle_claimed_at
//       WHERE email = ? AND claimed_handle IS NULL RETURNING claimed_handle
//
// We model the row store as a Map<email, row>. A second invariant — the
// partial-unique index on `claimed_handle` — is enforced manually inside
// the UPDATE handler so the dup-handle race test exercises the same
// behavior the Postgres index would give us in production.

type Row = {
  email: string;
  created_at: number;
  claimed_handle: string | null;
  handle_claimed_at: number | null;
};

const store = new Map<string, Row>();

function seed(email: string) {
  store.set(email, {
    email,
    created_at: Date.now(),
    claimed_handle: null,
    handle_claimed_at: null,
  });
}

function reset() {
  store.clear();
}

vi.mock("@/lib/db", () => {
  return {
    ensureSchema: async () => {},
    db: () => ({
      execute: async (arg: { sql: string; args?: ReadonlyArray<unknown> }) => {
        const sql = arg.sql.toLowerCase().replace(/\s+/g, " ").trim();
        const args = arg.args ?? [];

        // SELECT email FROM waitlist_signups WHERE claimed_handle = ? LIMIT 1
        if (
          sql.startsWith(
            "select email from waitlist_signups where claimed_handle = ?"
          )
        ) {
          const h = args[0] as string;
          const hit = [...store.values()].find((r) => r.claimed_handle === h);
          return { rows: hit ? [{ email: hit.email }] : [], rowsAffected: 0 };
        }

        // SELECT claimed_handle FROM waitlist_signups WHERE email = ? LIMIT 1
        if (
          sql.startsWith(
            "select claimed_handle from waitlist_signups where email = ?"
          )
        ) {
          const e = args[0] as string;
          const row = store.get(e);
          if (!row) return { rows: [], rowsAffected: 0 };
          return {
            rows: [{ claimed_handle: row.claimed_handle }],
            rowsAffected: 1,
          };
        }

        // UPDATE waitlist_signups SET claimed_handle = ?, handle_claimed_at = ?
        //   WHERE email = ? AND claimed_handle IS NULL RETURNING claimed_handle
        if (
          sql.startsWith(
            "update waitlist_signups set claimed_handle = ?, handle_claimed_at = ? where email = ? and claimed_handle is null returning"
          )
        ) {
          const handle = args[0] as string;
          const at = args[1] as number;
          const email = args[2] as string;
          // Enforce partial-unique index — another email cannot hold the
          // same handle. This is what makes the dup-handle test green.
          const conflict = [...store.values()].find(
            (r) => r.claimed_handle === handle
          );
          if (conflict) {
            throw new Error(
              "duplicate key value violates unique constraint uniq_waitlist_claimed_handle"
            );
          }
          const row = store.get(email);
          if (!row || row.claimed_handle !== null) {
            return { rows: [], rowsAffected: 0 };
          }
          row.claimed_handle = handle;
          row.handle_claimed_at = at;
          return {
            rows: [{ claimed_handle: handle }],
            rowsAffected: 1,
          };
        }

        return { rows: [], rowsAffected: 0 };
      },
    }),
  };
});

// SuiNS resolver — every handle reads as "not on chain" (lookup throws,
// which the helper treats as "free"). Sufficient for the claim-flow tests.
vi.mock("@/lib/suins-operator", () => ({
  suins: () => ({
    getNameRecord: async () => {
      throw new Error("does not exist");
    },
  }),
  mintSubname: vi.fn(),
  suinsOperatorEnabled: () => false,
}));

// Email send — no-op success.
vi.mock("@/lib/email", () => ({
  sendWaitlistConfirmation: vi.fn(async () => ({ ok: true, id: "noop" })),
}));

// Rate-limit — always allow during tests.
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100 }),
  getClientIp: () => "127.0.0.1",
}));

beforeEach(() => {
  reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── 1. Normalizer ────────────────────────────────────────────────────────

describe("normalizeWaitlistHandle", () => {
  it("accepts simple lowercase labels", async () => {
    const { normalizeWaitlistHandle } = await import("@/lib/handle-claim");
    expect(normalizeWaitlistHandle("alice")).toEqual({ ok: true, handle: "alice" });
    expect(normalizeWaitlistHandle("AliCe")).toEqual({ ok: true, handle: "alice" });
    expect(normalizeWaitlistHandle("  bob ")).toEqual({ ok: true, handle: "bob" });
    expect(normalizeWaitlistHandle("a1")).toEqual({ ok: true, handle: "a1" });
    expect(normalizeWaitlistHandle("a-b-c")).toEqual({ ok: true, handle: "a-b-c" });
  });

  it("strips paste-formats", async () => {
    const { normalizeWaitlistHandle } = await import("@/lib/handle-claim");
    expect(normalizeWaitlistHandle("@alice")).toEqual({ ok: true, handle: "alice" });
    expect(normalizeWaitlistHandle("alice@talise")).toEqual({
      ok: true,
      handle: "alice",
    });
    expect(normalizeWaitlistHandle("alice@talise.sui")).toEqual({
      ok: true,
      handle: "alice",
    });
    expect(normalizeWaitlistHandle("alice.talise.sui")).toEqual({
      ok: true,
      handle: "alice",
    });
  });

  it("rejects bad charsets and lengths", async () => {
    const { normalizeWaitlistHandle } = await import("@/lib/handle-claim");
    expect(normalizeWaitlistHandle("")).toMatchObject({ ok: false });
    expect(normalizeWaitlistHandle("a")).toMatchObject({ ok: false, reason: "too_short" });
    expect(normalizeWaitlistHandle("a".repeat(33))).toMatchObject({
      ok: false,
      reason: "too_long",
    });
    expect(normalizeWaitlistHandle("-leading")).toMatchObject({
      ok: false,
      reason: "charset",
    });
    expect(normalizeWaitlistHandle("trailing-")).toMatchObject({
      ok: false,
      reason: "charset",
    });
    expect(normalizeWaitlistHandle("dou--ble")).toMatchObject({
      ok: false,
      reason: "charset",
    });
    expect(normalizeWaitlistHandle("has_underscore")).toMatchObject({
      ok: false,
      reason: "charset",
    });
    expect(normalizeWaitlistHandle("emoji-")).toMatchObject({
      ok: false,
      reason: "charset",
    });
    expect(normalizeWaitlistHandle("with space")).toMatchObject({
      ok: false,
      reason: "charset",
    });
  });

  it("rejects reserved names", async () => {
    const { normalizeWaitlistHandle } = await import("@/lib/handle-claim");
    for (const name of [
      "admin",
      "talise",
      "support",
      "team",
      "root",
      "system",
      "null",
      "undefined",
      "me",
      "noreply",
    ]) {
      expect(normalizeWaitlistHandle(name)).toMatchObject({
        ok: false,
        reason: "reserved",
      });
    }
  });
});

// ─── 2. Claim flow (happy path) ────────────────────────────────────────────

describe("claim flow", () => {
  it("signup → availability → claim → row reflects state", async () => {
    seed("alice@example.com");

    const { POST: availabilityPOST } = await import(
      "@/app/api/waitlist/handle/availability/route"
    );
    const { POST: claimPOST } = await import(
      "@/app/api/waitlist/handle/claim/route"
    );

    // Availability — handle is free.
    const availReq = new Request("http://x/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", handle: "alice" }),
    });
    const availRes = await availabilityPOST(availReq);
    expect(availRes.status).toBe(200);
    const availBody = (await availRes.json()) as { available?: boolean };
    expect(availBody.available).toBe(true);

    // Claim — succeeds.
    const claimReq = new Request("http://x/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", handle: "alice" }),
    });
    const claimRes = await claimPOST(claimReq);
    expect(claimRes.status).toBe(200);
    const claimBody = (await claimRes.json()) as {
      ok?: boolean;
      handle?: string;
      strategy?: string;
    };
    expect(claimBody.ok).toBe(true);
    expect(claimBody.handle).toBe("alice");
    expect(claimBody.strategy).toBe("reserve");

    // Row reflects state.
    expect(store.get("alice@example.com")?.claimed_handle).toBe("alice");

    // Second availability check on the same handle for a different user
    // now reports it as taken in DB.
    seed("bob@example.com");
    const avail2 = await availabilityPOST(
      new Request("http://x/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "bob@example.com", handle: "alice" }),
      })
    );
    const avail2Body = (await avail2.json()) as {
      available?: boolean;
      reason?: string;
    };
    expect(avail2Body.available).toBe(false);
    expect(avail2Body.reason).toBe("taken_db");
  });
});

// ─── 3. Dup handle race ───────────────────────────────────────────────────

describe("dup handle race", () => {
  it("two emails racing for the same handle: first wins, second 409s", async () => {
    seed("first@example.com");
    seed("second@example.com");

    const { POST: claimPOST } = await import(
      "@/app/api/waitlist/handle/claim/route"
    );

    const reqA = new Request("http://x/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "first@example.com", handle: "sele" }),
    });
    const reqB = new Request("http://x/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "second@example.com", handle: "sele" }),
    });

    // First claim wins outright.
    const resA = await claimPOST(reqA);
    expect(resA.status).toBe(200);

    // Second claim races and loses. Because our DB fake mirrors the
    // partial-unique index, the UPDATE raises a duplicate-key error
    // which the route translates to a 409.
    const resB = await claimPOST(reqB);
    expect(resB.status).toBe(409);
    const bodyB = (await resB.json()) as { error?: string };
    expect(bodyB.error).toMatch(/taken|claimed/i);

    // Store state: only the first email holds the handle.
    expect(store.get("first@example.com")?.claimed_handle).toBe("sele");
    expect(store.get("second@example.com")?.claimed_handle).toBe(null);
  });
});
