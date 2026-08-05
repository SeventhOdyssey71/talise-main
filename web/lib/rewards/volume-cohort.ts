import "server-only";

import { db } from "@/lib/db";
import { VOLUME_DIRECTIONS } from "@/lib/analytics/ledger";

/**
 * The reward cohort: accounts whose LIFETIME settled volume clears a threshold.
 *
 * Read straight from `analytics_tx_ledger`, which is keyed by transaction
 * digest and never trimmed, so a long-lived account cannot age out of its own
 * total the way a rolling activity feed would let it.
 *
 * VOLUME IS NOT "EVERYTHING THAT MOVED". It reuses `VOLUME_DIRECTIONS` from the
 * ledger module (`sent`, `swap`, `withdraw`, `invest`) — `received` is excluded
 * because it is the mirror side of `sent`, and counting both would pay a pair of
 * users twice for one payment passing between them. Using the same constant as
 * the published figure means an operator can reconcile this list against
 * talise.io/analytics instead of wondering which definition applies.
 *
 * READ-ONLY. Nothing here credits points, moves USDsui, or writes to the rewards
 * ledger; it answers "who qualifies", and distribution stays a separate,
 * deliberate step.
 */

export type VolumeCohortRow = {
  /** Null when the address has never been matched to an account. */
  userId: number | null;
  address: string;
  handle: string | null;
  email: string | null;
  /** Lifetime settled volume in USD, over the counted directions. */
  volumeUsd: number;
  txCount: number;
  /** Epoch ms of the most recent counted transaction. */
  lastActiveAt: number | null;
  createdAt: number | null;
};

export type VolumeCohort = {
  minUsd: number;
  rows: VolumeCohortRow[];
  /** Totals across the qualifying rows, for a sanity check before paying out. */
  totalVolumeUsd: number;
  /** Qualifying addresses with no matching `users` row — cannot be rewarded. */
  unmatched: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Literal, not interpolated from input — the direction list is a constant. */
const VOLUME_FILTER = `l.direction IN (${VOLUME_DIRECTIONS.map((d) => `'${d}'`).join(",")})`;

/**
 * Accounts at or above `minUsd` lifetime volume, richest first.
 *
 * `minUsd` is bound as a parameter rather than interpolated. The LEFT JOIN keeps
 * addresses that match no account so the caller can SEE the gap rather than
 * silently paying a shorter list than the cohort really is.
 */
export async function getVolumeCohort(minUsd = 10): Promise<VolumeCohort> {
  const min = Number.isFinite(minUsd) && minUsd >= 0 ? minUsd : 10;

  const r = await db().execute({
    sql: `SELECT l.address                       AS address,
                 SUM(l.amount_usd)               AS volume_usd,
                 COUNT(*)                        AS tx_count,
                 MAX(l.ts)                       AS last_active_at,
                 u.id                            AS user_id,
                 u.talise_username               AS handle,
                 u.email                         AS email,
                 u.created_at                    AS created_at
            FROM analytics_tx_ledger l
            LEFT JOIN users u ON u.sui_address = l.address
           WHERE ${VOLUME_FILTER}
             AND l.address IS NOT NULL
           GROUP BY l.address, u.id, u.talise_username, u.email, u.created_at
          HAVING SUM(l.amount_usd) >= $1
           ORDER BY SUM(l.amount_usd) DESC`,
    args: [min],
  });

  const rows: VolumeCohortRow[] = r.rows.map((row) => {
    const o = row as Record<string, unknown>;
    return {
      userId: o.user_id == null ? null : num(o.user_id),
      address: String(o.address ?? ""),
      handle: o.handle == null ? null : String(o.handle),
      email: o.email == null ? null : String(o.email),
      volumeUsd: num(o.volume_usd),
      txCount: num(o.tx_count),
      lastActiveAt: o.last_active_at == null ? null : num(o.last_active_at),
      createdAt: o.created_at == null ? null : num(o.created_at),
    };
  });

  return {
    minUsd: min,
    rows,
    totalVolumeUsd: rows.reduce((s, x) => s + x.volumeUsd, 0),
    unmatched: rows.filter((x) => x.userId == null).length,
  };
}

/**
 * CSV for the payout run. Amounts are written unrounded so the file is a record
 * of what qualified, not a pre-rounded payout instruction — whoever distributes
 * decides the reward per row.
 */
export function volumeCohortCsv(cohort: VolumeCohort): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = "user_id,handle,email,address,volume_usd,tx_count,last_active_at";
  const lines = cohort.rows.map((x) =>
    [
      esc(x.userId ?? ""),
      esc(x.handle ?? ""),
      esc(x.email ?? ""),
      esc(x.address),
      esc(x.volumeUsd.toFixed(2)),
      esc(x.txCount),
      esc(x.lastActiveAt ? new Date(x.lastActiveAt).toISOString() : ""),
    ].join(",")
  );
  return [head, ...lines].join("\n");
}
