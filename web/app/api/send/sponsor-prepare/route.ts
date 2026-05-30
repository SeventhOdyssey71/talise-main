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
import { getCurrentEpoch } from "@/lib/sui-epoch";
import { SuiJsonRpcClient, JsonRpcHTTPTransport } from "@mysten/sui/jsonRpc";
import { shinamiSuiNodeJsonRpc } from "@/lib/shinami";
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

// Singleton JSON-RPC client used ONLY by the gasless build path. We
// need it because @mysten/sui 2.16.3's gRPC SDK has a build-time bug
// with `ValidDuring` expiration encoding ("unknown
// TransactionExpirationKind"). The bytes produced by the JSON-RPC
// build are network-agnostic and are accepted by gRPC executeTransaction
// downstream in `/api/send/gasless-submit`. Lazily initialized to defer
// any env-var resolution to first use.
//
// Routing: when `SHINAMI_NODE_API_KEY` is set, the singleton points at
// Shinami's paid Sui-node JSON-RPC (`api.us1.shinami.com/sui/node/v1`)
// with the `X-Api-Key` header wrapped into the fetch function the SDK
// uses. Otherwise it falls back to the free public mainnet fullnode.
// Both singletons are cached separately so a one-shot retry after a
// Shinami 401/403 can reuse the public client without rebuilding.
let _jsonRpcShinami: SuiJsonRpcClient | null = null;
let _jsonRpcPublic: SuiJsonRpcClient | null = null;

function publicFullnodeUrl(net: string): string {
  return net === "mainnet"
    ? "https://fullnode.mainnet.sui.io:443"
    : `https://fullnode.${net}.sui.io:443`;
}

function buildPublicJsonRpc(): SuiJsonRpcClient {
  if (_jsonRpcPublic) return _jsonRpcPublic;
  const net = network();
  _jsonRpcPublic = new SuiJsonRpcClient({
    network: net,
    url: publicFullnodeUrl(net),
  });
  return _jsonRpcPublic;
}

function buildShinamiJsonRpc(
  shinami: { url: string; headers: Record<string, string> },
): SuiJsonRpcClient {
  if (_jsonRpcShinami) return _jsonRpcShinami;
  const net = network();
  // The SDK's transport layer exposes both a per-request `headers`
  // hook (`rpc.headers`) AND a custom `fetch` wrapper. We use BOTH:
  //   - `rpc.headers` is the canonical path for static auth headers
  //     (Shinami's `X-Api-Key`). Cheaper than wrapping fetch.
  //   - `fetch` wrapper exists as a defensive merge layer — if a
  //     future SDK call ever bypasses the configured `rpc.headers`,
  //     the wrapper still appends the auth header.
  // The build-time `tx.build({ client })` path eventually issues
  // standard JSON-RPC POSTs through this transport, so either hook
  // would suffice today; the belt+suspenders is for SDK churn.
  const transport = new JsonRpcHTTPTransport({
    url: shinami.url,
    rpc: { headers: shinami.headers },
    fetch: (input, init) => {
      const hdrs: Record<string, string> = {
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
        ...shinami.headers,
      };
      return fetch(input as RequestInfo, { ...init, headers: hdrs });
    },
  });
  _jsonRpcShinami = new SuiJsonRpcClient({ network: net, transport });
  return _jsonRpcShinami;
}

function getJsonRpcClient(): SuiJsonRpcClient {
  const shinami = shinamiSuiNodeJsonRpc();
  return shinami ? buildShinamiJsonRpc(shinami) : buildPublicJsonRpc();
}

/**
 * Returns true if an error from a JSON-RPC build looks like a
 * Shinami-auth failure (401/403). Used to gate the one-shot retry
 * against the public fullnode. Be conservative — anything not
 * obviously auth-related should NOT retry (a retry loop on real bugs
 * is a swallowed-bug magnet).
 */
function isShinamiAuthFailure(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return /\b(401|403)\b/.test(msg) || /unauthori[sz]ed|forbidden/i.test(msg);
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
  // Sui validator-side rule (docs-confirmed):
  // https://docs.sui.io/develop/transaction-payment/gasless-stablecoin-transfers
  //   "All gasless stablecoin transfers have a minimum transfer balance
  //    of 0.01. Transfers below this minimum will not be executed."
  // 0.01 USDsui = 10,000 µ. Reject upfront with a clear copy instead of
  // letting the validator reject the tx ~1s later under an opaque
  // "Invalid withdraw reservation" string.
  const MIN_GASLESS_MICROS = 10_000n;
  if (asset === "USDsui" && onchain < MIN_GASLESS_MICROS) {
    return NextResponse.json(
      {
        error:
          "Gasless USDsui sends have a 0.01 minimum. Increase the amount to at least 0.01 USDsui and try again.",
        code: "BELOW_GASLESS_MINIMUM",
        minMicros: MIN_GASLESS_MICROS.toString(),
      },
      { status: 400 }
    );
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
  // Tracks whether the fall-through was triggered by the "no
  // address-owned input" dead-end specifically (vs the older
  // Coin-state mismatch). When true, response surfaces
  // mode: "sponsored-anchor-fallback" instead of
  // "sponsored-coin-fallback" so logs + iOS analytics can tell them
  // apart.
  let gaslessFellBackReason: "coin" | "anchor" = "coin";

  if (asset === "USDsui") {
    try {
      const t0 = Date.now();
      const client = sui();
      const tx = new Transaction();
      tx.setSender(user.sui_address);

      // ───────────────────────────────────────────────────────────────
      // DIRECTIVE (2026-05-30): accumulator-only PTB + ValidDuring
      // expiration to satisfy the validator's escape-hatch rule.
      //
      // The validator requires every PTB to EITHER carry an
      // address-owned input OR set a `ValidDuring` expiration with at
      // most two epochs of validity. A pure accumulator pull
      // (`tx.balance({balance})`) has no address-owned input, so the
      // escape hatch is mandatory. This is exactly what the SDK's own
      // parallel executor does in `addressBalance` gas mode — see
      // `@mysten/sui/transactions/executor/parallel.mjs`
      // (#getValidDuringExpiration), which we mirror verbatim below.
      //
      // CRITICAL: build the PTB with a `SuiJsonRpcClient`, NOT the
      // gRPC client. The gRPC SDK's resolveTransactionPlugin chokes on
      // the `ValidDuring` variant with "unknown TransactionExpirationKind"
      // (see `web/scripts/probe-valid-during.mjs` — gRPC build fails,
      // JSON-RPC build succeeds, dryRun OK, gRPC simulate accepts the
      // resulting bytes). The execute path stays on gRPC because
      // `executeTransaction` is byte-encoded and the gRPC service
      // accepts the encoded ValidDuring just fine — it's only the
      // SDK's build-time simulate that has the bug. Drop the JSON-RPC
      // dep here once Mysten ships gRPC ValidDuring decoding.
      tx.moveCall({
        target: "0x2::balance::send_funds",
        typeArguments: [USDSUI_TYPE],
        arguments: [
          tx.balance({ type: USDSUI_TYPE, balance: onchain }),
          tx.pure.address(to),
        ],
      });
      // Both gasPrice AND gasBudget must be explicitly 0; the validator's
      // gasless gate rejects auto-picked budgets even when the price is 0.
      tx.setGasPrice(0n);
      tx.setGasBudget(0n);

      // ValidDuring escape hatch: tells the validator this PTB is
      // valid for the current + next epoch, which is the maximum
      // window the gasless rail allows. `chain` MUST be the base58
      // chainIdentifier from `core.getChainIdentifier()`, NOT a
      // network label.
      //
      // Endpoint selection: `getJsonRpcClient()` returns Shinami when
      // `SHINAMI_NODE_API_KEY` is set, else the public fullnode. The
      // chain-id + epoch lookups go through the same client so the
      // entire gasless build leans on one paid endpoint (when
      // configured) instead of mixing public + paid hosts mid-flow.
      let jsonClient = getJsonRpcClient();
      let usingShinami = shinamiSuiNodeJsonRpc() !== null;
      const [chainId, currentEpoch] = await Promise.all([
        jsonClient.core.getChainIdentifier().then((r) => r.chainIdentifier),
        getCurrentEpoch(),
      ]);
      const epochBig = BigInt(currentEpoch);
      tx.setExpiration({
        ValidDuring: {
          minEpoch: String(epochBig),
          maxEpoch: String(epochBig + 1n),
          minTimestamp: null,
          maxTimestamp: null,
          chain: chainId,
          nonce: (Math.random() * 4294967296) >>> 0,
        },
      });

      // Build via JSON-RPC — see comment above. gRPC SDK fails here
      // with "unknown TransactionExpirationKind".
      //
      // One-shot retry: if Shinami rejects auth (401/403 — most
      // likely cause is a rotated or revoked key, NOT a transient
      // outage), rebuild ONCE against the public fullnode. We do
      // NOT retry on other error classes — the validator-side
      // gasless rejections below are categorized by the outer catch
      // and a retry there would just swallow real bugs.
      let bytes: Uint8Array;
      try {
        bytes = await tx.build({ client: jsonClient as never });
      } catch (buildErr) {
        if (usingShinami && isShinamiAuthFailure(buildErr)) {
          console.warn(
            `[send/sponsor-prepare] Shinami JSON-RPC build rejected (auth) — retrying via public fullnode. detail=${(buildErr as Error).message?.slice(0, 200)}`
          );
          // Invalidate the Shinami singleton so subsequent requests
          // re-discover the key (no point holding a cached client
          // that we know is broken).
          _jsonRpcShinami = null;
          jsonClient = buildPublicJsonRpc();
          usingShinami = false;
          bytes = await tx.build({ client: jsonClient as never });
        } else {
          throw buildErr;
        }
      }
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
      // Detect the "no address-owned input available" failure mode:
      // after a user's Coin<USDsui> objects are all consolidated into
      // the accumulator (which happens as a side-effect of the first
      // successful gasless send via tx.balance()'s auto-fallback), the
      // next gasless tx fails with:
      //   "Invalid transaction expiration: Transactions must either
      //    have address-owned inputs, or a ValidDuring expiration with
      //    at most two epochs of validity"
      // The Epoch / ValidDuring escape hatches are blocked by a
      // validator-side gRPC encoding bug ("unknown
      // TransactionExpirationKind") so we surface a precise 400
      // explaining the dead-end + how to recover (receive any inbound
      // USDsui to land a fresh Coin<T> object → next send works).
      if (
        /Invalid transaction expiration/i.test(msg) ||
        /address-owned inputs/i.test(msg) ||
        /ValidDuring expiration/i.test(msg)
      ) {
        // PRODUCT DECISION (per user's forensic analysis): when the
        // user is fully consolidated into the accumulator (no Coin
        // anchor available) and the validator's ValidDuring escape
        // hatch is still broken upstream, the send MUST still land.
        // Fall through to Onara-sponsored Payment Kit instead of
        // refusing.
        //
        // Surfaced to iOS as `mode: "sponsored-anchor-fallback"` so
        // analytics + logs can distinguish this specific dead-end
        // from regular sponsored sends or the older
        // `sponsored-coin-fallback`. The user "didn't get gasless"
        // — that's documented honestly in the mode — but their
        // tx LANDS, which is the higher-priority constraint when the
        // alternative is "your send fails until a third party sends
        // you USDsui via legacy primitives".
        //
        // When Sui ships the validator-side ValidDuring fix (or a
        // public Balance→Coin escape hatch), this branch's fall-
        // through becomes unnecessary and we can return to the 400.
        console.warn(
          `[send/sponsor-prepare] gasless requires address-owned input but user=${userId} has none (all USDsui in accumulator); falling through to sponsored-anchor-fallback. detail=${msg.slice(0, 200)}`
        );
        gaslessFellBack = true;
        gaslessFellBackReason = "anchor";
        // Intentional fall-through to the sponsored Payment Kit
        // branch below.
      } else
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
          `[send/sponsor-prepare] gasless unreachable for user=${userId} (accumulator underfunded); SnS off — returning ACCUMULATOR_UNDERFUNDED 400. detail=${msg.slice(0, 200)}`
        );
        // The clean 2-call gasless pattern requires the requested amount
        // to live in the user's Address Balance accumulator. Coin<T>
        // objects can NOT fund this PTB (no auto-fallback, by design).
        // The user-facing remediation is now: top up via Stripe (lands
        // directly in the accumulator) OR use the manual swap CTA on
        // Home to convert other coins to USDsui. We no longer surface
        // a `canConsolidate` hint — the consolidation offer flow was
        // removed alongside the autoswap archive (2026-05-29).
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
            error: "Gasless USDsui send is currently unavailable. Please try again in a moment.",
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
      ? gaslessFellBackReason === "anchor"
        ? "sponsored-anchor-fallback"
        : "sponsored-coin-fallback"
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
