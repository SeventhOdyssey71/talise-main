/**
 * Integration test for `/api/send/sponsor-prepare` — the **gasless**
 * branch of the combined send-prepare endpoint (sub-plan 4.1, sibling
 * of the sponsored 4.2 test in `send-sponsored.test.ts`).
 *
 * Scope: PREPARE only. We never submit, sign, or broadcast a tx — the
 * submit endpoint (`/api/send/gasless-submit`) requires a valid
 * zkLogin signature which can't be faked deterministically in a unit
 * test. The assertions exercise the route's mode-selection branching
 * for the gasless eligibility window:
 *
 *   1. Plain USDsui send (no round-up) → `mode: "gasless"`,
 *      `roundupUsd: 0`, base64 bytes.
 *   2. Small USDsui amount (0.001) → still gasless. The route has
 *      NO minimum threshold above `amount > 0` + `onchain > 0`
 *      (verified by reading the validation block in the route).
 *      0.001 USDsui = 1000 micro-units > 0, so the request succeeds.
 *      Documented here so future floor changes are caught.
 *   3. Returned `bytes` decode to a non-empty `Uint8Array` (the bytes
 *      are what iOS signs and forwards to /api/send/gasless-submit —
 *      empty bytes would be a silent prepare failure).
 *
 * Auth strategy: per the sub-plan 4.1 brief we picked option (c) —
 * mock `readEntryIdFromRequest` to short-circuit to a fixed userId.
 * This matches the pattern the sponsored sibling uses and keeps the
 * test deterministic without standing up a dev server or a real
 * mobile bearer. The auth layer isn't under test here; the route's
 * mode-selection branching is.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fromBase64 } from "@mysten/sui/utils";

// ─── Hoisted mocks ──────────────────────────────────────────────────
// `vi.mock` calls are hoisted above the route import so the route's
// top-level `import { ... } from "@/lib/..."` picks up the stubs.

vi.mock("@/lib/mobile-sessions", () => ({
  readEntryIdFromRequest: vi.fn(async () => 42),
  isMobileRequest: vi.fn(() => true),
}));

vi.mock("@/lib/db", () => ({
  userById: vi.fn(async () => ({
    id: 42,
    google_sub: "test-sub",
    email: "test@example.com",
    name: "Test User",
    picture: null,
    sui_address:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    salt: "0",
    country: null,
    created_at: 0,
    last_seen_at: 0,
    notified_at: null,
    account_type: "personal",
    business_name: null,
    business_handle: null,
    business_industry: null,
    talise_username: null,
    roundup_enabled: 0,
    roundup_percentage: 0,
  })),
}));

// Gasless eligibility hinges on `getRoundupConfig` returning
// `enabled: false` (or zero percentage) — anything else flips the
// route to sponsored mode. Default the mock to disabled; tests can
// override with `vi.mocked(getRoundupConfig).mockResolvedValue(...)`.
vi.mock("@/lib/rewards/roundup", () => ({
  getRoundupConfig: vi.fn(async () => ({
    enabled: false,
    percentage: 0,
    savedUsd: 0,
  })),
}));

// The gasless branch never touches Onara, but the route loads the
// module at the top so we stub it to a no-op. If the route's gasless
// build ever throws + falls through to sponsored, this stub keeps the
// fallback path from hitting a real Onara host.
vi.mock("@/lib/onara", () => ({
  onara: () => ({
    status: async () => ({
      address:
        "0x2222222222222222222222222222222222222222222222222222222222222222",
    }),
  }),
}));

vi.mock("@/lib/pk-bootstrap", () => ({
  ensurePaymentRegistry: vi.fn(async () => ({ ok: true, minted: false })),
}));

// `appendNaviSupply` and `appendPaymentKitReceipt` are only invoked
// on the sponsored branch — stub them so any accidental fall-through
// during the test doesn't blow up on uninitialised SDKs.
vi.mock("@/lib/navi-supply", () => ({
  appendNaviSupply: vi.fn(async () => undefined),
}));

vi.mock("@/lib/intents/wrap-payment-kit", () => ({
  appendPaymentKitReceipt: vi.fn(() => ({
    nonce: "tlse1abcd0001aaaaaabbbbbb",
  })),
}));

vi.mock("@/lib/perf-cache", () => ({
  memoTtl: <T,>(_k: string, _ttl: number, fn: () => Promise<T>) => fn(),
  invalidate: vi.fn(),
  recordSendLatency: vi.fn(),
  readSendLatencySamples: vi.fn(() => []),
}));

// Minimal Sui client stub. The gasless branch only needs the client
// reference forwarded into `tx.build({ client })` — the stubbed
// Transaction below ignores it. `getReferenceGasPrice` is included
// in case the build path ever queries it (it currently doesn't, since
// the route pre-stamps `setGasPrice(0n)`).
vi.mock("@/lib/sui", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sui")>(
    "@/lib/sui"
  );
  return {
    ...actual,
    sui: () => ({
      getReferenceGasPrice: async () => ({ referenceGasPrice: "1000" }),
    }),
    network: () => "mainnet" as const,
  };
});

// Stub the `Transaction` builder so `tx.build({ client })` returns a
// deterministic non-empty byte buffer. Mirrors the sponsored sibling
// test's stub so the two share a single contract surface.
vi.mock("@mysten/sui/transactions", async () => {
  const actual = await vi.importActual<typeof import("@mysten/sui/transactions")>(
    "@mysten/sui/transactions"
  );
  class StubTransaction {
    setSender = vi.fn();
    setGasOwner = vi.fn();
    setGasPrice = vi.fn();
    setGasBudget = vi.fn();
    add = vi.fn(() => ({ kind: "Result" }));
    moveCall = vi.fn(() => ({ kind: "Result" }));
    transferObjects = vi.fn();
    object = vi.fn(() => ({ kind: "Input" }));
    pure = {
      address: vi.fn(() => ({ kind: "Input" })),
    };
    build = vi.fn(async () => {
      // 16 deterministic bytes — enough to confirm "non-empty" and
      // round-trips cleanly through toBase64 / fromBase64.
      return new Uint8Array([
        10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
      ]);
    });
  }
  return {
    ...actual,
    Transaction: StubTransaction,
    coinWithBalance: vi.fn(() => ({ kind: "TxIntent" })),
  };
});

// ─── Import AFTER mocks so the route resolves them ─────────────────
const { POST } = await import("@/app/api/send/sponsor-prepare/route");
const { getRoundupConfig } = await import("@/lib/rewards/roundup");

const RECIPIENT_ADDR =
  "0x3333333333333333333333333333333333333333333333333333333333333333";

function buildReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/send/sponsor-prepare", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Bearer header is present so `readEntryIdFromRequest` (mocked
      // above) is exercised, but the value is irrelevant — the mock
      // returns 42 unconditionally.
      authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("/api/send/sponsor-prepare (gasless branch, PREPARE only)", () => {
  beforeEach(() => {
    // The route reads `process.env.ONARA_URL` at the top and 503s if
    // it's missing. Set a placeholder — the gasless branch never
    // actually calls Onara, but the env guard runs before branching.
    process.env.ONARA_URL = "http://onara.test";
    vi.clearAllMocks();
    // Default to roundup disabled so each test starts in gasless
    // territory unless it overrides explicitly.
    vi.mocked(getRoundupConfig).mockResolvedValue({
      enabled: false,
      percentage: 0,
      savedUsd: 0,
    });
  });

  it("plain USDsui send (amount 0.01) → { mode:'gasless', bytes, roundupUsd: 0 }", async () => {
    const res = await POST(
      buildReq({ to: RECIPIENT_ADDR, amount: 0.01, asset: "USDsui" })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      mode: string;
      bytes: string;
      roundupUsd: number;
      asset: string;
      amount: number;
      to: string;
    };

    // All three contract fields from the brief.
    expect(json.mode).toBe("gasless");
    expect(typeof json.bytes).toBe("string");
    expect(json.bytes.length).toBeGreaterThan(0);
    expect(json.roundupUsd).toBe(0);

    // Echo fields — sanity, not contract.
    expect(json.asset).toBe("USDsui");
    expect(json.amount).toBe(0.01);
    expect(json.to).toBe(RECIPIENT_ADDR);
  });

  it("small USDsui amount (0.001) succeeds — route has no min threshold above onchain > 0", async () => {
    // Documenting the boundary: the route validates `amountNum > 0`
    // and `onchain > 0` where `onchain = round(amount * 10**6)`.
    // 0.001 USDsui = 1000 micro-units → passes both checks. There is
    // NO higher minimum (e.g. no $0.01 floor) in the gasless route.
    // If a future change introduces one, this test will start failing
    // and the contract needs to be re-documented here.
    const res = await POST(
      buildReq({ to: RECIPIENT_ADDR, amount: 0.001, asset: "USDsui" })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      mode: string;
      bytes: string;
      roundupUsd: number;
    };

    expect(json.mode).toBe("gasless");
    expect(json.roundupUsd).toBe(0);
    expect(typeof json.bytes).toBe("string");
    expect(json.bytes.length).toBeGreaterThan(0);
  });

  it("bytes payload is valid base64 and decodes to a non-empty Uint8Array", async () => {
    const res = await POST(
      buildReq({ to: RECIPIENT_ADDR, amount: 0.01, asset: "USDsui" })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { bytes: string };

    // Standard base64 charset (the SDK uses `toBase64`, not URL-safe).
    expect(json.bytes).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    const decoded = fromBase64(json.bytes);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(decoded.length).toBeGreaterThan(0);
  });
});
