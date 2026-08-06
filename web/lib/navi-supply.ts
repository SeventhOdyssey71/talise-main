import "server-only";

import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import {
  depositCoinPTB,
  withdrawCoinPTB,
  getUserAvailableLendingRewards,
  claimLendingRewardsPTB,
  type LendingReward,
  getPools,
  updateOraclePriceBeforeUserOperationPTB,
  type Pool,
} from "@naviprotocol/lending";
import { isUsdsui, USDSUI_TYPE } from "./usdsui";
import { USDSUI_DECIMALS, sui } from "./sui";
import { memoTtl } from "./perf-cache";
import { sourceUsdsuiCoin } from "./usdsui-coin";
import { naviGrpcCompatClient } from "./navi-grpc-client";
import { cetusUniverse, normCoinType } from "./cetus-tokens";

/**
 * NAVI USDsui supply / withdraw, sponsor-friendly PTB builders.
 *
 * Why this exists separately from deepbook-margin.ts: NAVI's protocol
 * registry, supply oracle (Pyth), and reserve metadata all live behind
 * @t2000/sdk's `NaviAdapter`. The adapter's `addSaveToTx` /
 * `addWithdrawToTx` methods append the right MoveCalls onto an existing
 * Transaction, we just need to feed them a sender + a pre-split coin
 * handle (`coinWithBalance` so we never touch the gas coin, which
 * belongs to Onara during the sponsored leg).
 *
 * `NaviAdapter` was made public in @t2000/sdk 2.11, the earlier
 * private `save` ergonomics that blocked mobile aren't a constraint
 * anymore. With this in place, NAVI is the real default yield venue
 * (live ~5% APY on mainnet) and DeepBook margin USDsui can be
 * de-emphasized until its borrow demand picks up.
 */

// NAVI's adapter keys assets by their `symbol` (mixed case "USDsui"),
// not the uppercased registry key, verified from
// `SUPPORTED_ASSETS.USDsui.symbol` in @t2000/sdk 2.11.
const NAVI_ASSET = "USDsui";

/**
 * Treasury wallet that collects the save / spend-and-save fee. Env-overridable
 * so it can be rotated without a redeploy; defaults to the founder treasury.
 */
export const TREASURY_WALLET =
  process.env.TALISE_TREASURY_WALLET?.trim() ||
  "0xc0bf1c51e44f8cfa4a06f16a2408effa3507ac4582744c7ead56078b5e251a48";

/** Save / spend-and-save treasury fee, in basis points (100 = 1%). */
export const SAVE_TREASURY_FEE_BPS = 100;

/**
 * gRPC-NATIVE NAVI. `@t2000/sdk`'s NaviAdapter (and the Pyth SDK it delegates
 * to for oracle refresh) was written against the legacy JSON-RPC `SuiClient`
 * surface, it calls `devInspectTransactionBlock`, `getObject`,
 * `multiGetObjects`, `getDynamicFieldObject`, `getCoins`/`getBalance`. Talise's
 * transport is gRPC-only, so we feed the adapter a compatibility client
 * (`naviGrpcCompatClient`) that maps every one of those onto gRPC primitives
 * and reshapes the results into the JSON-RPC shapes the SDK reads.
 *
 * This retires the previous JSON-RPC dependency (`SUI_JSONRPC_URL` / the
 * public mainnet fullnode that is being decommissioned) for NAVI Earn. See
 * `lib/navi-grpc-client.ts` for the full mapping + rationale, and
 * `scripts/navi-grpc-validate.mjs` for the read-only parity proof that the
 * gRPC-native position read matches the JSON-RPC path bit-for-bit.
 */
/**
 * The USDsui lending pool, memoized. `@naviprotocol/lending` addresses pools by
 * `AssetIdentifier` and resolves the live package + storage ids itself, which is
 * the whole reason we are on it: the id set moves when NAVI upgrades, and a
 * pinned one produces a PTB that fails resolution rather than a clean error.
 */
let _poolP: Promise<Pool | null> | null = null;
async function usdsuiPool(): Promise<Pool | null> {
  if (_poolP) return _poolP;
  _poolP = (async () => {
    const pools = await getPools();
    const match = pools.find(
      (p) => (p.suiCoinType ?? "").toLowerCase() === USDSUI_TYPE.toLowerCase()
    );
    return match ?? null;
  })().catch(() => {
    _poolP = null;
    return null;
  });
  return _poolP;
}


/**
 * Pre-warm the NAVI supply path so the first Spend + Save send doesn't pay the
 * cold RPC cost inside `appendNaviSupply`.
 *
 * MEASURED (2026-07-25, mainnet, scripts/probes/probe-spend-save-latency.mjs):
 *
 *   NaviAdapter.init()                             0 ms
 *   appendNaviSupply, 1st call in a fresh process   3344 ms   ← the real cost
 *   appendNaviSupply, subsequent calls              p50 464 / p95 857 ms
 *   appendNaviSupply, 1st call after this warm      ~276 ms
 *
 * So the previous version of this function — which only awaited `adapter()` —
 * warmed NOTHING. `init()` is lazy: it registers the client and returns without
 * a single network round-trip (0 ms, measured). Everything expensive (pool
 * registry, reserve metadata, the Pyth oracle tables) is fetched lazily the
 * first time `addSaveToTx` runs, i.e. inside the user's send. That is the 3.3s
 * this warm exists to absorb, and it was being missed entirely.
 *
 * The fix is to warm through the same call the send path uses: build a
 * THROWAWAY supply onto a Transaction we never build, sign or broadcast. It is
 * pure reads, it populates exactly the caches `appendNaviSupply` needs, and the
 * Transaction is garbage collected.
 *
 * Intentionally NOT called at module load (it does RPC and would stall every
 * cold start, including handlers that never touch NAVI). The right place is
 * `/api/zk/warmup`, which the clients hit on dashboard load, so the cost hides
 * behind the user reading their balances rather than behind the Send button.
 *
 * Returns true on successful warm, false on any failure. A warmup failure is
 * never surfaced to the user: the send path re-attempts, and if NAVI is
 * genuinely down the send still lands without the save leg.
 */
export async function initNaviAdapter(warmAddress?: string): Promise<boolean> {
  try {
    await usdsuiPool();
    // Any address works: the expensive caches (pool registry, reserve
    // metadata, Pyth price tables) are GLOBAL, and only the `listCoins` read
    // inside `sourceUsdsuiCoin` is per-address. VERIFIED by probe
    // (MODE=prewarm-other): warming through the treasury address took the
    // first call for an unrelated user from 3344 ms to 268 ms. That is what
    // lets `/api/zk/warmup` stay unauthenticated.
    const addr = warmAddress ?? TREASURY_WALLET;
    // 0.01 USDsui is the smallest round-up we ever build, so this warms the
    // exact code path at the exact scale the hot path uses.
    const throwaway = new Transaction();
    throwaway.setSender(addr);
    await appendNaviSupply(throwaway, addr, 0.01);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a NAVI USDsui supply step onto an existing Transaction.
 * Caller wraps with `tx.setSender(...)` + `onlyTransactionKind: true`
 * before handing to Onara.
 *
 * Uses `coinWithBalance` (not `splitCoins(tx.gas)`) because the gas
 * coin is sponsor-owned in the sponsored flow, splitting from it
 * would have the wallet trying to pay gas with someone else's SUI.
 */
export async function appendNaviSupply(
  tx: Transaction,
  senderAddress: string,
  amountUsdsui: number,
  opts?: {
    /**
     * Treasury fee in basis points skimmed from the supplied amount and sent to
     * {@link TREASURY_WALLET} in the SAME atomic PTB (100 = 1%). Set this ONLY
     * on the save / spend-and-save (round-up) legs; the direct Earn deposit
     * passes nothing (it is the yield product, not a save). Of `amountUsdsui`,
     * `feeBps` goes to the treasury and the remainder is supplied to yield.
     */
    treasuryFeeBps?: number;
  }
): Promise<void> {
  const onchain = BigInt(Math.round(amountUsdsui * 10 ** USDSUI_DECIMALS));
  if (onchain <= 0n) {
    throw new Error("amount too small");
  }
  // Source from coins OR the Address-Balance accumulator, most users' USDsui is
  // in the accumulator (gasless rail), where a coins-only `coinWithBalance` would
  // revert (this silently broke earn supply + spend-and-save). See lib/usdsui-coin.ts.
  const coin = await sourceUsdsuiCoin(tx, senderAddress, onchain);

  // Treasury fee: split `feeBps` off the supply coin and send it to the
  // treasury wallet atomically, then supply the remainder. `splitCoins`
  // mutates `coin` to hold the leftover, so the supply leg gets (100% − fee).
  const feeBps = BigInt(Math.max(0, Math.floor(opts?.treasuryFeeBps ?? 0)));
  if (feeBps > 0n) {
    const fee = (onchain * feeBps) / 10_000n;
    if (fee > 0n) {
      const [feeCoin] = tx.splitCoins(coin, [fee]);
      tx.transferObjects([feeCoin], TREASURY_WALLET);
    }
  }

  const pool = await usdsuiPool();
  if (!pool) throw new Error("NAVI USDsui pool unavailable");
  await depositCoinPTB(tx, pool, coin, { amount: Number(onchain) });
}

/**
 * Build a NAVI USDsui withdraw step. `amount === undefined | <= 0` is
 * treated as "withdraw everything I have supplied", the adapter
 * resolves the live supplied amount internally.
 *
 * `skipPythUpdate: false` keeps the oracle refresh in the PTB, which
 * NAVI requires for the position health check during withdraw.
 */
export async function appendNaviWithdraw(
  tx: Transaction,
  senderAddress: string,
  amountUsdsui: number | undefined
): Promise<void> {
  const pool = await usdsuiPool();
  if (!pool) throw new Error("NAVI USDsui pool unavailable");

  // NAVI needs a fresh oracle price for the health check that guards a
  // withdraw. The SDK appends exactly the feeds this pool requires; the old
  // adapter had to be told to SKIP its own Pyth push because that branch left
  // an undestroyed hot potato in the PTB.
  await updateOraclePriceBeforeUserOperationPTB(tx, senderAddress, [pool]);

  let micros: number;
  if (Number.isFinite(amountUsdsui) && (amountUsdsui ?? 0) > 0) {
    micros = Math.round((amountUsdsui as number) * 10 ** USDSUI_DECIMALS);
  } else {
    // "Withdraw everything": read the live supplied balance. Anything that
    // accrues between the read and the submit is picked up next time.
    const supplied = await readNaviUsdsuiSupply(senderAddress);
    micros = Math.round(supplied * 10 ** USDSUI_DECIMALS);
    if (micros <= 0) throw new Error("no NAVI USDsui position to withdraw");
  }

  // SingleCoinTransactionResult is a tuple-like: the withdrawn coin is [0].
  const [coin] = await withdrawCoinPTB(tx, pool, micros);
  tx.transferObjects([coin], senderAddress);
}

/**
 * Fetch the live USDsui supply APY from NAVI's public open API.
 *
 * Why this exists: `@t2000/sdk`'s `getFinancialSummary` returns the
 * USDC `saveApy` regardless of the actual reserve asset, its
 * `getRates()` populates `result.USDC.saveApy` but never adds a
 * USDsui key, then `getFinancialSummary` reads `rates.USDC?.saveApy`
 * unconditionally. That caused the iOS Earn screen to render
 * USDC's 5.73% as Navi's USDsui APY when the actual on-portal
 * USDsui figure is 9.18%.
 *
 * `supplyIncentiveApyInfo.apy` is the same number the Navi UI shows
 * (vaultApr + boostedApr from reward tokens). Returned as a
 * fraction (0.0918 for 9.18%) so it slots straight into the
 * existing `YieldVenue.apy` shape.
 *
 * 60s TTL keeps the iOS load fast; Navi APYs change on the order of
 * hours. Returns null on any fetch / parse failure so callers can
 * fall back to the SDK number (still wrong, but better than 0).
 */
const NAVI_POOLS_URL = "https://open-api.naviprotocol.io/api/navi/pools?env=prod";
const NAVI_CONFIG_URL = "https://open-api.naviprotocol.io/api/navi/config?env=prod";

type NaviPoolRow = {
  /** NAVI reserve/asset id (matches the on-chain `UserStateInfo.asset_id`). */
  id: number;
  coinType: string;
  /** Ray-scaled (1e27) supply index, multiply the user's raw scaled
   *  supply balance by this to get the redeemable amount in base units. */
  currentSupplyIndex?: string;
  token?: { decimals?: number; symbol?: string };
  supplyIncentiveApyInfo?: { apy?: string };
};

/**
 * Fetch + cache NAVI's full pool list from the public open API.
 *
 * Shared by the APY read AND the direct position read (below) so a single
 * 60s-cached round-trip serves both, the hot path then only pays for the
 * per-user `devInspect` (~1–2s) instead of re-fetching pool metadata each
 * time. Returns `[]` on any fetch/parse failure so callers degrade to
 * null/0 rather than throwing.
 */
async function fetchNaviPoolsOnce(): Promise<NaviPoolRow[]> {
  try {
    const res = await fetch(NAVI_POOLS_URL, {
      // Don't cache at the fetch layer, memoTtl handles TTL.
      cache: "no-store",
      // Conservative deadline so a slow Navi response doesn't stall
      // the whole /api/yield/comparison handler.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: NaviPoolRow[] };
    return body?.data ?? [];
  } catch {
    return [];
  }
}

async function fetchNaviPools(): Promise<NaviPoolRow[]> {
  return memoTtl("navi:pools", 60_000, fetchNaviPoolsOnce);
}

function findUsdsuiPool(pools: NaviPoolRow[]): NaviPoolRow | undefined {
  return pools.find(
    (p) => p.coinType && isUsdsui("0x" + p.coinType.replace(/^0x/, ""))
  );
}

export async function fetchNaviUsdsuiSupplyApy(): Promise<number | null> {
  const pools = await fetchNaviPools();
  const row = findUsdsuiPool(pools);
  const apyPct = parseFloat(row?.supplyIncentiveApyInfo?.apy ?? "");
  if (!Number.isFinite(apyPct) || apyPct < 0 || apyPct > 200) return null;
  return apyPct / 100;
}

// ───────────────────────────────────────────────────────────────────
// Direct NAVI position read (no @t2000/sdk).
//
// `@t2000/sdk`'s `NaviAdapter.getPositions()` cost ~4–9s on the hot path
// because it re-initialised the pool registry from chain and routed the
// read through a heavyweight summary. We read the user's USDsui supply
// the SAME way NAVI's own getters do, a single `devInspect` of
// `<uiGetter>::getter_unchecked::get_user_state(storage, address)`, and
// convert with the live pool's supply index + decimals.
//
// `get_user_state` returns `vector<UserStateInfo>` where each row is the
// user's scaled (ray-normalised) per-asset position. The redeemable amount
// is `scaled * currentSupplyIndex / 1e27` (rounded), but that result is in
// NAVI's INTERNAL 9-decimal normalised accounting precision, NOT the coin's
// native decimals. So human units = base / 10^9, regardless of USDsui being
// a 6-decimal coin.
//
// THIS WAS THE BUG 7f5cc4d shipped: it divided by `token.decimals` (6),
// over-dividing by 10^3 and inflating the position ~1000x (a 0.004646 USDsui
// dust position read as 4.646928, which is why the Earn screen showed
// ₦6,373.94 / "Earned so far" ₦5,615.68 for what is really a few naira).
// Verified live against `NaviAdapter.getPositions()` (the t2000 adapter,
// which correctly uses 9): base 4_646_928 / 10^9 = 0.004646928 == adapter's
// 0.004646, while / 10^6 = 4.646928 was 1000x too high. NAVI normalises every
// reserve's scaled amount to 9 decimals; that, not the coin precision, is
// the divisor.

type NaviConfig = { uiGetter: string; storage: string };

async function fetchNaviConfigOnce(): Promise<NaviConfig | null> {
  try {
    const res = await fetch(NAVI_CONFIG_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Partial<NaviConfig> };
    const cfg = body?.data;
    if (!cfg?.uiGetter || !cfg?.storage) return null;
    return { uiGetter: cfg.uiGetter, storage: cfg.storage };
  } catch {
    return null;
  }
}

async function fetchNaviConfig(): Promise<NaviConfig | null> {
  return memoTtl("navi:config", 5 * 60_000, fetchNaviConfigOnce);
}

/** On-chain `UserStateInfo` struct returned by `get_user_state`. */
const UserStateInfo = bcs.struct("UserStateInfo", {
  asset_id: bcs.u8(),
  borrow_balance: bcs.u256(),
  supply_balance: bcs.u256(),
});

const RAY = 10n ** 27n;

/**
 * NAVI normalises every reserve's scaled supply/borrow amount to a fixed
 * 9-decimal internal precision, independent of the coin's native decimals.
 * So `rayMul(scaled, index)` is in 9-dp normalised units → divide by 10^9 for
 * human units. (Confirmed against `NaviAdapter.getPositions()`; see the block
 * comment above `readNaviUsdsuiSupply`.)
 */
const NAVI_NORMALIZED_DECIMALS = 9;

/** rayMul: scaled supply balance × supply index ÷ 1e27 (round half-up). */
function rayMul(rawScaled: string, supplyIndex: string): bigint {
  let r: bigint;
  let i: bigint;
  try {
    r = BigInt(rawScaled);
    i = BigInt(supplyIndex);
  } catch {
    return 0n;
  }
  if (r === 0n || i === 0n) return 0n;
  return (r * i + RAY / 2n) / RAY;
}

/**
 * Read the user's redeemable USDsui supply balance (human units) directly
 * from NAVI's on-chain getter. Returns 0 for an empty position and 0 on
 * any failure (never throws into the hot path).
 */
export async function readNaviUsdsuiSupply(address: string): Promise<number> {
  try {
    const [cfg, pools] = await Promise.all([
      fetchNaviConfig(),
      fetchNaviPools(),
    ]);
    const usdsui = findUsdsuiPool(pools);
    if (!cfg || !usdsui) return 0;

    const tx = new Transaction();
    tx.moveCall({
      target: `${cfg.uiGetter}::getter_unchecked::get_user_state`,
      arguments: [tx.object(cfg.storage), tx.pure.address(address)],
    });

    const inspect = (await (
      naviGrpcCompatClient() as {
        devInspectTransactionBlock: (p: {
          transactionBlock: Transaction;
          sender: string;
        }) => Promise<{ results?: Array<{ returnValues?: Array<[number[], string]> }> }>;
      }
    ).devInspectTransactionBlock({
      transactionBlock: tx,
      sender: address,
    }));
    const bytes = inspect.results?.[0]?.returnValues?.[0]?.[0];
    if (!bytes || bytes.length === 0) return 0;

    const rows = bcs.vector(UserStateInfo).parse(Uint8Array.from(bytes));
    const row = rows.find((r) => Number(r.asset_id) === Number(usdsui.id));
    if (!row) return 0;

    const base = rayMul(
      String(row.supply_balance),
      String(usdsui.currentSupplyIndex ?? "0")
    );
    // Divide by NAVI's 9-decimal internal normalisation, NOT the coin's native
    // `token.decimals` (6). See the block comment above, using token.decimals
    // here is what inflated the position ~1000x.
    const human = Number(base) / 10 ** NAVI_NORMALIZED_DECIMALS;
    return Number.isFinite(human) && human > 0 ? human : 0;
  } catch {
    return 0;
  }
}

/**
 * Live NAVI USDsui position for `address`, with an estimated "earned"
 * breakdown derived from on-chain activity.
 *
 * Data-source decision (Approach A from the spec):
 *   - `currentValue` comes straight from `NaviAdapter.getPositions()` -
 *     the USDsui supply row's `amount` is the principal-plus-accrued
 *     redeemable balance (Navi accrues interest into the position
 *     in-place; there's no separate accrual ledger exposed via SDK,
 *     and Navi's open API only surfaces pool-level data).
 *   - `principalSupplied` is reconstructed by replaying the user's
 *     on-chain Talise Payment-Kit memos: every invest/withdraw to
 *     `venue=navi` carries a typed memo (`talise/v1|invest|...|venue=navi|...`)
 *     whose `amount` field is the canonical USDsui amount the user
 *     supplied or withdrew. The caller passes the parsed activity list
 *     so we don't double-fetch, the comparison route already has it.
 *   - `earned = max(0, currentValue − principalSupplied)`. The floor at
 *     0 protects against transient gaps (e.g. user supplied 100, then
 *     withdrew 100 → we'd read a near-zero current value but the
 *     activity replay nets to 0; rounding noise could go negative).
 *
 * If we can't determine principal (no activity hits for navi, or the
 * activity feed errored out), `principalSupplied` is returned as
 * `currentValue` so `earned` falls to 0, better to under-report than
 * accidentally show negative or inflated earnings.
 */
export type NaviPositionDetail = {
  /** Current redeemable USDsui balance. Includes accrued interest. */
  currentValue: number;
  /** Estimated principal supplied (= currentValue − accrued interest). */
  principalSupplied: number;
  /**
   * Everything the position has made: accrued interest
   * (currentValue × apy × elapsed streak / year) PLUS the USD value of
   * claimable incentive rewards, which live outside currentValue.
   */
  earned: number;
  /** `currentValue × apy / 365`, per-day growth at this APY. */
  dailyEarning: number;
  /** Live USDsui supply APY as a fraction (0.0917 = 9.17%). */
  apy: number;
  /**
   * Epoch-ms the CURRENT earning streak started (the deposit that took the
   * position from 0 → positive; resets on a full withdrawal). null when there's
   * no active position. The client ticks `earned` live from this + apy +
   * currentValue, and projects year-end = currentValue × apy.
   */
  earningSinceMs: number | null;
};

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export async function fetchNaviCurrentValue(address: string): Promise<number> {
  // Direct on-chain read (see `readNaviUsdsuiSupply`), dropped the
  // @t2000/sdk `NaviAdapter.getPositions()` path, which cost ~4–9s.
  return readNaviUsdsuiSupply(address);
}

/**
 * Compute the NAVI USDsui position breakdown for an address, given a
 * pre-fetched activity feed (the `venue == 'navi'` rows). Returning a
 * function rather than fetching activity here avoids a second
 * `queryTransactionBlocks` round-trip, callers (`/api/yield/comparison`,
 * `/api/earn/withdraw-earned/prepare`) already have or can cheaply
 * fetch the activity list once.
 *
 * Earned-interest derivation strategy:
 *
 *   1. Replay the `invest`/`withdraw` rows in chronological order against a
 *      running balance to find when the CURRENT streak began: the deposit that
 *      took the position 0 → positive. A withdrawal back to zero resets it, so
 *      churning in and out can't accumulate credit for time not held.
 *
 *   2. `interest = currentValue × apy × (now − streakStart) / 365d`, clamped at
 *      currentValue as a guard against bad activity data.
 *
 *      Summing deposits and subtracting from the balance — the obvious
 *      alternative — does not work here. NAVI normalises USDsui's 6 decimals
 *      into 9-decimal internal accounting and rounds dust DOWN on every
 *      deposit, so for anyone supplying many small amounts the deposit sum
 *      exceeds the redeemable balance before a cent of interest exists, and
 *      earned floors at 0 permanently.
 *
 *   3. When the activity window doesn't reach the opening deposit, fall back to
 *      `anchorMs` (see the parameter docs). Without that fallback the streak is
 *      simply not found and a months-old position reports zero.
 *
 *   4. Add the USD value of claimable incentive rewards (`rewardsUsd`). These
 *      are a separate coin, not part of currentValue, and they are the part the
 *      user can claim on its own.
 */
export function naviPositionFromActivity(opts: {
  currentValue: number;
  apy: number;
  naviActivity: Array<{
    direction: "invest" | "withdraw" | string;
    venue: string | null;
    amountUsdsui: number | null;
    /** Optional; used by the time-weighted projection fallback. */
    timestampMs?: number;
  }>;
  /**
   * Streak start remembered from an earlier request, used ONLY when the
   * activity window doesn't reach far enough back to contain the supply that
   * started it. See the `anchorMs` discussion in the caller.
   */
  anchorMs?: number | null;
  /** USD value of claimable incentive rewards; folded into `earned`. */
  rewardsUsd?: number;
}): NaviPositionDetail {
  const { currentValue, apy } = opts;
  const dailyEarning = currentValue * apy / 365;

  // Replay NAVI invests/withdraws in CHRONOLOGICAL order, tracking a running
  // net balance, to find when the CURRENT earning streak began. The streak
  // starts when the balance crosses 0 → positive, and RESETS on a full
  // withdrawal. So deposit/withdraw churn can't inflate earnings: fully
  // cashing out and re-depositing restarts the clock from now.
  const rows = opts.naviActivity
    .filter(
      (r) =>
        (r.venue ?? "").toLowerCase() === "navi" &&
        Math.abs(r.amountUsdsui ?? 0) > 0 &&
        (r.direction === "invest" || r.direction === "withdraw")
    )
    .map((r) => ({
      dir: r.direction,
      amt: Math.abs(r.amountUsdsui ?? 0),
      ts: r.timestampMs ?? 0,
    }))
    .sort((a, b) => a.ts - b.ts);

  const EPS = 1e-9;
  let bal = 0;
  let streakStart: number | null = null;
  for (const r of rows) {
    if (r.dir === "invest") {
      // 0 → positive: a (re)start of the earning streak.
      if (bal <= EPS && r.ts > 0) streakStart = r.ts;
      bal += r.amt;
    } else {
      bal -= r.amt;
      if (bal <= EPS) {
        bal = 0;
        streakStart = null; // fully withdrawn → streak ends, clock resets
      }
    }
  }

  // The replay only sees a WINDOW of recent activity. A long-tenured supplier's
  // opening deposit falls out of that window, and then this loop finds either
  // nothing or — worse — a lone withdraw, which drives the running balance
  // negative and leaves `streakStart` null. Both produce earned = 0 for someone
  // who has been earning for months. Worse still, whether the window reaches
  // back far enough depended on a 4s race in the caller, so the same account
  // showed a real figure on one client and zero on another, minutes apart.
  //
  // So: a start found in the window always wins (it has the withdrawal-reset
  // semantics), but when the window yields nothing we fall back to the anchor
  // the caller remembered from a request where it did.
  const resolvedStart = streakStart ?? (opts.anchorMs && opts.anchorMs > 0 ? opts.anchorMs : null);

  // Real accrued yield = current balance × APY × (time held this streak).
  // No artificial cap/floor games, the streak reset is what keeps it honest;
  // a single sanity clamp at 100% guards against bad activity data only. The
  // client re-derives + ticks this live from `earningSinceMs`.
  let interest = 0;
  if (resolvedStart && resolvedStart > 0 && apy > 0 && currentValue > 0) {
    const elapsed = Math.max(0, Date.now() - resolvedStart);
    interest = Math.min(currentValue, currentValue * apy * (elapsed / YEAR_MS));
  }

  // Two things earn on a NAVI supply and a user is owed both: interest, which
  // compounds into the redeemable balance, and incentive rewards, which sit in
  // a separate coin until claimed. Only the second is claimable on its own —
  // which is exactly what the Claim button now does — so leaving it out of
  // "Earned so far" made the screen contradict its own button.
  const rewardsUsd = Math.max(0, opts.rewardsUsd ?? 0);
  const earned = interest + rewardsUsd;

  return {
    currentValue,
    // Principal is what's left of the BALANCE after interest. Rewards are a
    // separate coin and were never part of currentValue, so subtracting them
    // here would understate what the user actually has supplied.
    principalSupplied: Math.max(0, currentValue - interest),
    earned,
    dailyEarning,
    apy,
    earningSinceMs: resolvedStart,
  };
}

// ── NAVI incentive rewards ────────────────────────────────────────────────
//
// These are SEPARATE from the supplied balance. NAVI pays lenders incentive
// tokens (vSUI on the USDsui pool today) that accrue alongside interest and are
// claimed with their own call. Claiming them does NOT touch supplied capital,
// which is the whole point: a user should be able to take their rewards and
// leave the position earning.

export type NaviClaimableReward = {
  rewardCoinType: string;
  /** Human units of the REWARD coin, not USD. */
  amount: number;
};

/**
 * Rewards this address can claim right now. Empty on any failure — a rewards
 * read must never block the Earn screen from rendering the position.
 */
export async function fetchNaviClaimableRewards(
  address: string
): Promise<NaviClaimableReward[]> {
  try {
    // Warm the pool set FIRST. `getUserAvailableLendingRewards` lazily
    // bootstraps NAVI's config on its first call, and it is the same bootstrap
    // `getPools` does — whichever runs first pays for it. Called cold and
    // first, this read takes 4891ms; called after `getPools`, 1848ms, and 486ms
    // warm. `usdsuiPool()` shares one memoized promise, so this is free
    // whenever anything else already needed the pools.
    await usdsuiPool();
    const list = await getUserAvailableLendingRewards(address);
    return (list ?? [])
      .map((r) => ({
        rewardCoinType: String(r.rewardCoinType ?? ""),
        amount: Number(r.userClaimableReward ?? 0),
      }))
      .filter((r) => r.rewardCoinType && r.amount > 0);
  } catch (e) {
    console.warn(`[navi] claimable rewards read failed: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Total USD value of everything claimable right now.
 *
 * Rewards are paid in a coin that is NOT the supplied asset (vSUI on the USDsui
 * pool today), so the raw amount means nothing to a user reading a savings
 * screen — 0.06 of something isn't a number you can act on. Priced through the
 * Cetus universe, the same derivation the wallet already uses for token
 * buckets, so a reward and a balance can't disagree about what a coin is worth.
 *
 * Returns 0 rather than throwing: a price lookup must never be able to blank
 * out the position itself.
 */
export async function fetchNaviRewardsUsd(address: string): Promise<number> {
  // Both legs start together. Run end-to-end in sequence this cost 9321ms cold
  // against a 5s cap in the caller, so the first Earn load of a cold instance
  // silently reported zero rewards and only a manual refresh — landing on the
  // now-warm instance — showed the real figure.
  const [rewards, universe] = await Promise.all([
    fetchNaviClaimableRewards(address),
    cetusUniverse().catch(() => null),
  ]);
  if (rewards.length === 0) return 0;
  try {
    // MARKET price first, NAVI's oracle only as a fallback.
    //
    // The instinct is to trust the protocol paying the reward, but its oracle
    // is built for collateral health, not for telling someone what their coins
    // are worth. It prices SUI exactly right and vSUI at 1.0003× SUI, while the
    // market pays 1.066× — vSUI is liquid-staked SUI and accrues staking
    // rewards, so it has to trade above it. Checked against a quote that could
    // actually be executed:
    //
    //   vSUI: NAVI oracle $0.6764 | 1 vSUI -> $0.7208  (oracle 6.2% low)
    //   SUI : NAVI oracle $0.6762 | 1 SUI  -> $0.6763  (oracle 0.0% off)
    //
    // The 6% is the staking premium NAVI's feed ignores. Quoting the low number
    // would also mean the Earn screen valuing a reward below what the token
    // bucket shows for the very same coin the moment it's claimed.
    const priceUsd = universe?.priceUsd ?? new Map<string, number>();
    const oracle = new Map<string, number>();
    try {
      for (const p of await getPools()) {
        // `oracle.valid` is false on ALL 35 pools, including USDsui at
        // $0.999786 and WBTC at $64.5k — it flags "feed needs an on-chain
        // refresh before a health-check op", not a bad price. Gating on it
        // would zero every reward, so read `price` regardless.
        const px = Number(p.oracle?.price ?? 0);
        if (p.suiCoinType && px > 0) oracle.set(normCoinType(p.suiCoinType), px);
      }
    } catch {
      /* market price alone is fine */
    }

    let usd = 0;
    for (const r of rewards) {
      const key = normCoinType(r.rewardCoinType);
      const px = priceUsd.get(key) ?? oracle.get(key);
      // An unpriced reward contributes 0 rather than being counted at par —
      // guessing $1 for an unknown coin is how 0.06 of something becomes
      // "$0.06" when it's worth ten times that, or a tenth.
      if (px && Number.isFinite(px)) usd += r.amount * px;
    }
    return Number.isFinite(usd) && usd > 0 ? usd : 0;
  } catch (e) {
    console.warn(`[navi] reward pricing failed: ${(e as Error).message}`);
    return 0;
  }
}

/**
 * Append a claim for EVERY available reward, including ones accrued long ago —
 * NAVI keeps them claimable until taken, so a first claim sweeps the backlog.
 *
 * Capital is untouched: this adds only NAVI's own claim call, no withdraw leg.
 * Throws when there is nothing to claim, so the caller returns a clean message
 * instead of preparing a transaction that would move nothing.
 */
export async function appendNaviClaimRewards(
  tx: Transaction,
  address: string
): Promise<{ claimed: NaviClaimableReward[] }> {
  let raw: LendingReward[];
  try {
    raw = (await getUserAvailableLendingRewards(address)) ?? [];
  } catch (e) {
    throw new Error(`couldn't read NAVI rewards: ${(e as Error).message}`);
  }
  const usable = raw.filter((r) => Number(r.userClaimableReward ?? 0) > 0);
  if (usable.length === 0) {
    throw new Error("no NAVI rewards to claim yet");
  }
  await claimLendingRewardsPTB(tx, usable);
  return {
    claimed: usable.map((r) => ({
      rewardCoinType: String(r.rewardCoinType ?? ""),
      amount: Number(r.userClaimableReward ?? 0),
    })),
  };
}

/**
 * Best-effort version for closing a position: sweeps rewards alongside the
 * capital withdrawal so a user who taps "Withdraw all" doesn't leave reward
 * coins stranded in a pool they no longer hold.
 *
 * Never throws and never fails the transaction it's appended to — having
 * nothing to claim is the common case, and a rewards problem must not stop
 * someone getting their own money out.
 */
export async function tryAppendNaviClaimRewards(
  tx: Transaction,
  address: string
): Promise<boolean> {
  try {
    await appendNaviClaimRewards(tx, address);
    return true;
  } catch {
    return false;
  }
}
