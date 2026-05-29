import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { sui, network, COIN_TYPES } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { onara } from "@/lib/onara";
import { memoTtl } from "@/lib/perf-cache";

export const runtime = "nodejs";

/**
 * POST /api/swap/prepare
 *
 * Wallet-conditioning swap: convert a non-USDsui Coin<T> in the user's
 * wallet into USDsui, sponsored by Onara. Mirrors the FUSED build pattern
 * from `/api/send/sponsor-prepare`'s sponsored branch — one round-trip,
 * sets sender + gasOwner + gasPrice, returns sponsor-ready bytes that iOS
 * signs and forwards to `/api/zk/sponsor-execute`.
 *
 * Body: { fromCoinType: string, fromAmountMicros: string }
 * Response: { bytes, mode: "sponsored-swap", from, to, fromMicros,
 *             estimatedToMicros, sponsor, gasPrice }
 *
 * Allowlist: USDC, SUI, DEEP. Extend `SWAP_ROUTES` to add more.
 *
 * Slippage default 100 bps (1%). Surfaced via `estimatedToMicros` so iOS
 * can show "you'll receive ~$X" with the slippage cap applied to the
 * on-chain `minOut`.
 *
 * The output USDsui is transferred back to the user — never to a third
 * party. The combined "swap + send to recipient" flow is a follow-up.
 */

const SLIPPAGE_BPS = 100; // 1.00%

// ─── Route table ────────────────────────────────────────────────────
// Maps the allowed `fromCoinType` strings to (a) the DeepBook pool key
// that quotes <fromCoin>↔USDsui (directly or via a USDC bridge),
// (b) which side of the pool the input sits on, and (c) the SDK helper
// to call.
//
// Pool selection rationale: lowest fee path with deepest liquidity.
//   - SUI:  SUI_USDSUI is the direct stablecoin pair (≈1 bp pool).
//   - USDC: USDSUI_USDC is the only USDsui↔USDC pool; USDsui is base,
//           USDC is quote → swap exact quote for base.
//   - DEEP: no direct DEEP↔USDSUI pool exists. Hop via USDC:
//           DEEP_USDC (DEEP→USDC) → USDSUI_USDC (USDC→USDSUI).
//
// All other coin types return 400 with code SWAP_UNSUPPORTED.

type DirectRoute = {
  kind: "direct";
  poolKey: string;
  /** Which side of the pool is the input coin. */
  inputSide: "base" | "quote";
};
type TwoHopRoute = {
  kind: "two-hop";
  hop1: { poolKey: string; inputSide: "base" | "quote"; intermediateType: string };
  hop2: { poolKey: string; inputSide: "base" | "quote" };
};
type SwapRoute = DirectRoute | TwoHopRoute;

const SWAP_ROUTES: Record<string, SwapRoute> = {
  [COIN_TYPES.SUI]: {
    kind: "direct",
    poolKey: "SUI_USDSUI",
    inputSide: "base", // SUI is base, USDSUI is quote
  },
  [COIN_TYPES.USDC]: {
    kind: "direct",
    poolKey: "USDSUI_USDC",
    inputSide: "quote", // USDSUI is base, USDC is quote → swap quote for base
  },
  [COIN_TYPES.DEEP]: {
    kind: "two-hop",
    hop1: {
      poolKey: "DEEP_USDC",
      inputSide: "base", // DEEP is base, USDC is quote
      intermediateType: COIN_TYPES.USDC,
    },
    hop2: {
      poolKey: "USDSUI_USDC",
      inputSide: "quote", // USDSUI is base, USDC is quote
    },
  },
};

/** Symbol label for the per-leg timing log line. */
function symbolFor(coinType: string): string {
  if (coinType === COIN_TYPES.SUI) return "SUI";
  if (coinType === COIN_TYPES.USDC) return "USDC";
  if (coinType === COIN_TYPES.DEEP) return "DEEP";
  return coinType.split("::").pop() ?? coinType;
}

/** Cached DeepBookClient for quote simulations + pool config lookups. */
let _db: DeepBookClient | null = null;
const SIM_SENDER =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
function deepbook(): DeepBookClient {
  if (_db) return _db;
  _db = new DeepBookClient({
    client: sui() as never,
    address: SIM_SENDER,
    network: network() === "mainnet" ? "mainnet" : "testnet",
  });
  return _db;
}

/**
 * Quote out for a direct pool using the SDK's simulate-based quote query.
 * Returns `outMicros` on the destination coin in raw u64.
 *
 * baseQty / quoteQty: SDK expects whole-unit numbers; we round-trip via
 * the coin's scalar exposed on the config. For our purposes we already
 * have the raw micros and just need the raw out — so we use the
 * SDK's number-output * scalar back to micros.
 */
async function quoteDirect(
  poolKey: string,
  inputSide: "base" | "quote",
  inMicros: bigint,
  inScalar: number,
  outScalar: number
): Promise<bigint> {
  const db = deepbook();
  const inWhole = Number(inMicros) / inScalar;
  if (inputSide === "base") {
    const r = await db.getQuoteQuantityOut(poolKey, inWhole);
    return BigInt(Math.floor(r.quoteOut * outScalar));
  } else {
    const r = await db.getBaseQuantityOut(poolKey, inWhole);
    return BigInt(Math.floor(r.baseOut * outScalar));
  }
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
  const route = SWAP_ROUTES[fromCoinType];
  if (!route) {
    return NextResponse.json(
      {
        error: `unsupported fromCoinType — allowlist: USDC, SUI, DEEP`,
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
    // (a) Onara sponsor address — 60s memo.
    // (b) Reference gas price — 1.5s memo (per-epoch).
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

    const db = deepbook();
    // Use a child contract handle via the SDK's internal builder. The
    // public surface we want lives on `db.deepBook` (DeepBookContract).
    const dbc = (db as unknown as {
      deepBook: {
        swapExactBaseForQuote: (p: {
          poolKey: string;
          amount: number | bigint;
          deepAmount: number | bigint;
          minOut: number | bigint;
          baseCoin?: unknown;
          deepCoin?: unknown;
        }) => (t: Transaction) => readonly [unknown, unknown, unknown];
        swapExactQuoteForBase: (p: {
          poolKey: string;
          amount: number | bigint;
          deepAmount: number | bigint;
          minOut: number | bigint;
          quoteCoin?: unknown;
          deepCoin?: unknown;
        }) => (t: Transaction) => readonly [unknown, unknown, unknown];
      };
      // Internal config lookup — used to pull pool + coin scalars so we
      // can pass raw u64 micros all the way through (the SDK helpers
      // accept bigint as-is, no whole-unit conversion).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [k: string]: any;
    }).deepBook;

    // DEEP fee coin: zero amount = "pay fees in input coin" path for
    // whitelisted pools. SUI_USDSUI, USDSUI_USDC, DEEP_USDC are all
    // whitelisted on mainnet.
    const tPtbStart = Date.now();

    let estimatedToMicros: bigint;

    // Helper to build a zero DEEP coin input that won't touch gas:
    const zeroDeepInput = () =>
      tx.add(
        coinWithBalance({
          type: COIN_TYPES.DEEP,
          balance: 0n,
          useGasCoin: false,
        })
      );

    if (route.kind === "direct") {
      // 1-hop direct swap.
      const inputCoinArg = tx.add(
        coinWithBalance({
          type: fromCoinType,
          balance: fromMicros,
          useGasCoin: false,
        })
      );

      // Quote the expected output to compute minOut + surface to iOS.
      // We need the coin scalars from the SDK config.
      const inScalar = scalarOf(fromCoinType);
      const outScalar = scalarOf(USDSUI_TYPE);
      const quotedOut = await quoteDirect(
        route.poolKey,
        route.inputSide,
        fromMicros,
        inScalar,
        outScalar
      );
      const minOut =
        (quotedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
      estimatedToMicros = quotedOut;

      let outCoinArg: unknown;
      if (route.inputSide === "base") {
        // input is base → swapExactBaseForQuote → returns [base, quote, deep]
        const [, quoteOut] = dbc.swapExactBaseForQuote({
          poolKey: route.poolKey,
          amount: fromMicros,
          deepAmount: 0n,
          minOut: minOut,
          baseCoin: inputCoinArg,
          deepCoin: zeroDeepInput(),
        })(tx);
        outCoinArg = quoteOut;
      } else {
        // input is quote → swapExactQuoteForBase → returns [base, quote, deep]
        const [baseOut] = dbc.swapExactQuoteForBase({
          poolKey: route.poolKey,
          amount: fromMicros,
          deepAmount: 0n,
          minOut: minOut,
          quoteCoin: inputCoinArg,
          deepCoin: zeroDeepInput(),
        })(tx);
        outCoinArg = baseOut;
      }

      // Send the USDsui back to the user.
      tx.transferObjects(
        [outCoinArg as Parameters<typeof tx.transferObjects>[0][number]],
        user.sui_address
      );
    } else {
      // 2-hop swap via USDC.
      const inputCoinArg = tx.add(
        coinWithBalance({
          type: fromCoinType,
          balance: fromMicros,
          useGasCoin: false,
        })
      );

      const inScalar = scalarOf(fromCoinType);
      const usdcScalar = scalarOf(COIN_TYPES.USDC);
      const usdsuiScalar = scalarOf(USDSUI_TYPE);

      // Quote hop 1 (input → USDC).
      const hop1Out = await quoteDirect(
        route.hop1.poolKey,
        route.hop1.inputSide,
        fromMicros,
        inScalar,
        usdcScalar
      );
      const hop1Min =
        (hop1Out * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;

      // Quote hop 2 (USDC → USDSUI), feeding the quoted hop1 amount.
      const hop2Out = await quoteDirect(
        route.hop2.poolKey,
        route.hop2.inputSide,
        hop1Out,
        usdcScalar,
        usdsuiScalar
      );
      const hop2Min =
        (hop2Out * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
      estimatedToMicros = hop2Out;

      // Hop 1 MoveCall.
      let intermediateCoinArg: unknown;
      if (route.hop1.inputSide === "base") {
        const [, quoteOut] = dbc.swapExactBaseForQuote({
          poolKey: route.hop1.poolKey,
          amount: fromMicros,
          deepAmount: 0n,
          minOut: hop1Min,
          baseCoin: inputCoinArg,
          deepCoin: zeroDeepInput(),
        })(tx);
        intermediateCoinArg = quoteOut;
      } else {
        const [baseOut] = dbc.swapExactQuoteForBase({
          poolKey: route.hop1.poolKey,
          amount: fromMicros,
          deepAmount: 0n,
          minOut: hop1Min,
          quoteCoin: inputCoinArg,
          deepCoin: zeroDeepInput(),
        })(tx);
        intermediateCoinArg = baseOut;
      }

      // Hop 2 MoveCall.
      let outCoinArg: unknown;
      if (route.hop2.inputSide === "base") {
        const [, quoteOut] = dbc.swapExactBaseForQuote({
          poolKey: route.hop2.poolKey,
          amount: hop1Out,
          deepAmount: 0n,
          minOut: hop2Min,
          baseCoin: intermediateCoinArg,
          deepCoin: zeroDeepInput(),
        })(tx);
        outCoinArg = quoteOut;
      } else {
        const [baseOut] = dbc.swapExactQuoteForBase({
          poolKey: route.hop2.poolKey,
          amount: hop1Out,
          deepAmount: 0n,
          minOut: hop2Min,
          quoteCoin: intermediateCoinArg,
          deepCoin: zeroDeepInput(),
        })(tx);
        outCoinArg = baseOut;
      }

      tx.transferObjects(
        [outCoinArg as Parameters<typeof tx.transferObjects>[0][number]],
        user.sui_address
      );
    }

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
// private config object — the values are stable (scalar = 10^decimals).
const COIN_SCALARS: Record<string, number> = {
  [COIN_TYPES.SUI]: 1_000_000_000, // 9 decimals
  [COIN_TYPES.USDC]: 1_000_000, // 6 decimals
  [COIN_TYPES.DEEP]: 1_000_000, // 6 decimals
  [USDSUI_TYPE]: 1_000_000, // 6 decimals
};
function scalarOf(coinType: string): number {
  return COIN_SCALARS[coinType] ?? 1_000_000;
}
