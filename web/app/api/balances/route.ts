import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getSuiBalance, getUsdsuiBalance } from "@/lib/sui";
import { getSuiUsdcPrice } from "@/lib/deepbook";
import { memoTtl } from "@/lib/perf-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SUI/USD spot is a global value — every user sees the same number, so
 * cache it process-wide. DeepBook level-2 quotes cost 800-2000ms; serving
 * a 45s-old price is fine for a balance display (the headline number is
 * USDsui anyway, and the SUI side is sweep-banner UX). With this cache,
 * the price slot effectively never trips the 600ms timeout below.
 */
const PRICE_CACHE_TTL_MS = 45_000;
function cachedSuiUsdcPrice(): Promise<number> {
  return memoTtl("sui-usdc-price", PRICE_CACHE_TTL_MS, () =>
    getSuiUsdcPrice().catch(() => 0)
  );
}

/**
 * GET /api/balances — wallet balance snapshot for the authed user.
 *
 * Critical path is USDsui (the only unit iOS displays). SUI balance +
 * spot price are returned alongside but populated in the background —
 * the sweep banner / future flows use them, but they shouldn't gate
 * the headline number.
 *
 * Latency profile on mainnet (measured):
 *   getUsdsuiBalance:   ~600-1800ms (one sui_getBalance call)
 *   getSuiBalance:      ~400-800ms  (one sui_getBalance call)
 *   getSuiUsdcPrice:    ~800-2000ms (DeepBook level-2 quote)
 *
 * Old impl awaited Promise.all of all three — meaning the slowest leg
 * dictated the response time even though iOS only renders `usdsui`.
 * New impl awaits ONLY usdsui and fires the others off the critical
 * path. If they don't finish in 600ms they return 0; the sweep banner
 * polls again on the next refresh.
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

  // Critical: USDsui — the headline number. Wait for this.
  const usdsuiPromise = getUsdsuiBalance(user.sui_address).catch(() => ({
    usdsui: 0,
    raw: "0",
  }));

  // Best-effort: SUI balance + spot price for the sweep banner. Capped
  // at 600ms so a slow DeepBook quote doesn't block the response.
  const suiPromise = withTimeout(
    getSuiBalance(user.sui_address).catch(() => ({ sui: 0, mist: "0" })),
    600,
    { sui: 0, mist: "0" }
  );
  // Price is cached process-wide for 45s. The cached path returns in <1ms;
  // the cold path still respects the 600ms cap so a slow DeepBook quote
  // can't drag the response down.
  const pricePromise = withTimeout(
    cachedSuiUsdcPrice(),
    600,
    0
  );

  const usdsui = await usdsuiPromise;
  const [sui, suiPrice] = await Promise.all([suiPromise, pricePromise]);

  const totalUsd = usdsui.usdsui + sui.sui * (suiPrice || 0);
  // Edge cache: serve repeat hits within 3s from Vercel's CDN. Kept
  // below the 1.5s optimistic-tx reconcile (see HomeView.applyOptimisticTx)
  // so a post-send refresh sees fresh on-chain state. `private` keeps the
  // response from being shared across users — the body is per-user.
  return NextResponse.json(
    {
      address: user.sui_address,
      usdsui: usdsui.usdsui,
      sui: sui.sui,
      suiPriceUsd: suiPrice,
      totalUsd,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=0, s-maxage=3, stale-while-revalidate=15",
      },
    }
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
