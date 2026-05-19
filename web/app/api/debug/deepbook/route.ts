import { NextResponse } from "next/server";
import { getSuiUsdcPrice, getMarginPoolInfo } from "@/lib/deepbook";
import { network } from "@/lib/sui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [suiUsdc, usdc, sui] = await Promise.all([
    getSuiUsdcPrice(),
    getMarginPoolInfo("USDC"),
    getMarginPoolInfo("SUI"),
  ]);
  return NextResponse.json({
    network: network(),
    sui_usdc_price: suiUsdc,
    margin: { usdc, sui },
    ts: new Date().toISOString(),
  });
}
