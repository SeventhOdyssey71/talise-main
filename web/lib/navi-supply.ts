import "server-only";

import { coinWithBalance, type Transaction } from "@mysten/sui/transactions";
import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
} from "@mysten/sui/jsonRpc";
import { NaviAdapter } from "@t2000/sdk";
import { USDSUI_TYPE } from "./usdsui";
import { USDSUI_DECIMALS } from "./sui";

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
