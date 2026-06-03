/**
 * Integration test for the Paga offramp routes (quote → confirm → status).
 *
 * Scope: server-only state machine. We mock:
 *   • `@/lib/mobile-sessions` — auth boundary returns userId=1
 *   • `@/lib/db`              — `userById` returns a fixed user; the `db()`
 *                                adapter is replaced by an in-memory store
 *                                that emulates the few SQL statements the
 *                                three routes issue against `paga_offramps`.
 *   • `@/lib/paga`            — name-enquiry, money-transfer, and status
 *                                are stubbed; we never touch real Paga.
 *   • `@/lib/sui-shapes`      — `getNormalizedTransaction` returns a fake
 *                                "success" transaction with a balance change
 *                                INTO the treasury for the expected USDsui.
 *
 * Asserts the row state machine walks quoted → debited → remitting → settled
 * and that the public-safe status response masks the bank account.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const FAKE_USER_ID = 1;
const FAKE_USER_ADDR =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29";
const TREASURY_ADDR =
  "0x000000000000000000000000000000000000000000000000000000000a11ce11";
const USDSUI_TYPE_LITERAL =
  "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI";

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock("@/lib/mobile-sessions", () => ({
  readEntryIdFromRequest: vi.fn(async () => FAKE_USER_ID),
  isMobileRequest: vi.fn(() => false),
}));

vi.mock("@/lib/app-attest", () => ({
  requireAppAttestStructural: vi.fn(() => null),
}));

vi.mock("@/lib/paga", () => ({
  nameEnquiry: vi.fn(async () => ({ accountName: "EROMONSELE ODIGIE" })),
  moneyTransfer: vi.fn(async () => ({
    pagaReference: "paga-tx-abc123",
    status: "pending",
  })),
  transactionStatus: vi.fn(async () => ({
    status: "settled" as const,
    message: "OK",
  })),
}));

// In-memory store keyed by id. Mimics the half-dozen SQL statements the
// three routes issue — just enough for the state machine to walk.
interface MemoryRow {
  id: string;
  user_id: string;
  usdsui_amount: number;
  ngn_amount: number;
  fx_rate: number;
  bank_code: string;
  bank_account_number: string;
  bank_account_name: string | null;
  paga_reference: string | null;
  status: string;
  status_reason: string | null;
  created_at: number;
  debited_at: number | null;
  settled_at: number | null;
  failed_at: number | null;
  onchain_digest: string | null;
}
const store = new Map<string, MemoryRow>();

function selectById(id: string): MemoryRow[] {
  const r = store.get(id);
  return r ? [r] : [];
}

vi.mock("@/lib/db", () => {
  return {
    ensureSchema: vi.fn(async () => {}),
    userById: vi.fn(async (_id: number) => ({
      id: FAKE_USER_ID,
      google_sub: "test-sub",
      email: "offramp@talise.local",
      name: "Offramp Test",
      picture: null,
      sui_address: FAKE_USER_ADDR,
      salt: "1",
      country: "NG",
      created_at: 0,
      last_seen_at: 0,
    })),
    db: vi.fn(() => ({
      execute: async (arg: string | { sql: string; args?: ReadonlyArray<unknown> }) => {
        const sql = (typeof arg === "string" ? arg : arg.sql).trim();
        const args = (typeof arg === "string" ? [] : arg.args ?? []) as unknown[];
        // INSERT — quote route
        if (/^INSERT INTO paga_offramps/i.test(sql)) {
          const [
            id, user_id, usdsui_amount, ngn_amount, fx_rate,
            bank_code, bank_account_number, bank_account_name,
            created_at,
          ] = args as [
            string, string, number, number, number,
            string, string, string,
            number
          ];
          store.set(id, {
            id, user_id,
            usdsui_amount, ngn_amount, fx_rate,
            bank_code, bank_account_number, bank_account_name,
            paga_reference: null,
            status: "quoted",
            status_reason: null,
            created_at,
            debited_at: null,
            settled_at: null,
            failed_at: null,
            onchain_digest: null,
          });
          return { rows: [], rowsAffected: 1 };
        }
        // Dup-digest early-out (F2): SELECT id ... WHERE onchain_digest = ?
        if (/SELECT id FROM paga_offramps WHERE onchain_digest = \?/i.test(sql)) {
          const [digest] = args as [string];
          const found = [...store.values()].find((r) => r.onchain_digest === digest);
          return { rows: found ? [{ id: found.id }] : [], rowsAffected: 0 };
        }
        // SELECT by id (used by confirm + status)
        if (/SELECT \* FROM paga_offramps WHERE id = \?/i.test(sql)) {
          const [id] = args as [string];
          return { rows: selectById(id) as unknown as Record<string, unknown>[], rowsAffected: 0 };
        }
        // Status transition updates — match each by signature.
        // confirm binds the digest in the SAME atomic debit:
        //   SET status='debited', debited_at=?, onchain_digest=?
        //   WHERE id=? AND status='quoted' AND NOT EXISTS(digest already used)
        // args = [debited_at, onchain_digest, id, digest]
        if (/SET status='debited'/i.test(sql)) {
          const [debited_at, onchain_digest, id, digest] = args as [
            number, string, string, string
          ];
          const r = store.get(id);
          const dupExists = [...store.values()].some((x) => x.onchain_digest === digest);
          if (r && r.status === "quoted" && !dupExists) {
            r.status = "debited";
            r.debited_at = debited_at;
            r.onchain_digest = onchain_digest;
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        }
        if (/SET status='remitting', paga_reference=\?/i.test(sql)) {
          const [pagaRef, id] = args as [string, string];
          const r = store.get(id);
          if (r) {
            r.status = "remitting";
            r.paga_reference = pagaRef;
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        }
        if (/SET status='settled'/i.test(sql)) {
          const [settled_at, id] = args as [number, string];
          const r = store.get(id);
          if (r && r.status === "remitting") {
            r.status = "settled";
            r.settled_at = settled_at;
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        }
        if (/SET status='failed'/i.test(sql)) {
          const [reason, failed_at, id] = args as [string, number, string];
          const r = store.get(id);
          if (r) {
            r.status = "failed";
            r.status_reason = reason;
            r.failed_at = failed_at;
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 0 };
      },
      batch: async () => [],
    })),
  };
});

// gRPC `getTransaction` shim — return a normalized success tx with the
// expected USDsui balance change INTO the treasury.
const txStore = new Map<string, { usdsuiRaw: bigint; sender: string }>();
vi.mock("@/lib/sui-shapes", () => ({
  getNormalizedTransaction: vi.fn(async (digest: string) => {
    const fake = txStore.get(digest);
    if (!fake) throw new Error(`unknown digest ${digest}`);
    return {
      digest,
      status: "success" as const,
      errorMessage: null,
      sender: fake.sender,
      gasOwner: fake.sender,
      gasBudget: 0n,
      gasPrice: 0n,
      effects: { status: "success" as const, errorMessage: null, gasUsed: null },
      objectChanges: [],
      balanceChanges: [
        {
          ownerKind: "address" as const,
          ownerAddress: TREASURY_ADDR.toLowerCase(),
          coinType: USDSUI_TYPE_LITERAL,
          amount: fake.usdsuiRaw, // positive = received by treasury
        },
        {
          ownerKind: "address" as const,
          ownerAddress: fake.sender.toLowerCase(),
          coinType: USDSUI_TYPE_LITERAL,
          amount: -fake.usdsuiRaw,
        },
      ],
      events: [],
      timestampMs: Date.now(),
      checkpoint: null,
    };
  }),
}));

// Env — set BEFORE the route modules evaluate.
process.env.TALISE_OFFRAMP_TREASURY = TREASURY_ADDR;
process.env.OFFRAMP_SPREAD_BPS = "150";

// ─── Helpers ─────────────────────────────────────────────────────────

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("Paga offramp — quote → confirm → status state machine", () => {
  beforeEach(() => {
    store.clear();
    txStore.clear();
  });

  it("walks quoted → debited → remitting → settled", async () => {
    // 1) QUOTE
    const { POST: quotePost } = await import("@/app/api/offramp/paga/quote/route");
    const quoteRes = await quotePost(
      postJson("http://test.local/api/offramp/paga/quote", {
        ngnAmount: 16_200, // ~$10 worth at NGN 1620 / USD
        bankCode: "058", // GTBank
        accountNumber: "0123456789",
      })
    );
    expect(quoteRes.status).toBe(200);
    const quote = (await quoteRes.json()) as {
      quoteId: string;
      usdsuiAmount: number;
      ngnAmount: number;
      fxRate: number;
      accountName: string;
      expiresAt: number;
    };
    expect(quote.quoteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(quote.ngnAmount).toBe(16_200);
    // With 1.5% spread, fxEffective < 1620 -> usdsuiAmount > 10.000000
    expect(quote.fxRate).toBeLessThan(1620);
    expect(quote.usdsuiAmount).toBeGreaterThan(10);
    expect(quote.accountName).toBe("EROMONSELE ODIGIE");
    expect(store.get(quote.quoteId)?.status).toBe("quoted");

    // 2) Prime the fake chain tx with the exact expected USDsui raw amount.
    const expectedRaw = BigInt(Math.floor(quote.usdsuiAmount * 1_000_000));
    const digest = "FAKE_DIGEST_OK";
    txStore.set(digest, { usdsuiRaw: expectedRaw, sender: FAKE_USER_ADDR });

    // 3) CONFIRM
    const { POST: confirmPost } = await import("@/app/api/offramp/paga/confirm/route");
    const confirmRes = await confirmPost(
      postJson("http://test.local/api/offramp/paga/confirm", {
        quoteId: quote.quoteId,
        txDigest: digest,
      })
    );
    expect(confirmRes.status).toBe(200);
    const confirm = (await confirmRes.json()) as { status: string; pagaReference: string };
    expect(confirm.status).toBe("remitting");
    expect(confirm.pagaReference).toBe("paga-tx-abc123");
    const row = store.get(quote.quoteId)!;
    expect(row.status).toBe("remitting");
    expect(row.debited_at).toBeTypeOf("number");
    expect(row.paga_reference).toBe("paga-tx-abc123");

    // 4) STATUS — should poll Paga and bump to settled.
    const { GET: statusGet } = await import(
      "@/app/api/offramp/paga/status/[id]/route"
    );
    const statusReq = new Request(
      `http://test.local/api/offramp/paga/status/${quote.quoteId}`,
      { headers: { authorization: "Bearer test-token" } }
    );
    const statusRes = await statusGet(statusReq, {
      params: Promise.resolve({ id: quote.quoteId }),
    });
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as {
      id: string;
      status: string;
      bankAccountMasked: string;
      pagaReference: string;
      settledAt: number | null;
    };
    expect(status.status).toBe("settled");
    expect(status.bankAccountMasked).toBe("****6789");
    expect(status.pagaReference).toBe("paga-tx-abc123");
    expect(status.settledAt).toBeTypeOf("number");
    expect(store.get(quote.quoteId)?.status).toBe("settled");
  });

  it("fails to 'failed' status when the on-chain digest does not match", async () => {
    const { POST: quotePost } = await import("@/app/api/offramp/paga/quote/route");
    const quoteRes = await quotePost(
      postJson("http://test.local/api/offramp/paga/quote", {
        ngnAmount: 8_100,
        bankCode: "044",
        accountNumber: "1111222233",
      })
    );
    const quote = (await quoteRes.json()) as { quoteId: string; usdsuiAmount: number };
    // Prime the fake tx with a way-too-small amount (10% of expected) — should
    // fail the tolerance check.
    const tooSmallRaw = BigInt(Math.floor(quote.usdsuiAmount * 1_000_000 * 0.1));
    txStore.set("FAKE_DIGEST_LOW", {
      usdsuiRaw: tooSmallRaw,
      sender: FAKE_USER_ADDR,
    });

    const { POST: confirmPost } = await import("@/app/api/offramp/paga/confirm/route");
    const confirmRes = await confirmPost(
      postJson("http://test.local/api/offramp/paga/confirm", {
        quoteId: quote.quoteId,
        txDigest: "FAKE_DIGEST_LOW",
      })
    );
    expect(confirmRes.status).toBe(422);
    expect(store.get(quote.quoteId)?.status).toBe("failed");
  });
});
