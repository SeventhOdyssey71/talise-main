/**
 * Integration test for `/api/vault/state` (sub-plan 1.10).
 *
 * Verifies the gRPC-migrated balance/object reads + GraphQL event walks
 * return the expected response shape end-to-end. Hits real Sui mainnet
 * — not part of the default test run; invoke via `test:integration`.
 *
 * What this exercises:
 *   1. `gql(VAULT_AND_CAPS_QUERY)` — fetches vault contents + owned
 *      AutoSwapCap<T> objects in a single round-trip.
 *   2. `gql(BAG_DYNAMIC_FIELDS_QUERY)` — walks the bag's dynamic-field
 *      page(s) to extract Balance<T> entries.
 *   3. `readSharedCapsForOwner` + `readSharedV2CapsForOwner` — GraphQL
 *      `events.type` walks for v3/v7 shared caps, then gRPC `getObject`
 *      to confirm each is still Shared.
 *
 * Auth strategy: same as sub-plan 4.1 — we stub `readEntryIdFromRequest`
 * + `userById` via `vi.mock` so the route receives a synthetic mobile
 * session pointed at a real mainnet sui address. No database, no JWT.
 *
 * Skip behavior: the route depends on `vaultPackageIds()` which reads
 * the live deploy ids from env (TALISE_AUTOSWAP_PACKAGE_ID + friends).
 * When those are unset the route correctly degrades to a 503 — we
 * treat that as a skip rather than a failure, since integration runs
 * outside Vercel may legitimately lack production secrets.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

// ──────────────────────────────────────────────────────────────────────
// Auth + db stubs. These must be installed BEFORE the route is imported
// so the route's top-level `import { userById } from "@/lib/db"` and
// `import { readEntryIdFromRequest } from "@/lib/mobile-sessions"`
// resolve against our fakes.
// ──────────────────────────────────────────────────────────────────────

// Mutable handles so individual tests can rebind the address returned.
let mockUserId: number | null = 42;
let mockUser: {
  id: number;
  sui_address: string;
  talise_vault_id?: string | null;
} | null = null;

vi.mock("@/lib/mobile-sessions", () => ({
  // Any request resolves to `mockUserId`. Tests set this to `null` to
  // exercise the unauth branch (not the focus here — covered in 4.1).
  readEntryIdFromRequest: async () => mockUserId,
  isMobileRequest: () => true,
  // Other exports the broader module surfaces aren't read by the route,
  // but provide stubs to keep esbuild's tree-shake honest.
  verifyMobileBearer: async () => mockUserId,
}));

vi.mock("@/lib/db", () => ({
  // Only `userById` is called by the vault/state route.
  userById: async (id: number) => {
    if (!mockUser || mockUser.id !== id) return null;
    return mockUser;
  },
}));

// Lazy-load the route AFTER mocks register so the import graph sees
// the stubbed modules.
type GetHandler = (req: Request) => Promise<Response>;
let GET: GetHandler;

beforeAll(async () => {
  const mod = await import("../../app/api/vault/state/route");
  GET = mod.GET as GetHandler;
});

// ──────────────────────────────────────────────────────────────────────
// Fixture addresses.
// ──────────────────────────────────────────────────────────────────────

// Sui system state object (0x5). Always exists, owns nothing, and has
// no vault — perfect "empty user" canary. Borrowed from harness.
const KNOWN_MAINNET_ADDRESS =
  "0x0000000000000000000000000000000000000000000000000000000000000005";

// A well-formed but unused mainnet address — used to confirm the
// empty-vault path returns sane defaults rather than 500-ing.
const UNUSED_MAINNET_ADDRESS =
  "0x000000000000000000000000000000000000000000000000000000000000beef";

// Optional: a real mainnet vault id picked up from env. When set, the
// non-empty branch exercises the bag-dynamic-fields walk; otherwise
// we still assert the route handles `talise_vault_id: null` cleanly.
const REAL_VAULT_ID = process.env.TALISE_TEST_VAULT_ID || null;
const REAL_VAULT_OWNER = process.env.TALISE_TEST_VAULT_OWNER || null;

/**
 * Returns true when the running env has the autoswap package ids set.
 * The route returns a 503 without them — we skip the bulk of the
 * assertions in that case since they'd be testing the 503 path, not
 * the migrated read path.
 */
function vaultPackageConfigured(): boolean {
  return (
    !!process.env.TALISE_AUTOSWAP_PACKAGE_ID &&
    !!process.env.TALISE_AUTOSWAP_REGISTRY_ID &&
    !!process.env.TALISE_AUTOSWAP_REGISTRY_V2_ID
  );
}

function makeReq(): Request {
  // Vault state is a plain authenticated GET — the Bearer header value
  // doesn't matter because `readEntryIdFromRequest` is mocked. We
  // include one anyway so `isMobileRequest()` returns true for any
  // downstream code that might branch on transport.
  return new Request("https://test.local/api/vault/state", {
    method: "GET",
    headers: { authorization: "Bearer test-token" },
  });
}

describe("/api/vault/state — gRPC + GraphQL migration (sub-plan 1.10)", () => {
  it(
    "returns the documented `{ vault, caps }` shape for an empty-vault user",
    async () => {
      mockUserId = 1;
      mockUser = {
        id: 1,
        sui_address: KNOWN_MAINNET_ADDRESS,
        // Null vault id → route returns `vault: null` without touching
        // bag dynamic fields. Still walks v3/v7 shared-cap events.
        talise_vault_id: null,
      };

      const res = await GET(makeReq());

      // 503 is acceptable when the autoswap package isn't configured in
      // this env. The shape assertions only make sense for 200s.
      if (!vaultPackageConfigured()) {
        expect([200, 503]).toContain(res.status);
        if (res.status === 503) return;
      } else {
        expect(res.status).toBe(200);
      }

      const body = (await res.json()) as {
        vault: null | { id: string; balances: Array<{ coinType: string; amount: string }> };
        caps: Array<{
          id: string;
          sourceType: string;
          maxPerSwap: string;
          expiresAtMs: string;
          paused: boolean;
          needsMigration: boolean;
          isV1: boolean;
        }>;
      };

      // Top-level shape.
      expect(body).toHaveProperty("vault");
      expect(body).toHaveProperty("caps");

      // Empty-vault user → `vault: null`, NOT an error string.
      expect(body.vault).toBeNull();

      // `caps` is ALWAYS an array — empty when the user owns no caps.
      // System-state address (0x5) owns no AutoSwapCaps of any vintage.
      expect(Array.isArray(body.caps)).toBe(true);
      // 0x5 holds nothing the route would surface — must be []. Any
      // surprise rows here means the cap-type filter is too broad.
      expect(body.caps.length).toBe(0);
    },
    60_000
  );

  it(
    "returns `vault: { id, balances: [] }` and well-shaped caps for a vault-bearing user",
    async () => {
      if (!vaultPackageConfigured()) {
        // Without the package ids the route 503s before reading any
        // chain state — there's nothing meaningful to assert.
        return;
      }

      // When a real test-vault is wired in via env, use it; otherwise
      // fall back to a synthetic vault id so we still exercise the
      // non-null `vault` branch through the bag-DF walk. The synthetic
      // path will hit a GraphQL "object not found" → the catch in the
      // route swallows that and the response carries `vault: { id, balances: [] }`.
      const vaultId =
        REAL_VAULT_ID ||
        "0x0000000000000000000000000000000000000000000000000000000000000000";
      const owner = REAL_VAULT_OWNER || KNOWN_MAINNET_ADDRESS;

      mockUserId = 2;
      mockUser = {
        id: 2,
        sui_address: owner,
        talise_vault_id: vaultId,
      };

      const res = await GET(makeReq());
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        vault: null | { id: string; balances: Array<{ coinType: string; amount: string }> };
        caps: Array<{
          id: string;
          sourceType: string;
          maxPerSwap: string;
          expiresAtMs: string;
          paused: boolean;
          needsMigration: boolean;
          isV1: boolean;
        }>;
      };

      // vaultId was provided → `vault` is an object, never null.
      expect(body.vault).not.toBeNull();
      expect(body.vault!.id).toBe(vaultId);

      // balances is ALWAYS an array — empty when the bag has no rows
      // (or when the bag-DF read failed and got swallowed).
      expect(Array.isArray(body.vault!.balances)).toBe(true);
      for (const b of body.vault!.balances) {
        expect(typeof b.coinType).toBe("string");
        expect(b.coinType.length).toBeGreaterThan(0);
        // amount is a u64 string ("0" or numeric digits only).
        expect(typeof b.amount).toBe("string");
        expect(/^\d+$/.test(b.amount)).toBe(true);
      }

      // caps is always an array; each row must satisfy the iOS-strict
      // DTO contract (camelCase keys, primitive types).
      expect(Array.isArray(body.caps)).toBe(true);
      for (const c of body.caps) {
        expect(typeof c.id).toBe("string");
        expect(typeof c.sourceType).toBe("string");
        expect(typeof c.maxPerSwap).toBe("string");
        expect(typeof c.expiresAtMs).toBe("string");
        expect(typeof c.paused).toBe("boolean");
        expect(typeof c.needsMigration).toBe("boolean");
        expect(typeof c.isV1).toBe("boolean");
        // sourceType MUST be a Move type tag (`0x...::module::Name`).
        expect(/^0x[0-9a-fA-F]+::[A-Za-z_]\w*::[A-Za-z_]\w*/.test(c.sourceType)).toBe(true);
      }
    },
    60_000
  );

  it(
    "tolerates an unused address (returns empty caps, vault: null) without throwing",
    async () => {
      mockUserId = 3;
      mockUser = {
        id: 3,
        sui_address: UNUSED_MAINNET_ADDRESS,
        talise_vault_id: null,
      };

      const res = await GET(makeReq());

      // Either OK with empty state, or 503 when the package isn't deployed.
      expect([200, 503]).toContain(res.status);
      if (res.status === 503) return;

      const body = (await res.json()) as {
        vault: unknown;
        caps: unknown;
      };

      // Empty defaults — NOT an error payload.
      expect(body.vault).toBeNull();
      expect(Array.isArray(body.caps)).toBe(true);
      expect((body.caps as unknown[]).length).toBe(0);
      // No `error` key — degraded states still go through 200 with sane shape.
      expect((body as { error?: unknown }).error).toBeUndefined();
    },
    60_000
  );

  it(
    "rejects unauthenticated requests with 401",
    async () => {
      mockUserId = null; // simulate no Bearer / cookie
      mockUser = null;

      const res = await GET(makeReq());
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error?: string };
      expect(typeof body.error).toBe("string");
    },
    15_000
  );
});
