import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getSuiBalance, getUsdsuiBalance } from "@/lib/sui";
import { getSuiUsdcPrice } from "@/lib/deepbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const pricePromise = withTimeout(
    getSuiUsdcPrice().catch(() => 0),
    600,
    0
  );

  const usdsui = await usdsuiPromise;
  const [sui, suiPrice] = await Promise.all([suiPromise, pricePromise]);

  const totalUsd = usdsui.usdsui + sui.sui * (suiPrice || 0);
  return NextResponse.json({
    address: user.sui_address,
    usdsui: usdsui.usdsui,
    sui: sui.sui,
    suiPriceUsd: suiPrice,
    totalUsd,
  });
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
