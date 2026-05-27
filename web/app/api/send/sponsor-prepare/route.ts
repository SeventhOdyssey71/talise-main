import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { sui, network, COIN_TYPES, USDSUI_DECIMALS } from "@/lib/sui";
import { appendPaymentKitReceipt } from "@/lib/intents/wrap-payment-kit";
import { getRoundupConfig } from "@/lib/rewards/roundup";
import { appendNaviSupply } from "@/lib/navi-supply";
import { onara } from "@/lib/onara";
import { memoTtl } from "@/lib/perf-cache";
import { ensurePaymentRegistry } from "@/lib/pk-bootstrap";

export const runtime = "nodejs";

/**
 * POST /api/send/sponsor-prepare
 *
 * Combined replacement for `/api/send/prepare` + `/api/zk/sponsor`.
 *
 * Before: iOS made two serial round-trips — prepare returned the
 * PTB kind bytes, sponsor wrapped them with the gas owner. Each cost
 * one full iOS→Vercel network hop (~500ms cold). This endpoint does
 * both server-side in one call:
 *
 *   1. Build the PTB exactly as `/api/send/prepare` did (Payment Kit
 *      wrap + optional NAVI round-up supply).
 *   2. Resolve the Onara sponsor address + reference gas price in
 *      parallel (both 60s-memoized → typically <1ms on warm).
 *   3. Set sender + gasOwner + gasPrice on the tx.
 *   4. Run the FULL `tx.build()` (with client) to produce the
 *      sponsor-ready bytes.
 *
 * Returns `{ bytes, roundupUsd, receiptNonce }` — iOS signs `bytes`
 * directly and forwards to `/api/zk/sponsor-execute`. One fewer
 * round-trip → ~500–800ms saved per send.
 *
 * The legacy `/api/send/prepare` + `/api/zk/sponsor` endpoints stay
 * around for the Earn flows and any older builds that haven't been
 * cut over to the combined path.
 */

const SUPPORTED_ASSETS = new Set(["USDsui", "SUI"]);
const ADDRESS_RE = /^0x[a-f0-9]{64}$/i;

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

  let body: { to?: string; amount?: number | string; asset?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const to = (body.to ?? "").trim().toLowerCase();
  if (!ADDRESS_RE.test(to)) {
    return NextResponse.json(
      { error: "recipient must be a 0x-prefixed Sui address" },
      { status: 400 }
    );
  }
  if (to === user.sui_address.toLowerCase()) {
    return NextResponse.json(
      { error: "you can't send to your own wallet" },
      { status: 400 }
    );
  }

  const asset = body.asset ?? "USDsui";
  if (!SUPPORTED_ASSETS.has(asset)) {
    return NextResponse.json(
      { error: `asset must be one of ${[...SUPPORTED_ASSETS].join(", ")}` },
      { status: 400 }
    );
  }

  const amountNum = Number(body.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }

  const decimals = asset === "USDsui" ? USDSUI_DECIMALS : 9;
  const onchain = BigInt(Math.round(amountNum * 10 ** decimals));
  if (onchain <= 0n) {
    return NextResponse.json({ error: "amount too small" }, { status: 400 });
  }

  try {
    const t0 = Date.now();
    const onaraClient = onara();
    const client = sui();
    const net = network();

    // Kick off the three expensive remote lookups IN PARALLEL while
    // we build the PTB in memory. By the time we need the sponsor /
    // gas price values, both promises are already settled (or close).
    // PaymentKit registry is fire-and-forget — we don't gate the build
    // on it because the call is idempotent + memoized.
    const ensureRegistry = ensurePaymentRegistry().catch((err) => {
      console.warn(
        `[send/sponsor-prepare] ensurePaymentRegistry failed: ${(err as Error).message}`
      );
    });
    const sponsorPromise = memoTtl(
      `onara:status:${onaraUrl}`,
      60_000,
      () => onaraClient.status()
    );
    const gasPricePromise = memoTtl(
      `sui:gasPrice:${net}`,
      60_000,
      async () => {
        const r = await client.getReferenceGasPrice();
        return r.referenceGasPrice;
      }
    );

    // Build the PTB body. Both branches end with a tx that hasn't
    // been `build()`-ed yet — we need the sponsor address first.
    const tx = new Transaction();
    tx.setSender(user.sui_address);

    let roundupUsd = 0;
    let receiptNonce: string | undefined;

    if (asset === "USDsui") {
      const { nonce } = appendPaymentKitReceipt(tx, {
        kind: "send",
        sender: user.sui_address,
        receiver: to,
        amountUsdsui: amountNum,
      });
      receiptNonce = nonce;

      // Round-up & Save — atomic supply leg in the same PTB. If the
      // user has toggled round-up on, we append a NAVI supply for
      // `amount × percentage / 100` USDsui so send + save land in
      // one signature. If the supply leg fails on chain (insufficient
      // balance after the send), the WHOLE tx fails — better a clean
      // error than a half-applied state.
      try {
        const cfg = await getRoundupConfig(userId);
        if (cfg.enabled && cfg.percentage > 0) {
          const computed = (amountNum * cfg.percentage) / 100;
          const cappedUsd = Math.min(computed, amountNum);
          const microUnits = Math.round(cappedUsd * 1e6);
          if (microUnits > 0) {
            roundupUsd = cappedUsd;
            await appendNaviSupply(tx, user.sui_address, roundupUsd);
            appendPaymentKitReceipt(tx, {
              kind: "invest",
              sender: user.sui_address,
              refs: { venue: "navi" },
            });
          }
        }
      } catch (err) {
        // Defensive — a round-up failure must NOT block the send.
        console.warn(
          "[send/sponsor-prepare] round-up append failed, falling back to send-only:",
          (err as Error).message
        );
        roundupUsd = 0;
      }
    } else {
      // SUI transfers can't use Payment Kit (registry is USDsui-only).
      // Use the legacy clock-MoveCall + split + transfer path.
      tx.moveCall({
        target: "0x2::clock::timestamp_ms",
        arguments: [tx.object("0x6")],
      });
      const coinType = COIN_TYPES.SUI;
      const out = tx.add(
        coinWithBalance({ type: coinType, balance: onchain, useGasCoin: false })
      );
      tx.transferObjects([out], to);
    }
    const tBuilt = Date.now();

    // Now wait on the parallel lookups + registry bootstrap.
    const [{ address: sponsor }, gasPrice] = await Promise.all([
      sponsorPromise,
      gasPricePromise,
      ensureRegistry,
    ]);
    const tStatus = Date.now();

    tx.setGasOwner(sponsor);
    // Pre-set gas price so `tx.build()` skips its own
    // `getReferenceGasPrice` RPC.
    tx.setGasPrice(BigInt(gasPrice));

    const bytes = await tx.build({ client: client as never });
    const tBuild = Date.now();

    console.log(
      `[send/sponsor-prepare] ptb=${tBuilt - t0}ms · status+price(par)=${tStatus - tBuilt}ms · tx.build=${tBuild - tStatus}ms · total=${tBuild - t0}ms`
    );

    return NextResponse.json({
      bytes: toBase64(bytes),
      asset,
      amount: amountNum,
      to,
      receiptNonce,
      // Server-blessed round-up amount in USDsui. iOS forwards to
      // /api/zk/sponsor-execute as `meta.roundupUsd` so the rewards
      // engine credits the supply leg too.
      roundupUsd,
    });
  } catch (err) {
    const msg = (err as Error).message ?? "build failed";
    console.warn(`[send/sponsor-prepare] user=${userId} failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
