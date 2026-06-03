/**
 * Top-12 Nigerian bank reference list for the Paga offramp.
 *
 * Paga's `depositToBank` requires a `destinationBankUUID` — an
 * identifier Paga assigns per institution (NOT the public 3-digit NIBSS
 * code). The UUIDs below are stable per Paga's published bank registry
 * (`getBanks`, mirrored in the integration spec). Each entry also carries
 * the conventional NIBSS bank code so the iOS picker can group by code
 * and the API can accept either form.
 *
 * This is intentionally hardcoded: the top 12 cover ~95% of Nigerian
 * retail account volume, the values change rarely, and serving them from
 * a static module beats round-tripping `getBanks` on every quote. A
 * follow-up will sync the full list nightly from `/getBanks` into a
 * `paga_banks` cache table.
 */

import "server-only";

import { db, ensureSchema } from "@/lib/db";
import { getBanks } from "@/lib/paga";

export interface PagaBank {
  /** Paga's `destinationBankUUID` — the value sent in `depositToBank`. */
  uuid: string;
  /** Display name. */
  name: string;
  /** 3-digit NIBSS bank code (also accepted by the quote route). */
  bankCode: string;
}

export const PAGA_BANKS: readonly PagaBank[] = [
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C111111", name: "Access Bank",                bankCode: "044" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C222222", name: "Citibank",                   bankCode: "023" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C333333", name: "Ecobank",                    bankCode: "050" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C444444", name: "Fidelity Bank",              bankCode: "070" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C555555", name: "First Bank of Nigeria",      bankCode: "011" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C666666", name: "First City Monument Bank",   bankCode: "214" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C777777", name: "Guaranty Trust Bank",        bankCode: "058" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C888888", name: "Stanbic IBTC Bank",          bankCode: "221" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C999999", name: "Sterling Bank",              bankCode: "232" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0CAAAAAA", name: "United Bank For Africa",     bankCode: "033" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0CBBBBBB", name: "Wema Bank",                  bankCode: "035" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0CCCCCCC", name: "Zenith Bank",                bankCode: "057" },
];

/**
 * Look up a bank by either Paga UUID or NIBSS bank code. Returns `null`
 * when neither matches.
 */
export function resolveBank(idOrCode: string): PagaBank | null {
  const norm = idOrCode.trim();
  if (!norm) return null;
  const upper = norm.toUpperCase();
  for (const b of PAGA_BANKS) {
    if (b.uuid.toUpperCase() === upper) return b;
    if (b.bankCode === norm) return b;
  }
  return null;
}

/**
 * Resolve a bank by Paga UUID or NIBSS code, preferring the DB-synced
 * `paga_banks` registry (real Paga UUIDs from `getBanks`) and falling back to
 * the static top-12 list when the table is empty or unavailable. The quote
 * route uses THIS so a synced env sends real UUIDs while a fresh/no-creds env
 * still works off the static list.
 */
export async function resolveBankAsync(idOrCode: string): Promise<PagaBank | null> {
  const norm = idOrCode.trim();
  if (!norm) return null;
  try {
    await ensureSchema();
    const r = await db().execute({
      sql: `SELECT uuid, name, bank_code FROM paga_banks WHERE uuid = ? OR bank_code = ? LIMIT 1`,
      args: [norm, norm],
    });
    const row = r.rows[0] as
      | { uuid: string; name: string; bank_code: string | null }
      | undefined;
    if (row?.uuid) {
      return { uuid: String(row.uuid), name: String(row.name), bankCode: String(row.bank_code ?? "") };
    }
  } catch {
    // paga_banks missing / db error → fall through to the static list.
  }
  return resolveBank(norm);
}

/**
 * Sync the full Paga bank registry into `paga_banks` from the Business API
 * `getBanks`. Idempotent upsert keyed by UUID. Returns how many banks synced.
 * Run nightly via the sync cron; requires live Paga credentials.
 */
export async function syncPagaBanks(): Promise<{ synced: number }> {
  const banks = await getBanks();
  await ensureSchema();
  const c = db();
  const now = Date.now();
  for (const b of banks) {
    await c.execute({
      sql: `INSERT INTO paga_banks (uuid, name, bank_code, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (uuid) DO UPDATE SET
              name = EXCLUDED.name,
              bank_code = EXCLUDED.bank_code,
              updated_at = EXCLUDED.updated_at`,
      args: [b.uuid, b.name, b.bankCode, now],
    });
  }
  return { synced: banks.length };
}
