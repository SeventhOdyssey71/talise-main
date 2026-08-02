import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { filterVerified } from "@/lib/coins-verified";
import { cetusUniverse, normCoinType } from "@/lib/cetus-tokens";
import { logoForSymbol } from "@/lib/token-logos";
import { getSuiUsdcPrice } from "@/lib/deepbook";
import { sui } from "@/lib/sui";
import { memoTtl } from "@/lib/perf-cache";

export const runtime = "nodejs";

/**
 * GET /api/wallet/balances, every coin in the authed user's PLAIN wallet,
 * enriched for the Token Bucket UI.
 *
 * "Verified" = the coin has a liquid Cetus pool (coins-verified.ts, which now
 * pulls the live Cetus universe), so real holdings like WAL/DEEP/BUCK show and
 * are swappable while no-liquidity spam never appears. Each coin is enriched
 * with on-chain metadata (symbol, decimals, logo via the gRPC coin registry) and
 * a USD value where the price is reliable (stablecoins 1:1, SUI via DeepBook).
 *
 * Returns: { address, balances: [{ coinType, amount, isUsdsui, symbol,
 *            decimals, logoUrl, usdValue }] }. `usdValue` is null when there is
 * no trustworthy price (the amount + symbol still render).
 */

type CoinMeta = { symbol: string; decimals: number; logoUrl: string | null };

async function coinMetadata(coinType: string): Promise<CoinMeta> {
  return memoTtl(`coinmeta:${coinType}`, 24 * 60 * 60 * 1000, async () => {
    try {
      const r = (await sui().getCoinMetadata({ coinType })) as {
        coinMetadata?: { symbol?: string; decimals?: number; iconUrl?: string | null } | null;
      };
      const m = r.coinMetadata;
      if (m) {
        return {
          symbol: m.symbol ?? "",
          decimals: typeof m.decimals === "number" ? m.decimals : 9,
          logoUrl: m.iconUrl ?? null,
        };
      }
    } catch {
      /* fall through to default */
    }
    return { symbol: "", decimals: 9, logoUrl: null };
  });
}

/** Best-effort ticker from the type tag's final `::Name` segment. */
function shortSymbol(coinType: string): string {
  const last = coinType.split("::").pop();
  return last && last.length ? last.toUpperCase() : coinType.slice(0, 6);
}

export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  // WAS raw JSON-RPC (`suix_getAllBalances` against SUI_RPC_URL, defaulting to
  // the public fullnode). Public fullnodes now answer every JSON-RPC method
  // with -32601 "JSON-RPC on public fullnodes has been deprecated", which this
  // route turned into a 502, so the Token Bucket sheet rendered nothing at all
  // while the gRPC-backed headline balance kept working. Now gRPC, like the
  // rest of the app. Note the lint gate did not catch this: it greps for the
  // legacy SDK client class and its import path, and a hand-rolled fetch that
  // POSTs a `suix_*` method name matches neither. See scripts/lint-no-jsonrpc.sh.
  let rows: Array<{ coinType: string; totalBalance: string }>;
  try {
    const res = (await sui().listBalances({ owner: user.sui_address })) as {
      balances?: Array<{ coinType?: string; balance?: string }>;
    };
    rows = (res.balances ?? [])
      .filter((b) => b.coinType)
      .map((b) => ({ coinType: b.coinType as string, totalBalance: b.balance ?? "0" }));
  } catch (err) {
    return NextResponse.json(
      { error: "balance read failed: " + (err as Error).message },
      { status: 502 }
    );
  }

  const nonZero = rows.filter(
    (r) => r.coinType && BigInt(r.totalBalance ?? "0") > 0n
  );
  // Only coins with a liquid Cetus pool (or the hardcoded floor) survive, so
  // spam never appears and everything shown is actually swappable.
  const verified = await filterVerified(nonZero);

  // Price inputs (best-effort, never block the response).
  let suiPrice = 0;
  try {
    suiPrice = await getSuiUsdcPrice();
  } catch {
    /* leave 0 → SUI value omitted */
  }
  const cetus = await cetusUniverse();

  const balances = await Promise.all(
    verified.map(async (r) => {
      const meta = await coinMetadata(r.coinType);
      const norm = normCoinType(r.coinType);
      const symbol =
        meta.symbol || cetus.symbol.get(norm) || shortSymbol(r.coinType);
      const decimals = meta.decimals;
      const human = Number(BigInt(r.totalBalance)) / Math.pow(10, decimals);
      const isUsdsui = r.coinType === USDSUI_TYPE;
      const low = r.coinType.toLowerCase();

      // USD value: USDsui is exactly 1:1; otherwise use the Cetus-derived price
      // (anchored on the $1 stables). Fall back to the old stable/SUI heuristics
      // only when Cetus has no price for the coin.
      let usdValue: number | null = null;
      const cetusPrice = cetus.priceUsd.get(norm);
      if (isUsdsui) {
        usdValue = human;
      } else if (cetusPrice != null && cetusPrice > 0) {
        usdValue = human * cetusPrice;
      } else if (low.includes("::usdc::")) {
        usdValue = human;
      } else if (low.includes("::sui::sui")) {
        usdValue = suiPrice > 0 ? human * suiPrice : null;
      }

      // Logo: curated PNGs first (AsyncImage-safe for the majors), then the
      // on-chain icon, then the Cetus pool logo (some are SVG, fine on web; the
      // iOS gradient-initial fallback covers any that don't decode).
      const logoUrl =
        logoForSymbol(symbol) || meta.logoUrl || cetus.logo.get(norm) || null;

      return {
        coinType: r.coinType,
        amount: r.totalBalance,
        isUsdsui,
        symbol,
        decimals,
        logoUrl,
        usdValue,
      };
    })
  );

  return NextResponse.json({
    address: user.sui_address,
    balances,
  });
}
