import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getRecentActivity, type ActivityEntry } from "@/lib/activity";
import { memoTtl } from "@/lib/perf-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cache the (heavy) chain scan per (address, limit). The scan issues
 * two `queryTransactionBlocks` calls + a counterparty-name resolution
 * fan-out — 1-3 seconds cold. The TTL is kept short on purpose: the
 * iOS optimistic-tx flow (`HomeView.applyOptimisticTx`) schedules a
 * "reconcile" reload 1.5s after a send, then `loadActivity` overwrites
 * `activity` with the server response. A longer TTL here would serve
 * pre-tx data into that reconcile window and visibly wipe the
 * optimistic row off screen. 5s captures the common cases (appear +
 * foreground + pull-to-refresh thrash, both `.task` modifiers in
 * HomeView racing on first render) without crossing the 1.5s
 * reconcile boundary.
 */
const ACTIVITY_CACHE_TTL_MS = 5_000;

function cachedActivity(
  address: string,
  limit: number,
  vaultId: string | null
): Promise<ActivityEntry[]> {
  // Vault id is part of the cache key so users mid-flight (vault just
  // recorded after the first activity load) get a fresh scan instead
  // of a stale wallet-only render.
  const vaultKey = vaultId ? vaultId.toLowerCase() : "novault";
  return memoTtl(
    `activity:${address.toLowerCase()}:${limit}:${vaultKey}`,
    ACTIVITY_CACHE_TTL_MS,
    () =>
      getRecentActivity(address, limit, {
        includeNonTalise: true,
        vaultId,
      })
  );
}

/**
 * GET /api/activity?limit=20 — recent on-chain activity for the authed
 * user, served from the same chain-scanner that the web /home and
 * /rewards pages read. Source of truth is the chain, not our local
 * tx_history cache — so sends initiated outside Talise still appear.
 *
 * Response is the iOS-friendly shape: { entries: [...] } where each
 * entry has the fields HomeView needs to render a row (icon + title +
 * subtitle + amount + signed delta).
 */
export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 20);
  const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 20));

  try {
    // Mobile feed shows every USDsui/SUI movement, not just Talise
    // payment-kit txs — users want to see incoming funding from any
    // wallet, not a curated subset.
    const entries = await cachedActivity(
      user.sui_address,
      limit,
      user.talise_vault_id ?? null
    );
    return NextResponse.json(
      {
        entries: entries.map((e) => ({
          digest: e.digest,
          timestampMs: e.timestampMs,
          direction: e.direction,
          amountUsdsui: e.amountUsdsui,
          amountSui: e.amountSui,
          counterparty: e.counterparty,
          counterpartyName: e.counterpartyName,
          venue: e.venue,
          // Compound spend+save flag — when set, iOS renders the row as
          // "Sent + saved" with both amounts. Null on non-compound rows.
          roundupUsdsui: e.roundupUsdsui,
          // Non-USDsui / non-SUI coin movement. Set when the user
          // sent/received WAL, USDC, USDT, etc. iOS renders the
          // amount as "+ 10 WAL" with `decimals` for client-side
          // formatting; the row appears even though we don't have a
          // USD value for the coin.
          otherCoin: e.otherCoin,
        })),
      },
      {
        headers: {
          // Edge-cache short window so repeat hits in the same render
          // path (HomeView .task + .refreshable racing on appear) don't
          // even hit our function. Stays below the 1.5s optimistic-tx
          // reconcile so a post-send refresh sees fresh chain data.
          // `private` because the body is keyed by the authed user.
          "Cache-Control":
            "private, max-age=0, s-maxage=3, stale-while-revalidate=15",
        },
      }
    );
  } catch (err) {
    console.warn(`[api/activity] failed: ${(err as Error).message}`);
    // Soft fail — HomeView falls back to "Nothing here yet".
    return NextResponse.json({ entries: [] });
  }
}
