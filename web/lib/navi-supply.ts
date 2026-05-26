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
