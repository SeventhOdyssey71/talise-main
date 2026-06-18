import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import { userById } from "@/lib/db";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { AggregatorClient } from "@cetusprotocol/aggregator-sdk";
import { sui, network, COIN_TYPES, USDSUI_DECIMALS } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { TREASURY_WALLET } from "@/lib/navi-supply";
import { onara } from "@/lib/onara";
import { memoTtl } from "@/lib/perf-cache";
import { bridgeConfigured } from "@/lib/bridge/client";
import { getOnrampKyc } from "@/lib/onramp/kyc-store";
import { findExistingCashout } from "@/lib/bridge/offramp";
import type { BridgeFiatCurrency } from "@/lib/bridge/onramp";

export const runtime = "nodejs";

/**
 * POST /api/offramp/bridge/withdraw-prepare
 *
 * Bridge off-ramp WITHDRAWAL in one sponsored PTB. The wallet holds USDsui but
 * Bridge pays out from USDC on Sui, so this builds an Onara-sponsored tx that:
 *   1. swaps `amountUsdsui` USDsui → USDC (Cetus aggregator),
 *   2. takes a 1% Talise fee to the treasury (Cetus overlay fee), and
 *   3. sends the remaining USDC to the user's Bridge cash-out address.
 * Bridge then pays out fiat (e.g. USD by Wire) to the registered bank.
 *
 * The destination Bridge address is resolved SERVER-SIDE from the user's
 * existing payout route — the client never sees or passes it. Returns
 * sponsor-ready bytes that iOS signs (`signAndExecuteRaw`) and forwards to
 * `/api/zk/sponsor-execute`. Does NOT mutate any balance itself.
 *
 * Body: { amountUsdsui: number, currency?: "usd" }
 * Response: { bytes, mode: "sponsored-offramp", amountUsdsui,
 *             estimatedUsdcMicros, currency, destinationPaymentRail }
 */

const SLIPPAGE_BPS = 100; // 1.00%
const SWAP_FEE_BPS = 100; // 1.00% Talise fee → treasury (Cetus overlay)
const MIN_WITHDRAW_USDSUI = 1; // floor; Bridge enforces its own wire minimum

export async function POST(req: Request) {
  const onaraUrl = process.env.ONARA_URL;
  if (!onaraUrl) {
    return NextResponse.json({ error: "ONARA_URL not configured" }, { status: 503 });
  }
  if (!bridgeConfigured()) {
    return NextResponse.json({ error: "bridge_offramp_disabled" }, { status: 503 });
  }

  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const rl = await rateLimitAsync({
    key: `offramp-withdraw:user:${userId}`,
    limit: 30,
    windowSec: 3600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } }
    );
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { amountUsdsui?: number; currency?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const amountUsdsui =
    typeof body.amountUsdsui === "number" && Number.isFinite(body.amountUsdsui)
      ? body.amountUsdsui
      : 0;
  if (amountUsdsui < MIN_WITHDRAW_USDSUI) {
    return NextResponse.json(
      { error: `Minimum withdrawal is ${MIN_WITHDRAW_USDSUI} USDsui.`, code: "AMOUNT_TOO_LOW" },
      { status: 400 }
    );
  }
  const currency = (body.currency ?? "usd").toLowerCase() as BridgeFiatCurrency;
  // USD pays out by Wire (the route the founder set up); EUR→SEPA when enabled.
  const wantRail = currency === "eur" ? "sepa" : "wire";

  // The Bridge customer is shared with on-ramp KYC; off-ramp requires it.
  const kyc = await getOnrampKyc(userId);
  const customerId = kyc?.providerCustomerId;
  if (!customerId) {
    return NextResponse.json(
      { error: "complete identity verification first", code: "NO_BRIDGE_CUSTOMER" },
      { status: 409 }
    );
  }

  // Resolve the destination Bridge cash-out address (never sent by the client).
  const route = await findExistingCashout(customerId, currency, wantRail);
  if (!route) {
    return NextResponse.json(
      { error: "no cash-out route set up for this currency", code: "NO_ROUTE" },
      { status: 409 }
    );
  }
  const destination = route.address;

  const fromMicros = BigInt(Math.round(amountUsdsui * 10 ** USDSUI_DECIMALS));

  try {
    const onaraClient = onara();
    const client = sui();
    const net = network();
    const sponsorPromise = memoTtl(`onara:status:${onaraUrl}`, 60_000, () =>
      onaraClient.status()
    );
    const gasPricePromise = memoTtl(`sui:gas-price:${net}`, 1_500, async () => {
      const r = await client.getReferenceGasPrice();
      return r.referenceGasPrice;
    });

    // ─── PTB: swap USDsui → USDC, 1% fee → treasury, USDC → Bridge addr ──
    const tx = new Transaction();
    tx.setSender(user.sui_address);

    const aggregator = new AggregatorClient({
      client,
      signer: user.sui_address,
      overlayFeeRate: SWAP_FEE_BPS / 10_000, // 1.00% → treasury
      overlayFeeReceiver: TREASURY_WALLET,
    });
    const cetusRouter = await aggregator.findRouters({
      from: USDSUI_TYPE,
      target: COIN_TYPES.USDC,
      amount: fromMicros.toString(),
      byAmountIn: true,
    });
    if (!cetusRouter || cetusRouter.insufficientLiquidity) {
      return NextResponse.json(
        { error: "No swap route available right now. Try again shortly.", code: "NO_ROUTE_SWAP" },
        { status: 503 }
      );
    }
    const estimatedUsdcMicros = BigInt(cetusRouter.amountOut.toString());

    const inputCoin = tx.add(
      coinWithBalance({ type: USDSUI_TYPE, balance: fromMicros, useGasCoin: false })
    );
    const outCoin = await aggregator.routerSwap({
      router: cetusRouter,
      inputCoin,
      slippage: SLIPPAGE_BPS / 10_000, // 1.00%
      txb: tx,
    });
    // Send the swapped USDC (net of the 1% overlay fee) to the Bridge address,
    // which liquidates it to fiat for the user's bank.
    tx.transferObjects([outCoin], destination);

    const [{ address: sponsor }, gasPrice] = await Promise.all([
      sponsorPromise,
      gasPricePromise,
    ]);
    tx.setGasOwner(sponsor);
    tx.setGasPrice(BigInt(gasPrice));

    const bytes = await tx.build({ client: client as never });

    console.log(
      `[offramp/withdraw-prepare] user=${userId} from=${fromMicros.toString()} ` +
        `estUsdc=${estimatedUsdcMicros.toString()} rail=${route.rail} sponsor=${sponsor}`
    );

    return NextResponse.json({
      bytes: toBase64(bytes),
      mode: "sponsored-offramp",
      amountUsdsui,
      estimatedUsdcMicros: estimatedUsdcMicros.toString(),
      currency,
      destinationPaymentRail: route.rail,
    });
  } catch (err) {
    const msg = (err as Error).message ?? "withdraw prepare failed";
    console.warn(`[offramp/withdraw-prepare] user=${userId} failed: ${msg}`);
    return NextResponse.json(
      { error: "Couldn't set up withdrawal. Please try again.", code: "WITHDRAW_PREPARE_FAILED" },
      { status: 500 }
    );
  }
}
