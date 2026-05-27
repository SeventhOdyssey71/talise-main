import "server-only";

import { coinWithBalance, type Transaction } from "@mysten/sui/transactions";
import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
} from "@mysten/sui/jsonRpc";
import { NaviAdapter } from "@t2000/sdk";
import { USDSUI_TYPE, isUsdsui } from "./usdsui";
import { USDSUI_DECIMALS } from "./sui";
import { memoTtl } from "./perf-cache";

/**
 * NAVI USDsui supply / withdraw — sponsor-friendly PTB builders.
 *
 * Why this exists separately from deepbook-margin.ts: NAVI's protocol
 * registry, supply oracle (Pyth), and reserve metadata all live behind
 * @t2000/sdk's `NaviAdapter`. The adapter's `addSaveToTx` /
 * `addWithdrawToTx` methods append the right MoveCalls onto an existing
 * Transaction — we just need to feed them a sender + a pre-split coin
 * handle (`coinWithBalance` so we never touch the gas coin, which
 * belongs to Onara during the sponsored leg).
 *
 * `NaviAdapter` was made public in @t2000/sdk 2.11 — the earlier
 * private `save` ergonomics that blocked mobile aren't a constraint
 * anymore. With this in place, NAVI is the real default yield venue
 * (live ~5% APY on mainnet) and DeepBook margin USDsui can be
 * de-emphasized until its borrow demand picks up.
 */

// NAVI's adapter keys assets by their `symbol` (mixed case "USDsui"),
// not the uppercased registry key — verified from
// `SUPPORTED_ASSETS.USDsui.symbol` in @t2000/sdk 2.11.
const NAVI_ASSET = "USDsui";

let _adapter: NaviAdapter | null = null;
let _adapterReady: Promise<NaviAdapter> | null = null;

async function adapter(): Promise<NaviAdapter> {
  if (_adapter) return _adapter;
  if (_adapterReady) return _adapterReady;
  _adapterReady = (async () => {
    const a = new NaviAdapter();
    const client = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl("mainnet"),
      network: "mainnet",
    });
    await a.init(client as never);
    _adapter = a;
    return a;
  })();
  return _adapterReady;
}

/**
 * Build a NAVI USDsui supply step onto an existing Transaction.
 * Caller wraps with `tx.setSender(...)` + `onlyTransactionKind: true`
 * before handing to Onara.
 *
 * Uses `coinWithBalance` (not `splitCoins(tx.gas)`) because the gas
 * coin is sponsor-owned in the sponsored flow — splitting from it
 * would have the wallet trying to pay gas with someone else's SUI.
 */
export async function appendNaviSupply(
  tx: Transaction,
  senderAddress: string,
  amountUsdsui: number
): Promise<void> {
  const a = await adapter();
  const onchain = BigInt(Math.round(amountUsdsui * 10 ** USDSUI_DECIMALS));
  if (onchain <= 0n) {
    throw new Error("amount too small");
  }
  const coin = tx.add(
    coinWithBalance({ type: USDSUI_TYPE, balance: onchain, useGasCoin: false })
  );
  await a.addSaveToTx(tx, senderAddress, coin, NAVI_ASSET);
}

/**
 * Build a NAVI USDsui withdraw step. `amount === undefined | <= 0` is
 * treated as "withdraw everything I have supplied" — the adapter
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
  const a = await adapter();
  let amount = amountUsdsui ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) {
    // Adapter signature requires a positive amount, so look up the
    // current supplied balance and redeem that exact value. Anything
    // missed (e.g. interest accrued between read and submit) gets
    // picked up on the next withdraw.
    const positions = await a.getPositions(senderAddress);
    const usdsuiSupply = positions.supplies.find(
      (s) => s.asset === NAVI_ASSET || s.asset.toLowerCase() === "usdsui"
    );
    amount = usdsuiSupply?.amount ?? 0;
    if (amount <= 0) {
      throw new Error("no NAVI USDsui position to withdraw");
    }
  }
  const { coin } = await a.addWithdrawToTx(
    tx,
    senderAddress,
    amount,
    NAVI_ASSET
  );
  tx.transferObjects([coin], senderAddress);
}

/**
 * Fetch the live USDsui supply APY from NAVI's public open API.
 *
 * Why this exists: `@t2000/sdk`'s `getFinancialSummary` returns the
 * USDC `saveApy` regardless of the actual reserve asset — its
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

type NaviPoolRow = {
  coinType: string;
  supplyIncentiveApyInfo?: { apy?: string };
};

async function fetchNaviUsdsuiSupplyApyOnce(): Promise<number | null> {
  try {
    const res = await fetch(NAVI_POOLS_URL, {
      // Don't cache at the fetch layer — memoTtl above handles TTL.
      cache: "no-store",
      // Conservative deadline so a slow Navi response doesn't stall
      // the whole /api/yield/comparison handler.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: NaviPoolRow[] };
    const pools = body?.data ?? [];
    const row = pools.find((p) => p.coinType && isUsdsui("0x" + p.coinType.replace(/^0x/, "")));
    const apyPct = parseFloat(row?.supplyIncentiveApyInfo?.apy ?? "");
    if (!Number.isFinite(apyPct) || apyPct < 0 || apyPct > 200) return null;
    return apyPct / 100;
  } catch {
    return null;
  }
}

export async function fetchNaviUsdsuiSupplyApy(): Promise<number | null> {
  return memoTtl("navi:usdsui-supply-apy", 60_000, fetchNaviUsdsuiSupplyApyOnce);
}

/**
 * Live NAVI USDsui position for `address`, with an estimated "earned"
 * breakdown derived from on-chain activity.
 *
 * Data-source decision (Approach A from the spec):
 *   - `currentValue` comes straight from `NaviAdapter.getPositions()` —
 *     the USDsui supply row's `amount` is the principal-plus-accrued
 *     redeemable balance (Navi accrues interest into the position
 *     in-place; there's no separate accrual ledger exposed via SDK,
 *     and Navi's open API only surfaces pool-level data).
 *   - `principalSupplied` is reconstructed by replaying the user's
 *     on-chain Talise Payment-Kit memos: every invest/withdraw to
 *     `venue=navi` carries a typed memo (`talise/v1|invest|...|venue=navi|...`)
 *     whose `amount` field is the canonical USDsui amount the user
 *     supplied or withdrew. The caller passes the parsed activity list
 *     so we don't double-fetch — the comparison route already has it.
 *   - `earned = max(0, currentValue − principalSupplied)`. The floor at
 *     0 protects against transient gaps (e.g. user supplied 100, then
 *     withdrew 100 → we'd read a near-zero current value but the
 *     activity replay nets to 0; rounding noise could go negative).
 *
 * If we can't determine principal (no activity hits for navi, or the
 * activity feed errored out), `principalSupplied` is returned as
 * `currentValue` so `earned` falls to 0 — better to under-report than
 * accidentally show negative or inflated earnings.
 */
export type NaviPositionDetail = {
  /** Current redeemable USDsui balance. Includes accrued interest. */
  currentValue: number;
  /** Estimated principal supplied (sum of supplies − sum of withdraws). */
  principalSupplied: number;
  /** `currentValue − principalSupplied`, floored at 0. */
  earned: number;
  /** `currentValue × apy / 365` — per-day burn rate at this APY. */
  dailyEarning: number;
  /** Live USDsui supply APY as a fraction (0.0917 = 9.17%). */
  apy: number;
};

export async function fetchNaviCurrentValue(address: string): Promise<number> {
  const a = await adapter();
  const positions = await a.getPositions(address);
  const row = positions.supplies.find(
    (s) => s.asset === NAVI_ASSET || s.asset.toLowerCase() === "usdsui"
  );
  return row?.amount ?? 0;
}

/**
 * Compute the NAVI USDsui position breakdown for an address, given a
 * pre-fetched activity feed (the `venue == 'navi'` rows). Returning a
 * function rather than fetching activity here avoids a second
 * `queryTransactionBlocks` round-trip — callers (`/api/yield/comparison`,
 * `/api/earn/withdraw-earned/prepare`) already have or can cheaply
 * fetch the activity list once.
 */
export function naviPositionFromActivity(opts: {
  currentValue: number;
  apy: number;
  naviActivity: Array<{
    direction: "invest" | "withdraw" | string;
    venue: string | null;
    amountUsdsui: number | null;
  }>;
}): NaviPositionDetail {
  const { currentValue, apy } = opts;
  let supplied = 0;
  let withdrawn = 0;
  let sawAny = false;
  for (const row of opts.naviActivity) {
    if ((row.venue ?? "").toLowerCase() !== "navi") continue;
    const amt = Math.abs(row.amountUsdsui ?? 0);
    if (amt <= 0) continue;
    if (row.direction === "invest") {
      supplied += amt;
      sawAny = true;
    } else if (row.direction === "withdraw") {
      withdrawn += amt;
      sawAny = true;
    }
  }
  // If we found no historical invest/withdraw rows, treat the current
  // value as 100% principal (earned = 0). Better than guessing.
  const principalSupplied = sawAny
    ? Math.max(0, supplied - withdrawn)
    : currentValue;
  const earned = Math.max(0, currentValue - principalSupplied);
  const dailyEarning = currentValue * apy / 365;
  return { currentValue, principalSupplied, earned, dailyEarning, apy };
}
