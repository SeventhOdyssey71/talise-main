/**
 * Analytics data layer (live DB reads).
 *
 * Builds the AnalyticsSummary directly from the app ledger:
 *   • users      — total Talise accounts (deleted rows are tombstoned with a
 *                  `deleted:` sui_address, so we exclude them).
 *   • tx_history — every on-chain-confirmed transaction the app recorded
 *                  (kind/amount/asset/recipient/digest/created_at), already
 *                  indexed on created_at. Rows land only AFTER confirmation, so
 *                  counts and sums are authoritative.
 *
 * Stablecoin volume sums the human `amount` (a numeric TEXT column) for the
 * stablecoin assets (USDsui, USDC). Cross-asset swap legs are intentionally
 * excluded from the volume figure to avoid mixing units / double counting.
 *
 * Resilient like /api/admin/overview: a failed sub-query yields its zero/empty
 * fallback rather than throwing, so the dashboard always renders.
 */

import { db } from "@/lib/db";
import type { AnalyticsSummary, RecentTx } from "@/lib/analytics/types";

/** Assets that count toward "stablecoin volume". */
const STABLECOIN_ASSETS = ["USDsui", "USDC"];

/** How many recent transactions the table shows. */
const RECENT_LIMIT = 60;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length ? s : null;
}

/** Build the full live summary. */
export async function getSummary(): Promise<AnalyticsSummary> {
  // Total accounts — exclude the `deleted:<id>:<addr>` tombstones.
  const users = await db()
    .execute({
      sql: `SELECT COUNT(*) AS n FROM users WHERE sui_address NOT LIKE 'deleted:%'`,
      args: [],
    })
    .then((r) => num(r.rows[0]?.n))
    .catch(() => 0);

  // Total recorded transactions.
  const transactions = await db()
    .execute({ sql: `SELECT COUNT(*) AS n FROM tx_history`, args: [] })
    .then((r) => num(r.rows[0]?.n))
    .catch(() => 0);

  // Stablecoin volume: sum |amount| over USDsui/USDC rows. `amount` is a
  // regex-validated numeric TEXT on write; guard legacy/odd rows with a regex
  // so a stray value can't abort the CAST.
  const placeholders = STABLECOIN_ASSETS.map(() => "?").join(", ");
  const stablecoinVolumeUsd = await db()
    .execute({
      sql: `SELECT COALESCE(SUM(ABS(CAST(amount AS DOUBLE PRECISION))), 0) AS v
        FROM tx_history
        WHERE asset IN (${placeholders})
          AND amount IS NOT NULL
          AND amount ~ '^-?[0-9]+(\\.[0-9]+)?$'`,
      args: STABLECOIN_ASSETS,
    })
    .then((r) => num(r.rows[0]?.v))
    .catch(() => 0);

  // Recent transactions, joined to the sending user.
  const recent = await db()
    .execute({
      sql: `SELECT t.id, t.created_at, t.kind, t.amount, t.asset, t.recipient,
            t.digest, u.talise_username AS handle, u.sui_address AS address
        FROM tx_history t
        LEFT JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC NULLS LAST
        LIMIT ${RECENT_LIMIT}`,
      args: [],
    })
    .then((r) =>
      r.rows.map(
        (row): RecentTx => ({
          id: num(row.id),
          createdAt: num(row.created_at),
          kind: String(row.kind ?? ""),
          amount: numOrNull(row.amount),
          asset: strOrNull(row.asset),
          recipient: strOrNull(row.recipient),
          digest: String(row.digest ?? ""),
          handle: strOrNull(row.handle),
          address: strOrNull(row.address),
        })
      )
    )
    .catch((): RecentTx[] => []);

  return {
    totals: { users, stablecoinVolumeUsd, transactions },
    recent,
  };
}
