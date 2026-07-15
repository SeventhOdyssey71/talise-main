import { NextResponse } from "next/server";
import { WATERX_ENABLED, listMarkets } from "@/lib/waterx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/markets — live WaterX perp markets on Sui mainnet (read-only).
 *
 * No signer, no funds: each market is read via gRPC `simulateTransaction`.
 * Gated behind FEATURE_PERPS → 503 when disabled.
 */
export async function GET() {
  if (!WATERX_ENABLED) {
    return NextResponse.json(
      { error: "Perps aren't enabled.", code: "PERPS_DISABLED" },
      { status: 503 },
    );
  }
  try {
    const markets = await listMarkets();
    return NextResponse.json(
      { venue: "WaterX", network: "mainnet", collateral: "USDsui", markets },
      { headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=15" } },
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? "read failed" }, { status: 502 });
  }
}
