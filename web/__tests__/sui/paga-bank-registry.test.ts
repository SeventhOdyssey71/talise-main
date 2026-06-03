/**
 * Unit tests for the Paga bank registry (web/lib/paga-banks.ts).
 *   • resolveBankAsync prefers the DB-synced `paga_banks` (real UUIDs) and
 *     falls back to the static top-12 list when the table is empty.
 *   • syncPagaBanks upserts the Business API `getBanks` result idempotently.
 * Mocks @/lib/db (in-memory paga_banks) and @/lib/paga (getBanks).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface BankRow {
  uuid: string;
  name: string;
  bank_code: string | null;
}
const banks = new Map<string, BankRow>();

vi.mock("@/lib/db", () => ({
  ensureSchema: vi.fn(async () => {}),
  db: vi.fn(() => ({
    execute: async (arg: string | { sql: string; args?: ReadonlyArray<unknown> }) => {
      const sql = (typeof arg === "string" ? arg : arg.sql).trim();
      const args = (typeof arg === "string" ? [] : arg.args ?? []) as unknown[];
      if (/SELECT uuid, name, bank_code FROM paga_banks WHERE uuid = \? OR bank_code = \?/i.test(sql)) {
        const [byUuid, byCode] = args as [string, string];
        const found =
          banks.get(byUuid) ?? [...banks.values()].find((b) => b.bank_code === byCode);
        return { rows: found ? [found as unknown as Record<string, unknown>] : [], rowsAffected: 0 };
      }
      if (/^INSERT INTO paga_banks/i.test(sql)) {
        const [uuid, name, bank_code] = args as [string, string, string | null];
        banks.set(uuid, { uuid, name, bank_code });
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 0 };
    },
    batch: async () => [],
  })),
}));

const getBanksMock = vi.fn();
vi.mock("@/lib/paga", () => ({ getBanks: getBanksMock }));

describe("Paga bank registry", () => {
  beforeEach(() => {
    banks.clear();
    getBanksMock.mockReset();
  });

  it("resolveBankAsync returns the DB-synced bank (real UUID) over the static list", async () => {
    const { resolveBankAsync } = await import("@/lib/paga-banks");
    banks.set("REAL-UUID-GTB", { uuid: "REAL-UUID-GTB", name: "Guaranty Trust Bank", bank_code: "058" });
    const b = await resolveBankAsync("058");
    expect(b?.uuid).toBe("REAL-UUID-GTB"); // not the static placeholder
    expect(b?.name).toBe("Guaranty Trust Bank");
  });

  it("resolveBankAsync falls back to the static list when the table is empty", async () => {
    const { resolveBankAsync } = await import("@/lib/paga-banks");
    const b = await resolveBankAsync("044");
    expect(b?.name).toBe("Access Bank"); // from the static PAGA_BANKS
    expect(b?.uuid).toMatch(/^3E94C4BC/);
  });

  it("resolveBankAsync returns null for an unknown bank", async () => {
    const { resolveBankAsync } = await import("@/lib/paga-banks");
    expect(await resolveBankAsync("999")).toBeNull();
    expect(await resolveBankAsync("")).toBeNull();
  });

  it("syncPagaBanks upserts the getBanks result and makes real UUIDs resolvable", async () => {
    getBanksMock.mockResolvedValue([
      { uuid: "PG-UUID-1", name: "Access Bank", bankCode: "044" },
      { uuid: "PG-UUID-2", name: "Kuda MFB", bankCode: "090267" },
    ]);
    const { syncPagaBanks, resolveBankAsync } = await import("@/lib/paga-banks");
    const { synced } = await syncPagaBanks();
    expect(synced).toBe(2);
    expect(banks.size).toBe(2);
    // A bank only Paga knows about (not in the static list) now resolves.
    const kuda = await resolveBankAsync("090267");
    expect(kuda?.uuid).toBe("PG-UUID-2");
    // Re-sync is idempotent (upsert, not duplicate).
    await syncPagaBanks();
    expect(banks.size).toBe(2);
  });
});
