/**
 * Unit tests for the off-ramp refund path (web/lib/offramp-refund.ts).
 * Mocks @/lib/db (in-memory paga_offramps + userById) and injects a transfer
 * stub, so we exercise the idempotency + state machine without touching chain:
 *   • refunds a failed, un-refunded row exactly once
 *   • idempotent — a second call does NOT re-send
 *   • won't refund a non-failed row, or one already in progress
 *   • leaves the row pending (refund_failed) when the treasury key is absent
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.OFFRAMP_TREASURY_SK = "test-treasury-sk";

interface Row {
  id: string;
  user_id: string;
  usdsui_amount: number;
  status: string;
  refund_digest: string | null;
  refund_state: string | null;
  refunded_at: number | null;
}
const rows = new Map<string, Row>();

vi.mock("@/lib/db", () => ({
  ensureSchema: vi.fn(async () => {}),
  userById: vi.fn(async (id: number) => ({ id, sui_address: "0xuser000000000000000000000000000000000000000000000000000000000001" })),
  db: vi.fn(() => ({
    execute: async (arg: string | { sql: string; args?: ReadonlyArray<unknown> }) => {
      const sql = (typeof arg === "string" ? arg : arg.sql).trim();
      const args = (typeof arg === "string" ? [] : arg.args ?? []) as unknown[];
      if (/^SELECT id, user_id, usdsui_amount, status, refund_digest/i.test(sql)) {
        const [id] = args as [string];
        const r = rows.get(id);
        return { rows: r ? [r as unknown as Record<string, unknown>] : [], rowsAffected: 0 };
      }
      if (/SET refund_state='refunding'/i.test(sql)) {
        const [id] = args as [string];
        const r = rows.get(id);
        const eligible =
          r && r.status === "failed" && !r.refund_digest &&
          (r.refund_state === null || r.refund_state === "refund_failed");
        if (eligible) { r!.refund_state = "refunding"; return { rows: [], rowsAffected: 1 }; }
        return { rows: [], rowsAffected: 0 };
      }
      if (/SET refund_state='refunded'/i.test(sql)) {
        const [digest, ts, id] = args as [string, number, string];
        const r = rows.get(id);
        if (r) { r.refund_state = "refunded"; r.refund_digest = digest; r.refunded_at = ts; }
        return { rows: [], rowsAffected: 1 };
      }
      if (/SET refund_state='refund_failed'/i.test(sql)) {
        const [id] = args as [string];
        const r = rows.get(id);
        if (r) r.refund_state = "refund_failed";
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 0 };
    },
    batch: async () => [],
  })),
}));

function seed(status: string, extra: Partial<Row> = {}) {
  rows.set("p1", {
    id: "p1", user_id: "1", usdsui_amount: 10, status,
    refund_digest: null, refund_state: null, refunded_at: null, ...extra,
  });
}

describe("refundOfframp", () => {
  let transfer: ReturnType<typeof vi.fn> & ((to: string, micros: bigint) => Promise<string>);
  beforeEach(() => {
    rows.clear();
    transfer = vi.fn(async () => "REFUND_DIGEST") as typeof transfer;
    process.env.OFFRAMP_TREASURY_SK = "test-treasury-sk";
  });

  it("refunds a failed, un-refunded payout exactly once", async () => {
    const { refundOfframp } = await import("@/lib/offramp-refund");
    seed("failed");
    const res = await refundOfframp("p1", transfer);
    expect(res.refunded).toBe(true);
    expect(res.digest).toBe("REFUND_DIGEST");
    expect(transfer).toHaveBeenCalledTimes(1);
    const r = rows.get("p1")!;
    expect(r.refund_state).toBe("refunded");
    expect(r.refund_digest).toBe("REFUND_DIGEST");
  });

  it("is idempotent — a second call does not re-send", async () => {
    const { refundOfframp } = await import("@/lib/offramp-refund");
    seed("failed");
    await refundOfframp("p1", transfer);
    const again = await refundOfframp("p1", transfer);
    expect(again.refunded).toBe(false);
    expect(transfer).toHaveBeenCalledTimes(1); // not 2
  });

  it("won't refund a non-failed payout", async () => {
    const { refundOfframp } = await import("@/lib/offramp-refund");
    seed("remitting");
    const res = await refundOfframp("p1", transfer);
    expect(res.refunded).toBe(false);
    expect(transfer).not.toHaveBeenCalled();
  });

  it("won't double-claim a refund already in progress", async () => {
    const { refundOfframp } = await import("@/lib/offramp-refund");
    seed("failed", { refund_state: "refunding" });
    const res = await refundOfframp("p1", transfer);
    expect(res.refunded).toBe(false);
    expect(transfer).not.toHaveBeenCalled();
  });

  it("leaves the row pending when the treasury key is absent", async () => {
    delete process.env.OFFRAMP_TREASURY_SK;
    const { refundOfframp } = await import("@/lib/offramp-refund");
    seed("failed");
    const res = await refundOfframp("p1", transfer);
    expect(res.refunded).toBe(false);
    expect(res.reason).toMatch(/not configured/i);
    expect(transfer).not.toHaveBeenCalled();
    expect(rows.get("p1")!.refund_state).toBe("refund_failed"); // retried by cron later
    process.env.OFFRAMP_TREASURY_SK = "test-treasury-sk";
  });
});
