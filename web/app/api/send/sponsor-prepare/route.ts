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
import {
  memoTtl,
  recordSendLatency,
  setPendingRoundup,
} from "@/lib/perf-cache";
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

  // ── USDsui ALWAYS takes the gasless rail ────────────────────────
  // Product directive (2026-05-29): every plain USDsui send must be
  // gasless, regardless of Spend-and-Save state. The roundup NAVI
  // supply leg can NOT be co-bundled (gasless PTB allowlist permits
  // only `0x2::coin::send_funds<T>`), so when SnS is on we compute
  // the roundup amount here and surface it to the submit endpoint
  // via `roundupUsd` — `/api/send/gasless-submit` will enqueue it
  // into `roundup_queue` after the gasless tx lands. The deferred
  // cron drains the queue and executes the NAVI supply as a separate
  // sponsored tx (see `/api/cron/process-roundup-queue`).
  //
  // Roundup config is memo'd per-user for 60s (toggling is rare
  // relative to send frequency). Defensive fallback on read failure:
  // treat as disabled so a config error never blocks a send.
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
  let deferredRoundupUsd = 0;
  if (asset === "USDsui" && roundupCfg.enabled && roundupCfg.percentage > 0) {
    const computed = Math.min(
      (amountNum * roundupCfg.percentage) / 100,
      amountNum
    );
    // 1¢ floor mirrors the previous gasless gate — anything smaller
    // than a single USDsui micro-unit isn't a real round-up.
    if (Math.round(computed * 1e6) > 0) {
      deferredRoundupUsd = computed;
    }
  }

  // Flips to true if the gasless try-block hits a categorized "expected"
  // failure (Coin-only balance state or accumulator underfunded) and we
  // fall through to the sponsored branch below. Used to surface
  // `mode: "sponsored-coin-fallback"` so analytics + iOS can tell this
  // apart from regular sponsored sends.
  // See: docs/sui-rpc-migration/gasless-notes.md
  //   §"Proof: coin::send_funds is not gasless for Coin-object holders"
  let gaslessFellBack = false;

  if (asset === "USDsui") {
    try {
      const t0 = Date.now();
      const client = sui();
      const tx = new Transaction();
      tx.setSender(user.sui_address);

      // Canonical 2-step gasless USDsui transfer PTB, verbatim from a
      // landed mainnet tx
      // (https://suivision.xyz/txblock/B9oaCA7GVQK989UdqG75QVvnMUQFd66G6qYVGnhStbxz)
      // pulled via JSON-RPC. Two MoveCalls, no gas, no payment:
      //
      //   Input[1] = fundsWithdrawal { maxAmountU64, withdrawFrom: "sender",
      //                                typeArg: USDSUI }
      //   1. 0x2::balance::redeem_funds<USDSUI>(Input[1])  → Balance<USDSUI>
      //   2. 0x2::balance::send_funds<USDSUI>(redeemed, recipient)
      //
      // Our previous PTB jumped straight from the withdrawal Input into
      // send_funds, but send_funds expects a Balance<T> not a
      // FundsWithdrawal Input. The build errored under "Invalid withdraw
      // reservation" — looked like an accumulator underfunding but was
      // really a missing redeem_funds step.
      const redeemed = tx.moveCall({
        target: "0x2::balance::redeem_funds",
        typeArguments: [USDSUI_TYPE],
        arguments: [tx.withdrawal({ amount: onchain, type: USDSUI_TYPE })],
      });
      tx.moveCall({
        target: "0x2::balance::send_funds",
        typeArguments: [USDSUI_TYPE],
        arguments: [redeemed, tx.pure.address(to)],
      });
      // Both must be explicit. The example mainnet gasless tx
      // (suivision/txblock/B9oaCA7G…) shows price=0 AND budget=0 with
      // payment=[]. Setting only price=0 left the SDK to auto-pick a
      // budget, which the validator then rejected as "gasless txs must
      // have price/budget both 0".
      tx.setGasPrice(0n);
      tx.setGasBudget(0n);

      const bytes = await tx.build({ client: client as never });
      const tBuild = Date.now();

      // Stash the deferred roundup so `/api/send/gasless-submit` can
      // enqueue it after the broadcast lands. iOS isn't changed today;
      // the bridge between prepare ↔ submit lives entirely server-side
      // in the perf-cache stash (per-user, 2-minute TTL).
      setPendingRoundup(userId, deferredRoundupUsd);

      console.log(
        `[send/sponsor-prepare gasless] total=${tBuild - t0}ms amount=${amountNum} USDsui deferredRoundupUsd=${deferredRoundupUsd}`
      );
      recordSendLatency({
        leg: "prepare",
        totalMs: tBuild - t0,
        atMs: Date.now(),
        extras: { mode: "gasless", deferredRoundup: deferredRoundupUsd > 0 },
      });

      return NextResponse.json({
        bytes: toBase64(bytes),
        mode: "gasless",
        asset,
        amount: amountNum,
        to,
        // Non-zero ONLY when SnS is on. The submit endpoint enqueues
        // a NAVI supply for this amount post-broadcast so the user's
        // spend-and-save still happens — just deferred, not atomic.
        roundupUsd: deferredRoundupUsd,
      });
    } catch (err) {
      // LOUD by default. The previous swallow-and-fall-through pattern
      // hid real bugs — `tx.build()` failing on the gasless rail almost
      // always means EITHER (a) the user genuinely has insufficient
      // USDsui (in which case the sponsored path will fail too — Payment
      // Kit also calls `coinWithBalance({useGasCoin:false})` on the same
      // type), OR (b) something is actually broken in the gasless build
      // and we want to know loudly.
      //
      // Log the FULL stack so Vercel logs surface the real cause, and
      // distinguish two cases:
      //   • Insufficient balance — return 500 with a clear, user-facing
      //     message. iOS surfaces it; no silent fallback to a sponsored
      //     path that will also fail on chain.
      //   • Anything else — log loudly, then fall through to the
      //     sponsored path (which still uses Payment Kit and may or may
      //     not succeed, but at least the safety net runs).
      const msg = (err as Error).message ?? String(err);
      const stack = (err as Error).stack ?? "(no stack)";
      console.error(
        `[send/sponsor-prepare] GASLESS BUILD FAILED user=${userId} amount=${amountNum} USDsui:\n${stack}`
      );
      if (/insufficient balance/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              "Insufficient USDsui balance. Top up your wallet and try again.",
            detail: msg,
          },
          { status: 400 }
        );
      }
      // The canonical `tx.withdrawal()` primitive pulls from the user's
      // on-chain Address Balance accumulator ONLY — it has zero visibility
      // into legacy `Coin<USDSUI>` objects sitting in the user's wallet.
      //
      // 2026-05-29 probe (web/scripts/probe-gasless-build.mjs, full
      // 25-shape matrix) PROVED gasless arbitrary-amount sends are
      // IMPOSSIBLE on chain TODAY for users whose USDsui lives in
      // Coin<USDSUI> objects rather than the accumulator. Validator
      // strings captured:
      //
      //   1. "Invalid gasless withdrawal from <accum>. Gasless
      //      transactions must either use the entire balance, or leave
      //      at least 10000 for token type USDSUI."  (accumulator path,
      //      sub-10k accumulator)
      //   2. "Transaction resolution failed: InsufficientGas"
      //      (every shape that prepends SplitCoins / mergeCoins /
      //      coin::into_balance + balance::split + balance::send_funds —
      //      validator refuses to cover intermediate-object storage with
      //      the input coin's rebate)
      //   3. "Feature is not supported: Function 0x2::pay::* | 0x2::coin::transfer | ..."
      //      (gasless allowlist explicitly excludes everything except
      //      balance::send_funds and coin::send_funds)
      //
      // The ONE shape that simulates `success:true` with `paymentCount:0`
      // is `0x2::coin::send_funds(<WHOLE_COIN>, recipient)` — but that
      // sends the entire Coin object's balance, NOT arbitrary amounts.
      //
      // See: docs/sui-rpc-migration/gasless-notes.md
      //   §"Proof: coin::send_funds is not gasless for Coin-object holders"
      //
      // Until either (a) the user's accumulator holds ≥ (amount + 10000),
      // OR (b) a public Sui framework primitive adds Coin<T>→accumulator
      // deposit to the gasless allowlist, arbitrary-amount sends from
      // Coin-only balance state MUST take the sponsored rail. The
      // sponsored fallback path runs Payment Kit (which CAN source from
      // Coin objects via `coinWithBalance({useGasCoin:false})`) and
      // surfaces as `mode: "sponsored-coin-fallback"` so iOS can
      // distinguish it from the regular sponsored path.
      //
      // TODO(gasless-coin-deposit): when Sui adds a public
      // accumulator::deposit / coin::join_to_accumulator entry function,
      // re-run probe-gasless-build.mjs to detect allowlist inclusion and
      // prepend the deposit leg to the canonical balance::send_funds PTB.
      // Product directive (2026-05-29 evening): a FREE transaction —
      // plain USDsui send with NO Spend-and-Save leg — must NEVER fall
      // through to Onara sponsorship. If the validator-side gasless
      // allowlist can't accommodate the user's balance state, the
      // honest answer is a clean 400 telling them why. The user can
      // then top up via Stripe (deposits land in the accumulator) and
      // their next send IS gasless. Sneaking Onara underneath would
      // (a) make Talise pay gas for a transaction the user told us
      // should be free, and (b) hide the underlying state mismatch.
      //
      // The ONLY exception is when SnS is on AND we still need to
      // atomically supply to NAVI — that path legitimately needs
      // sponsorship for the bundled NAVI leg, and we fall through.
      const isSnsActive = deferredRoundupUsd > 0;
      if (
        (/withdraw reservation/i.test(msg) || /accumulator/i.test(msg) || /InsufficientGas/i.test(msg) || /insufficient.*balance/i.test(msg)) &&
        isSnsActive
      ) {
        console.warn(
          `[send/sponsor-prepare] gasless unreachable for user=${userId} (Coin-only balance state) AND SnS active; falling through to sponsored-coin-fallback. detail=${msg.slice(0, 200)}`
        );
        gaslessFellBack = true;
        // Intentional fall-through — Payment Kit handles Coin<T>
        // sourcing via coinWithBalance({useGasCoin:false}) AND the SnS
        // NAVI supply leg lands atomically. Response surfaces
        // mode: "sponsored-coin-fallback".
      } else if (/withdraw reservation/i.test(msg) || /accumulator/i.test(msg) || /InsufficientGas/i.test(msg) || /insufficient.*balance/i.test(msg)) {
        console.warn(
          `[send/sponsor-prepare] gasless unreachable for user=${userId} (Coin-only balance state); SnS off — returning ACCUMULATOR_UNDERFUNDED 400. detail=${msg.slice(0, 200)}`
        );
        return NextResponse.json(
          {
            error:
              "Your USDsui isn't in your Address Balance accumulator yet — gasless sends require accumulator funds. Top up via Deposit (Stripe onramp lands USDsui directly in your accumulator) and try again.",
            detail: msg,
            code: "ACCUMULATOR_UNDERFUNDED",
          },
          { status: 400 }
        );
      } else {
        // Anything else: surface as 400 so iOS does NOT silently land on
        // `mode=sponsored`. Real build bugs deserve a loud failure.
        console.error(
          `[send/sponsor-prepare] gasless build failed with an uncategorized error; surfacing as 400: ${msg}`
        );
        return NextResponse.json(
          {
            error:
              "Gasless USDsui send is currently unavailable. Please try again in a moment.",
            detail: msg,
            code: "GASLESS_BUILD_FAILED",
          },
          { status: 400 }
        );
      }
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
    // Mode label distinguishes the regular sponsored path from the
    // gasless-failure fall-through (Coin-only balance state). Both go
    // through identical PTB construction; only the analytics label and
    // the iOS-facing `mode` field differ.
    const effectiveMode = gaslessFellBack
      ? "sponsored-coin-fallback"
      : "sponsored";
    recordSendLatency({
      leg: "prepare",
      totalMs: tBuild - t0,
      atMs: Date.now(),
      extras: {
        mode: effectiveMode,
        ptbMs: tBuilt - t0,
        statusPriceMs: tStatus - tBuilt,
        txBuildMs: tBuild - tStatus,
        hasRoundup: roundupUsd > 0,
      },
    });

    return NextResponse.json({
      bytes: toBase64(bytes),
      mode: effectiveMode,
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
