import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { sui, network, COIN_TYPES, USDSUI_DECIMALS } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { appendPaymentKitReceipt } from "@/lib/intents/wrap-payment-kit";
import { getRoundupConfig } from "@/lib/rewards/roundup";
import { appendNaviSupply } from "@/lib/navi-supply";
import { onara } from "@/lib/onara";
import { memoTtl, recordSendLatency } from "@/lib/perf-cache";
// NOTE: ensurePaymentRegistry() is intentionally NOT imported here.
// The registry has existed on chain for weeks; the only legitimate caller
// is `/api/zk/warmup`, which runs once at dashboard load. Keeping it on
// the prepare hot path paid a cold-start cost on the FIRST send per Node
// process for no benefit.

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

  // ── Decide gasless vs sponsored BEFORE building the PTB ──────────
  // Plain USDsui sends with no round-up qualify for Sui's gasless
  // stablecoin transfer (PTB must be ONLY `0x2::coin::send_funds`).
  // Anything else (round-up enabled, SUI transfer, future legs) needs
  // Onara sponsorship.
  // Roundup config is memo'd per-user for 60s. Toggling round-up is rare
  // relative to send frequency, so a 60s staleness window is fine and lets
  // subsequent sends within the window skip the DB round-trip entirely.
  // Defensive fallback — if the read throws, treat as disabled so we never
  // block a send on a config error.
  const roundupCfg = await memoTtl(
    `roundup:cfg:${userId}`,
    60_000,
    () =>
      getRoundupConfig(userId).catch(() => ({
        enabled: false,
        percentage: 0,
        savedUsd: 0,
      }))
  );
  let isGasless = false;
  let roundupUsdGasless = 0;
  if (asset === "USDsui") {
    const computed =
      roundupCfg.enabled && roundupCfg.percentage > 0
        ? Math.min((amountNum * roundupCfg.percentage) / 100, amountNum)
        : 0;
    const microUnits = Math.round(computed * 1e6);
    if (microUnits <= 0) {
      isGasless = true;
    } else {
      roundupUsdGasless = computed;
    }
  }

  if (isGasless) {
    try {
      const t0 = Date.now();
      const client = sui();
      const tx = new Transaction();
      tx.setSender(user.sui_address);

      // Pull the exact send amount out of the user's USDsui balance
      // as a Coin<USDSUI>. `useGasCoin: false` is mandatory — we
      // can't reuse the gas coin in a gasless tx (there is no gas
      // coin), and the type isn't SUI anyway.
      const coin = tx.add(
        coinWithBalance({
          type: USDSUI_TYPE,
          balance: onchain,
          useGasCoin: false,
        })
      );
      // `0x2::coin::send_funds<T>(coin, recipient)` is the
      // gasless-eligible primitive per Sui's allowlist (USDsui is one
      // of the seven supported stablecoins). Validators accept this
      // tx with no gas payment and no gas owner.
      tx.moveCall({
        target: "0x2::coin::send_funds",
        typeArguments: [USDSUI_TYPE],
        arguments: [coin, tx.pure.address(to)],
      });
      // Per Sui docs: JSON-RPC builds must explicitly setGasPrice(0)
      // (gRPC/GraphQL clients auto-detect, but our `sui()` is JSON-RPC).
      tx.setGasPrice(0n);

      const bytes = await tx.build({ client: client as never });
      const tBuild = Date.now();
      console.log(
        `[send/sponsor-prepare gasless] total=${tBuild - t0}ms amount=${amountNum} USDsui`
      );
      recordSendLatency({
        leg: "prepare",
        totalMs: tBuild - t0,
        atMs: Date.now(),
        extras: { mode: "gasless" },
      });

      return NextResponse.json({
        bytes: toBase64(bytes),
        mode: "gasless",
        asset,
        amount: amountNum,
        to,
        roundupUsd: 0,
      });
    } catch (err) {
      // If the gasless build trips on something (network glitch,
      // edge-case insufficient AB, etc.) fall through to the sponsored
      // path rather than failing the user's send outright. Onara is
      // always there as the safety net.
      console.warn(
        `[send/sponsor-prepare] gasless build failed, falling back to sponsored: ${(err as Error).message}`
      );
    }
  }

  try {
    const t0 = Date.now();
    const onaraClient = onara();
    const client = sui();
    const net = network();

    // Kick off the two expensive remote lookups IN PARALLEL while we build
    // the PTB in memory. By the time we need the sponsor / gas price
    // values, both promises are already settled (or close).
    //
    // ensurePaymentRegistry() lived here before — it was a fire-and-forget
    // call that the Promise.all still awaited. After the first call per
    // process it's a memoTtl hit, but the FIRST call paid an object lookup
    // on the gRPC client. Since /api/zk/warmup already calls it on
    // dashboard load and the registry has been live for weeks, we drop it
    // from the prepare path entirely.
    const sponsorPromise = memoTtl(
      `onara:status:${onaraUrl}`,
      60_000,
      () => onaraClient.status()
    );
    // Gas price is per-epoch on Sui; a tight 1.5s memo window matches
    // the natural reorg + epoch boundary and is safe to cache for tx
    // building (the chain accepts a few seconds of staleness on the
    // reference gas price). Aggressive memo here saves ~150–300ms on
    // every send within the window.
    const gasPricePromise = memoTtl(
      `sui:gas-price:${net}`,
      1_500,
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

    // Per-step timing inside the ptb window so the next live send can
    // pinpoint where the ~1900ms cold cost actually goes. Suspects on a
    // cold process: NaviAdapter init (lazy on first round-up), Payment Kit
    // receipt append, and the gas-price/onara round-trips below.
    const tStepStart = Date.now();
    let tPk = tStepStart;
    let tRoundup = tStepStart;
    let tNavi = tStepStart;

    if (asset === "USDsui") {
      const { nonce } = appendPaymentKitReceipt(tx, {
        kind: "send",
        sender: user.sui_address,
        receiver: to,
        amountUsdsui: amountNum,
      });
      receiptNonce = nonce;
      tPk = Date.now();

      // Round-up & Save — atomic supply leg in the same PTB. Reuses the
      // cached `roundupCfg` from the gasless decision above (no second DB
      // round-trip). If the user has toggled round-up on, we append a
      // NAVI supply for `amount × percentage / 100` USDsui so send + save
      // land in one signature.
      //
      // `appendNaviSupply` is async (the underlying adapter does a small
      // amount of bookkeeping on the first call per process — pre-warmed
      // by `/api/zk/warmup`). We await it INLINE here rather than in the
      // status+price Promise.all because it MUTATES `tx`; running it in
      // parallel with `tx.build()` would race the builder. The cost is
      // typically <5ms once the adapter is warm, which is fine.
      tRoundup = Date.now();
      try {
        if (roundupCfg.enabled && roundupCfg.percentage > 0) {
          const computed = (amountNum * roundupCfg.percentage) / 100;
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
      tNavi = Date.now();
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
      tPk = tRoundup = tNavi = Date.now();
    }
    const tBuilt = Date.now();

    // Now wait on the parallel lookups.
    const [{ address: sponsor }, gasPrice] = await Promise.all([
      sponsorPromise,
      gasPricePromise,
    ]);
    const tStatus = Date.now();

    tx.setGasOwner(sponsor);
    // Pre-set gas price so `tx.build()` skips its own
    // `getReferenceGasPrice` RPC.
    tx.setGasPrice(BigInt(gasPrice));

    const bytes = await tx.build({ client: client as never });
    const tBuild = Date.now();

    console.log(
      `[send/sponsor-prepare] ptb=${tBuilt - t0}ms ` +
        `(pk=${tPk - tStepStart}ms roundup=${tRoundup - tPk}ms navi=${tNavi - tRoundup}ms) ` +
        `· status+price(par)=${tStatus - tBuilt}ms ` +
        `· tx.build=${tBuild - tStatus}ms · total=${tBuild - t0}ms`
    );
    recordSendLatency({
      leg: "prepare",
      totalMs: tBuild - t0,
      atMs: Date.now(),
      extras: {
        mode: "sponsored",
        ptbMs: tBuilt - t0,
        statusPriceMs: tStatus - tBuilt,
        txBuildMs: tBuild - tStatus,
        hasRoundup: roundupUsd > 0,
      },
    });

    return NextResponse.json({
      bytes: toBase64(bytes),
      mode: "sponsored",
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
