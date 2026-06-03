/**
 * Integration test for the Paga settlement webhook (POST /api/offramp/paga/webhook).
 *
 * Exercises the REAL signature verification + parse (`@/lib/paga`) — only the
 * DB is mocked (in-memory `paga_offramps` + `offramp_webhook_events`). Asserts:
 *   • valid HMAC + SUCCESSFUL → row remitting→settled, event logged ok
 *   • valid HMAC + FAILED     → row remitting→failed
 *   • invalid HMAC            → 401, row untouched, event logged signature_ok=0
 *   • exact redelivery        → idempotent no-op ({duplicate:true})
 *   • unknown reference       → 404
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";

// Paga env — set BEFORE the route module evaluates so pagaConfig() resolves.
process.env.PAGA_CLIENT_ID = "test-client";
process.env.PAGA_PASSWORD = "test-pass";
process.env.PAGA_HMAC_KEY = "test-hmac-key";
const HMAC_KEY = "test-hmac-key";

interface OfframpRow {
  id: string;
  status: string;
  paga_reference: string | null;
  settled_at: number | null;
  failed_at: number | null;
  status_reason: string | null;
}
interface EventRow {
  id: string;
  reference: string | null;
  offramp_id: string | null;
  status_in: string | null;
  signature_ok: number;
}
const offramps = new Map<string, OfframpRow>();
const events = new Map<string, EventRow>();

vi.mock("@/lib/db", () => ({
  ensureSchema: vi.fn(async () => {}),
  db: vi.fn(() => ({
    execute: async (arg: string | { sql: string; args?: ReadonlyArray<unknown> }) => {
      const sql = (typeof arg === "string" ? arg : arg.sql).trim();
      const args = (typeof arg === "string" ? [] : arg.args ?? []) as unknown[];

      if (/^INSERT INTO offramp_webhook_events/i.test(sql)) {
        const [id, reference, status_in, signature_ok] = args as [
          string, string | null, string | null, number
        ];
        if (events.has(id)) return { rows: [], rowsAffected: 0 }; // ON CONFLICT DO NOTHING
        events.set(id, { id, reference, offramp_id: null, status_in, signature_ok });
        return { rows: [], rowsAffected: 1 };
      }
      if (/^UPDATE offramp_webhook_events SET offramp_id/i.test(sql)) {
        const [offramp_id, id] = args as [string, string];
        const e = events.get(id);
        if (e) e.offramp_id = offramp_id;
        return { rows: [], rowsAffected: e ? 1 : 0 };
      }
      if (/SELECT id, status FROM paga_offramps WHERE id = \? OR paga_reference = \?/i.test(sql)) {
        const [byId, byRef] = args as [string, string];
        const row =
          offramps.get(byId) ??
          [...offramps.values()].find((r) => r.paga_reference === byRef);
        return {
          rows: row ? ([{ id: row.id, status: row.status }] as unknown as Record<string, unknown>[]) : [],
          rowsAffected: 0,
        };
      }
      if (/UPDATE paga_offramps SET status='settled'/i.test(sql)) {
        const [settled_at, id] = args as [number, string];
        const r = offramps.get(id);
        if (r && r.status === "remitting") {
          r.status = "settled";
          r.settled_at = settled_at;
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }
      if (/UPDATE paga_offramps SET status='failed'/i.test(sql)) {
        const [reason, failed_at, id] = args as [string, number, string];
        const r = offramps.get(id);
        if (r && r.status === "remitting") {
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
}));

function sign(body: string): string {
  return createHmac("sha512", HMAC_KEY).update(body).digest("hex");
}
function webhookReq(body: string, hash: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (hash) headers["hash"] = hash;
  return new Request("http://test.local/api/offramp/paga/webhook", {
    method: "POST",
    headers,
    body,
  });
}

describe("Paga settlement webhook", () => {
  beforeEach(() => {
    offramps.clear();
    events.clear();
    offramps.set("payout-1", {
      id: "payout-1",
      status: "remitting",
      paga_reference: "paga-tx-1",
      settled_at: null,
      failed_at: null,
      status_reason: null,
    });
  });

  it("settles a remitting payout on a valid SUCCESSFUL callback", async () => {
    const { POST } = await import("@/app/api/offramp/paga/webhook/route");
    const body = JSON.stringify({ referenceNumber: "payout-1", transactionStatus: "SUCCESSFUL" });
    const res = await POST(webhookReq(body, sign(body)));
    expect(res.status).toBe(200);
    expect(offramps.get("payout-1")?.status).toBe("settled");
    expect(offramps.get("payout-1")?.settled_at).toBeTypeOf("number");
    const ev = [...events.values()][0];
    expect(ev.signature_ok).toBe(1);
    expect(ev.offramp_id).toBe("payout-1");
  });

  it("fails a remitting payout on a valid FAILED callback", async () => {
    const { POST } = await import("@/app/api/offramp/paga/webhook/route");
    const body = JSON.stringify({ reference: "paga-tx-1", status: "FAILED" });
    const res = await POST(webhookReq(body, sign(body)));
    expect(res.status).toBe(200);
    expect(offramps.get("payout-1")?.status).toBe("failed");
  });

  it("rejects an invalid signature and does NOT touch the payout", async () => {
    const { POST } = await import("@/app/api/offramp/paga/webhook/route");
    const body = JSON.stringify({ referenceNumber: "payout-1", transactionStatus: "SUCCESSFUL" });
    const res = await POST(webhookReq(body, "deadbeef"));
    expect(res.status).toBe(401);
    expect(offramps.get("payout-1")?.status).toBe("remitting");
    expect([...events.values()][0]?.signature_ok).toBe(0);
  });

  it("is idempotent on an exact redelivery", async () => {
    const { POST } = await import("@/app/api/offramp/paga/webhook/route");
    const body = JSON.stringify({ referenceNumber: "payout-1", transactionStatus: "SUCCESSFUL" });
    const h = sign(body);
    const first = await POST(webhookReq(body, h));
    expect(first.status).toBe(200);
    const second = await POST(webhookReq(body, h));
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);
    expect(events.size).toBe(1); // only one event row logged
  });

  it("404s a valid callback for an unknown reference", async () => {
    const { POST } = await import("@/app/api/offramp/paga/webhook/route");
    const body = JSON.stringify({ referenceNumber: "does-not-exist", transactionStatus: "SUCCESSFUL" });
    const res = await POST(webhookReq(body, sign(body)));
    expect(res.status).toBe(404);
  });
});
