import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getSuiBalance, getUsdsuiBalance } from "@/lib/sui";
import { getSuiUsdcPrice } from "@/lib/deepbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/balances — aggregate balances for the authed user's wallet.
 *
 * Returns USDsui (1:1 USD), SUI (raw + USD-valued via the SUI/USDC
 * DeepBook spot), and the rolled-up total. HomeView's $15,003.86-style
 * figure binds to `totalUsd`.
 *
 * Three RPC legs in parallel. Each leg falls back to zero on RPC error
 * so the UI never wedges on a flaky validator — the displayed total is
 * always a number.
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

  const [sui, usdsui, suiPrice] = await Promise.all([
    getSuiBalance(user.sui_address).catch(() => ({ sui: 0, mist: "0" })),
    getUsdsuiBalance(user.sui_address).catch(() => ({ usdsui: 0, raw: "0" })),
    getSuiUsdcPrice().catch(() => 0),
  ]);

  const totalUsd = usdsui.usdsui + sui.sui * (suiPrice || 0);
  return NextResponse.json({
    address: user.sui_address,
    usdsui: usdsui.usdsui,
    sui: sui.sui,
    suiPriceUsd: suiPrice,
    totalUsd,
  });
}
