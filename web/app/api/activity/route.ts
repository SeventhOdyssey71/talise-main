import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getRecentActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const entries = await getRecentActivity(user.sui_address, limit, {
      includeNonTalise: true,
    });
    return NextResponse.json({
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
    });
  } catch (err) {
    console.warn(`[api/activity] failed: ${(err as Error).message}`);
    // Soft fail — HomeView falls back to "Nothing here yet".
    return NextResponse.json({ entries: [] });
  }
}
