import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getSuiBalance, sui, COIN_TYPES } from "@/lib/sui";
import { getSuiUsdcPrice } from "@/lib/deepbook";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";

export const runtime = "nodejs";

/**
 * POST /api/sweep/prepare
 *
 * Body: { action?: "preview" | "execute" }
 *
 * Preview path returns the human-readable headline numbers the iOS
 * banner needs (how much SUI is swappable + the estimated USDsui out).
 *
 * Execute path builds a Cetus aggregator router-swap PTB that converts
 * the user's full SUI balance into USDsui in one tx, returns the
 * transaction-kind bytes ready for /api/zk/sponsor → Onara. The user
 * signs once with Face ID; Onara pays the gas; everything settles in
 * USDsui so the wallet headline stays in one unit.
 *
 * Coins covered: SUI → USDsui. Adding other coin types is a matter of
 * iterating sui_getAllBalances and calling findRouters per coin type
 * with non-zero balance — left as a follow-up so we keep this first
 * shipment small.
 */

// Below this we don't bother — the Cetus route fee + Onara overhead
// dominate the headline. Roughly $0.02 worth.
const DUST_SUI = 0.005;

// 0.5% slippage on the output. Tighter than typical wallet defaults
// because the route is SUI→USDsui (well-arb'd direct pair) and we
// don't want the user signing a tx that quietly burns 1%+.
const SLIPPAGE = 0.005;

let _aggregator: AggregatorClient | null = null;
function aggregator(): AggregatorClient {
  if (_aggregator) return _aggregator;
  // env: "mainnet" picks up Cetus's hosted endpoint + pyth feeds; no
  // local RPC client needed because the aggregator does its own pool
  // discovery server-side.
  _aggregator = new AggregatorClient({ env: Env.Mainnet });
  return _aggregator;
}

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { action?: "preview" | "execute" };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const [bal, suiUsd] = await Promise.all([
    getSuiBalance(user.sui_address).catch(() => ({ sui: 0, mist: "0" })),
    getSuiUsdcPrice().catch(() => 0),
  ]);

  const swappable = bal.sui;
  const valueUsd = swappable * (suiUsd || 0);
  const eligible = swappable >= DUST_SUI && suiUsd > 0;

  if (body.action !== "execute") {
    return NextResponse.json({
      eligible,
      from: { coin: "SUI", amount: swappable },
      to: { coin: "USDsui", estimateUsd: valueUsd },
      route: "cetus-aggregator",
      sponsored: true,
    });
  }

  // --- Execute path: build the Cetus swap PTB. ---
  if (!eligible) {
    return NextResponse.json(
      { error: "Nothing to sweep — SUI balance is below the dust threshold." },
      { status: 400 }
    );
  }

  try {
    // 1. Pull the user's SUI coin objects. We can't use tx.gas because
    //    in a sponsored tx the gas coin belongs to Onara, not the
    //    sender — so we splitCoins from one of the sender's own SUI
    //    coins instead, exactly like /api/send/prepare does for native
    //    SUI transfers.
    const coins = await sui().getCoins({
      owner: user.sui_address,
      coinType: COIN_TYPES.SUI,
    });
    if (coins.data.length === 0) {
      return NextResponse.json(
        { error: "no SUI coin to sweep" },
        { status: 400 }
      );
    }
    const totalMist = coins.data.reduce(
      (sum, c) => sum + BigInt(c.balance),
      0n
    );
    if (totalMist <= 0n) {
      return NextResponse.json(
        { error: "SUI balance is zero" },
        { status: 400 }
      );
    }

    // 2. Ask the Cetus aggregator for the best route to USDsui.
    const router = await aggregator().findRouters({
      from: COIN_TYPES.SUI,
      target: USDSUI_TYPE,
      amount: totalMist.toString(),
      byAmountIn: true,
    });
    if (!router) {
      return NextResponse.json(
        { error: "No Cetus route found for SUI → USDsui right now." },
        { status: 502 }
      );
    }

    // 3. Build the PTB: merge coins → split off the swap amount →
    //    hand to Cetus → transfer the output USDsui back to the user.
    const tx = new Transaction();
    tx.setSender(user.sui_address);

    const primary = tx.object(coins.data[0].coinObjectId);
    if (coins.data.length > 1) {
      tx.mergeCoins(
        primary,
        coins.data.slice(1).map((c) => tx.object(c.coinObjectId))
      );
    }
    const [swapInput] = tx.splitCoins(primary, [totalMist]);

    const outputCoin = await aggregator().routerSwap({
      router,
      inputCoin: swapInput,
      slippage: SLIPPAGE,
      txb: tx,
    });
    tx.transferObjects([outputCoin], user.sui_address);

    // 4. onlyTransactionKind bytes — Onara wraps these into sponsored
    //    TransactionData via /api/zk/sponsor, the user signs the
    //    intent message with their ephemeral key, /api/zk/sponsor-execute
    //    broadcasts.
    const kind = await tx.build({
      client: sui() as never,
      onlyTransactionKind: true,
    });
    return NextResponse.json({
      transactionKindB64: toBase64(kind),
      from: { coin: "SUI", amount: swappable },
      to: { coin: "USDsui", estimateUsd: valueUsd },
      slippage: SLIPPAGE,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Cetus swap build failed: " + (err as Error).message },
      { status: 502 }
    );
  }
}
