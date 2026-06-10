import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/overview — top-level KPIs across the whole database.
 * One round of aggregate queries; resilient (a failed sub-query yields
 * 0 / [] rather than 500-ing the page).
 */

async function scalar(sql: string, args: ReadonlyArray<unknown> = []): Promise<number> {
  try {
    const r = await db().execute({ sql, args });
    const v = r.rows[0] ? Object.values(r.rows[0])[0] : 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function groupCounts(
  sql: string,
  args: ReadonlyArray<unknown> = []
): Promise<Array<{ key: string; count: number }>> {
  try {
    const r = await db().execute({ sql, args });
    return r.rows.map((row) => {
      const vals = Object.values(row);
      return { key: String(vals[0] ?? "—"), count: Number(vals[1] ?? 0) };
    });
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const denied = await requireAdminApi(req);
  if (denied) return denied;

  await ensureSchema().catch(() => {});

  const now = Date.now();
  const day = now - 24 * 60 * 60 * 1000;
  const week = now - 7 * 24 * 60 * 60 * 1000;

  const [
    usersTotal,
    usersNew24h,
    usersNew7d,
    usersByTier,
    usersByType,
    waitlistTotal,
    waitlistConfirmed,
    waitlistClaimed,
    waitlistLegacy,
    txTotal,
    txNew24h,
    transfersTotal,
    transfersByState,
    transfersParked,
    linqTotal,
    linqByStatus,
    invoicesTotal,
    invoicesPaid,
    roundupPending,
    kycIntents,
    travelRecords,
    floatPools,
    floatUsdc,
    rewardsEvents,
    redemptions,
    savingsGoals,
  ] = await Promise.all([
    scalar(`SELECT COUNT(*) FROM users`),
    scalar(`SELECT COUNT(*) FROM users WHERE created_at >= $1`, [day]),
    scalar(`SELECT COUNT(*) FROM users WHERE created_at >= $1`, [week]),
    groupCounts(`SELECT COALESCE(kyc_tier,0) AS t, COUNT(*) FROM users GROUP BY 1 ORDER BY 1`),
    groupCounts(`SELECT COALESCE(account_type,'personal') AS t, COUNT(*) FROM users GROUP BY 1 ORDER BY 2 DESC`),
    scalar(`SELECT COUNT(*) FROM waitlist_signups`),
    scalar(`SELECT COUNT(*) FROM waitlist_signups WHERE confirmation_sent = true`),
    scalar(`SELECT COUNT(*) FROM waitlist_signups WHERE claimed_handle IS NOT NULL`),
    scalar(`SELECT COUNT(*) FROM waitlist`),
    scalar(`SELECT COUNT(*) FROM tx_history`),
    scalar(`SELECT COUNT(*) FROM tx_history WHERE created_at >= $1`, [day]),
    scalar(`SELECT COUNT(*) FROM transfers`),
    groupCounts(`SELECT state, COUNT(*) FROM transfers GROUP BY state ORDER BY 2 DESC`),
    scalar(`SELECT COUNT(*) FROM transfers WHERE parked_funds = true`),
    scalar(`SELECT COUNT(*) FROM linq_offramps`),
    groupCounts(`SELECT status, COUNT(*) FROM linq_offramps GROUP BY status ORDER BY 2 DESC`),
    scalar(`SELECT COUNT(*) FROM invoices`),
    scalar(`SELECT COUNT(*) FROM invoices WHERE status = 'paid'`),
    scalar(`SELECT COUNT(*) FROM roundup_queue WHERE processed_at IS NULL`),
    scalar(`SELECT COUNT(*) FROM kyc_upgrade_intents`),
    scalar(`SELECT COUNT(*) FROM travel_rule_records`),
    scalar(`SELECT COUNT(*) FROM float_pools`),
    scalar(`SELECT COALESCE(SUM(usdc_pool),0) FROM float_pools`),
    scalar(`SELECT COUNT(*) FROM rewards_events`),
    scalar(`SELECT COUNT(*) FROM redemptions`),
    scalar(`SELECT COUNT(*) FROM savings_goals WHERE archived = 0`),
  ]);

  // Roll transfers + linq off-ramp states up into success / pending / failed.
  const SUCCESS = new Set(["settled", "onchain_settled"]);
  const FAILED = new Set(["failed", "refunded", "rejected"]);
  function rollup(rows: Array<{ key: string; count: number }>) {
    let success = 0,
      failed = 0,
      pending = 0;
    for (const { key, count } of rows) {
      const k = key.toLowerCase();
      if (SUCCESS.has(k) || /success|paid|complete|settled/.test(k)) success += count;
      else if (FAILED.has(k) || /fail|refund|reject|cancel|expire/.test(k)) failed += count;
      else pending += count;
    }
    return { success, pending, failed };
  }
  const transferRoll = rollup(transfersByState);
  const linqRoll = rollup(linqByStatus);

  // tx_history rows are recorded only after on-chain confirmation → all
  // count as successful.
  const txSuccess = txTotal + transferRoll.success + linqRoll.success;
  const txPending = transferRoll.pending + linqRoll.pending;
  const txFailed = transferRoll.failed + linqRoll.failed;

  return NextResponse.json({
    generatedAt: now,
    users: {
      total: usersTotal,
      new24h: usersNew24h,
      new7d: usersNew7d,
      byTier: usersByTier,
      byType: usersByType,
    },
    waitlist: {
      total: waitlistTotal,
      confirmed: waitlistConfirmed,
      claimedHandles: waitlistClaimed,
      legacy: waitlistLegacy,
    },
    transactions: {
      onchain: txTotal,
      onchain24h: txNew24h,
      transfers: transfersTotal,
      linq: linqTotal,
      success: txSuccess,
      pending: txPending,
      failed: txFailed,
      transfersByState,
      linqByStatus,
      parked: transfersParked,
    },
    commerce: {
      invoicesTotal,
      invoicesPaid,
      rewardsEvents,
      redemptions,
      savingsGoals,
    },
    compliance: {
      kycIntents,
      travelRecords,
      floatPools,
      floatUsdc,
      roundupPending,
    },
  });
}
