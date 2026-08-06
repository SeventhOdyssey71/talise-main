import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { rateLimitAsync } from "@/lib/rate-limit";
import { userById } from "@/lib/db";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { AggregatorClient } from "@cetusprotocol/aggregator-sdk";
import { sui, network, COIN_TYPES } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { isVerifiedCoin } from "@/lib/coins-verified";
import { TREASURY_WALLET } from "@/lib/navi-supply";
import { onara } from "@/lib/onara";
import { memoTtl } from "@/lib/perf-cache";

export const runtime = "nodejs";

/**
 * POST /api/swap/prepare
 *
 * Wallet-conditioning swap: convert a non-USDsui Coin<T> in the user's
 * wallet into USDsui, sponsored by Onara. Mirrors the FUSED build pattern
 * from `/api/send/sponsor-prepare`'s sponsored branch, one round-trip,
 * sets sender + gasOwner + gasPrice, returns sponsor-ready bytes that iOS
 * signs and forwards to `/api/zk/sponsor-execute`.
 *
 * Body: { fromCoinType: string, fromAmountMicros: string }
 * Response: { bytes, mode: "sponsored-swap", from, to, fromMicros,
 *             estimatedToMicros, sponsor, gasPrice }
 *
 * Accepts any VERIFIED coin — the same set the token bucket displays.
 *
 * Slippage default 100 bps (1%). Surfaced via `estimatedToMicros` so iOS
 * can show "you'll receive ~$X" with the slippage cap applied to the
 * on-chain `minOut`.
 *
 * The output USDsui is transferred back to the user, never to a third
 * party. The combined "swap + send to recipient" flow is a follow-up.
 */

const SLIPPAGE_BPS = 100; // 1.00%
/** Talise swap fee, 1% of the swap output, routed to the treasury. Taken only
 *  on NON-stablecoin swaps (SUI, DEEP, …); stablecoin↔stablecoin swaps such as
 *  USDC → USDsui are fee-free. Taken natively via the aggregator overlay. */
const SWAP_FEE_BPS = 100; // 1.00% (non-stablecoin swaps only)
/** Stablecoin coin types. The swap target is always USDsui, so a stablecoin
 *  source (USDC) makes the whole swap stablecoin↔stablecoin → fee-free. */
const STABLE_TYPES = new Set<string>([COIN_TYPES.USDC, USDSUI_TYPE]);

// Routing is the Cetus aggregator's job: it searches 20+ Sui DEXs per request
// and returns the best fill. A hardcoded DeepBook route table used to live here
// alongside it, but nothing read it except the allowlist check — it decided
// which coins were *permitted*, never which pools were *used*. Removed rather
// than left in place looking authoritative.

/** Symbol label for the per-leg timing log line. */
function symbolFor(coinType: string): string {
  if (coinType === COIN_TYPES.SUI) return "SUI";
  if (coinType === COIN_TYPES.USDC) return "USDC";
  if (coinType === COIN_TYPES.DEEP) return "DEEP";
  return coinType.split("::").pop() ?? coinType;
}

export async function POST(req: Request) {
  const onaraUrl = process.env.ONARA_URL;
  if (!onaraUrl) {
    return NextResponse.json(
      { error: "ONARA_URL not configured" },
      { status: 503 }
    );
  }

  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  // Per-user global rate limit on this money route (anti-abuse / anti-DDoS).
  const rl = await rateLimitAsync({ key: `swap-prepare:user:${userId}`, limit: 30, windowSec: 3600 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } }
    );
  }
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { fromCoinType?: string; fromAmountMicros?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const fromCoinType = (body.fromCoinType ?? "").trim();
  const fromAmountStr = (body.fromAmountMicros ?? "").trim();
  if (!fromCoinType) {
    return NextResponse.json(
      { error: "fromCoinType required" },
      { status: 400 }
    );
  }
  if (fromCoinType === USDSUI_TYPE) {
    return NextResponse.json(
      { error: "fromCoinType must NOT be USDsui (already in destination)" },
      { status: 400 }
    );
  }
  // Swappable == what the token bucket shows. The bucket lists every VERIFIED
  // coin (Cetus registry + liquidity floor) and puts a "Swap to USDsui" button
  // on each, but this route used to accept only SUI, USDC and DEEP — so a real
  // holding like vSUI rendered a button that answered "This token can't be
  // swapped to USDsui yet." Sharing one gate makes the button's promise true by
  // construction, and the verified set is already the liquidity check: a coin
  // with no liquid Cetus pool never enters it, so the aggregator isn't asked to
  // route spam.
  if (!(await isVerifiedCoin(fromCoinType))) {
    return NextResponse.json(
      {
        error: "That token doesn't have enough on-chain liquidity to convert.",
        code: "SWAP_UNSUPPORTED",
      },
      { status: 400 }
    );
  }

  let fromMicros: bigint;
  try {
    fromMicros = BigInt(fromAmountStr);
  } catch {
    return NextResponse.json(
      { error: "fromAmountMicros must be a u64 string" },
      { status: 400 }
    );
  }
  if (fromMicros <= 0n) {
    return NextResponse.json(
      { error: "fromAmountMicros must be > 0" },
      { status: 400 }
    );
  }

  try {
    const tTotalStart = Date.now();

    // Kick off the two expensive remote lookups in parallel:
    // (a) Onara sponsor address, 60s memo.
    // (b) Reference gas price, 1.5s memo (per-epoch).
    const onaraClient = onara();
    const client = sui();
    const net = network();
    const sponsorPromise = memoTtl(
      `onara:status:${onaraUrl}`,
      60_000,
      () => onaraClient.status()
    );
    const gasPricePromise = memoTtl(
      `sui:gas-price:${net}`,
      1_500,
      async () => {
        const r = await client.getReferenceGasPrice();
        return r.referenceGasPrice;
      }
    );

    // ─── PTB build ──────────────────────────────────────────────────
    const tx = new Transaction();
    tx.setSender(user.sui_address);

    const tPtbStart = Date.now();
    let estimatedToMicros: bigint;

    // ─── Cetus aggregator swap ──────────────────────────────────────────
    // Route across 20+ Sui DEXs for the best fill (deeper than a single
    // DeepBook pair). The Talise fee is taken NATIVELY by the aggregator's
    // overlay fee → treasury during the swap (no manual coin split) — but ONLY
    // for non-stablecoin sources; USDC → USDsui is fee-free. Every swap stays
    // sponsored. Routing was verified live for SUI→USDsui.
    const swapFeeBps = STABLE_TYPES.has(fromCoinType) ? 0 : SWAP_FEE_BPS;
    const aggregator = new AggregatorClient({
      client,
      signer: user.sui_address,
      ...(swapFeeBps > 0
        ? {
            overlayFeeRate: swapFeeBps / 10_000, // → treasury
            overlayFeeReceiver: TREASURY_WALLET,
          }
        : {}),
    });
    // Bound the aggregator lookup: a slow/unresponsive Cetus router must not
    // hang the request. On timeout we fall through to the SAME NO_ROUTE / 503
    // path a missing route already takes (findRouters resolving null-ish).
    const ROUTE_TIMEOUT_MS = 10_000;
    const cetusRouter = await Promise.race([
      aggregator.findRouters({
        from: fromCoinType,
        target: USDSUI_TYPE,
        amount: fromMicros.toString(),
        byAmountIn: true,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ROUTE_TIMEOUT_MS)
      ),
    ]);
    if (!cetusRouter || cetusRouter.insufficientLiquidity) {
      return NextResponse.json(
        { error: "No swap route available right now. Try again shortly.", code: "NO_ROUTE" },
        { status: 503 }
      );
    }
    estimatedToMicros = BigInt(cetusRouter.amountOut.toString());

    // The input coin (the user's non-USDsui balance, never the gas coin,
    // which Onara owns in the sponsored leg).
    const inputCoin = tx.add(
      coinWithBalance({ type: fromCoinType, balance: fromMicros, useGasCoin: false })
    );
    const outCoin = await aggregator.routerSwap({
      router: cetusRouter,
      inputCoin,
      slippage: SLIPPAGE_BPS / 10_000, // 1.00%
      txb: tx,
    });
    // Send the swapped USDsui (net of the 1% overlay fee) to the user.
    tx.transferObjects([outCoin], user.sui_address);

    const tPtbDone = Date.now();

    // ─── Wrap: sponsor + gas price ─────────────────────────────────
    const [{ address: sponsor }, gasPrice] = await Promise.all([
      sponsorPromise,
      gasPricePromise,
    ]);

    tx.setGasOwner(sponsor);
    tx.setGasPrice(BigInt(gasPrice));

    const bytes = await tx.build({ client: client as never });

    const tDone = Date.now();
    const symbol = symbolFor(fromCoinType);
    console.log(
      `[swap/prepare] coin=${symbol} from=${fromMicros.toString()} ` +
        `to=${estimatedToMicros.toString()} ` +
        `ptb=${tPtbDone - tPtbStart}ms total=${tDone - tTotalStart}ms`
    );
    console.log(
      `[swap/prepare] mode=sponsored from=${fromCoinType} fromMicros=${fromMicros.toString()} estimatedTo=${estimatedToMicros.toString()}`
    );
    console.log(
      `[zk/sponsor] mode=sponsored sponsor=${sponsor} gasPrice=${gasPrice}`
    );

    return NextResponse.json({
      bytes: toBase64(bytes),
      mode: "sponsored-swap",
      from: fromCoinType,
      to: USDSUI_TYPE,
      fromMicros: fromMicros.toString(),
      estimatedToMicros: estimatedToMicros.toString(),
      sponsor,
      gasPrice: String(gasPrice),
    });
  } catch (err) {
    const msg = (err as Error).message ?? "swap prepare failed";
    console.warn(
      `[swap/prepare] user=${userId} fromCoinType=${fromCoinType} failed: ${msg}`
    );
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── Coin scalar lookup ─────────────────────────────────────────────
// Mirror of the DeepBook SDK's mainnet coin config for the types we
// route through. Hardcoded here so we don't reach into the SDK's
// private config object, the values are stable (scalar = 10^decimals).
const COIN_SCALARS: Record<string, number> = {
  [COIN_TYPES.SUI]: 1_000_000_000, // 9 decimals
  [COIN_TYPES.USDC]: 1_000_000, // 6 decimals
  [COIN_TYPES.DEEP]: 1_000_000, // 6 decimals
  [USDSUI_TYPE]: 1_000_000, // 6 decimals
};
function scalarOf(coinType: string): number {
  return COIN_SCALARS[coinType] ?? 1_000_000;
}
