import { NextResponse } from "next/server";
import { cetusUniverse, normCoinType } from "@/lib/cetus-tokens";

export const dynamic = "force-dynamic";

/** TEMPORARY: verify the Cetus-derived price + logo maps on Vercel. Deleted next. */
export async function GET() {
  const u = await cetusUniverse();
  const wanted: Record<string, string> = {
    SUI: "0x2::sui::SUI",
    USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  };
  const out: Record<string, unknown> = {
    coins: u.priceUsd.size,
    logos: u.logo.size,
    verified: u.verified.size,
  };
  const bySym: Record<string, { price?: number; logo?: string }> = {};
  for (const [type, sym] of u.symbol) {
    const S = sym.toUpperCase();
    if (["SUI", "WAL", "DEEP", "USDC", "USDSUI", "CETUS", "HASUI"].includes(S) && !bySym[S]) {
      bySym[S] = { price: u.priceUsd.get(type), logo: u.logo.get(type) };
    }
  }
  out.bySymbol = bySym;
  out.byKnownType = Object.fromEntries(
    Object.entries(wanted).map(([k, t]) => [
      k,
      { price: u.priceUsd.get(normCoinType(t)), logo: u.logo.get(normCoinType(t)) },
    ])
  );
  return NextResponse.json(out);
}
