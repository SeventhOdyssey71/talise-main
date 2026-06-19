import "server-only";

import {
  coinWithBalance,
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import { USDSUI_TYPE } from "./usdsui";
import { USDSUI_DECIMALS } from "./sui";

/**
 * Goal Vault — sponsor-friendly PTB builders (Phase 4 SCAFFOLD).
 *
 * These append `${GOAL_VAULT_PACKAGE_ID}::goal_vault::*` MoveCalls onto an
 * existing `Transaction`, mirroring how `lib/navi-supply.ts` appends a NAVI
 * supply leg onto the sponsor-prepare PTB. They are PURE builders: no DB, no
 * network, no `tx.build()`. The caller (a future `goals/*-prepare` route)
 * owns `setSender` / `setGasOwner` / `setGasPrice` / `setGasBudget` / `build`,
 * exactly as `/api/send/sponsor-prepare` does — so these compose straight into
 * the existing Onara-sponsored send flow.
 *
 * ── NOT DEPLOYED YET ───────────────────────────────────────────────
 * The `goal_vault` module lives in `move/talise/sources/goal_vault.move` but
 * has NOT been published (Phase 3). `GOAL_VAULT_PACKAGE_ID` is therefore unset
 * in every environment today. `goalVaultPackageId()` returns null and
 * `goalVaultEnabled()` is false until the audited package is published and the
 * id is wired into Vercel — at which point these builders light up with no
 * code change. Every builder calls `requireGoalVaultPackageId()` first, so an
 * accidental early call fails LOUDLY with a clear "not configured" error rather
 * than building a MoveCall against a null package.
 *
 * Coin sourcing mirrors sponsor-prepare EXACTLY:
 *   - `coinWithBalance({ type: USDSUI_TYPE, useGasCoin: false })` for the
 *     deposit/create-with coin, because the gas coin is sponsor-owned during
 *     the sponsored leg — splitting from it would have the wallet trying to
 *     pay gas with Onara's SUI.
 *   - `USDSUI_TYPE` is the single `T` type-arg for every generic call.
 *   - The Clock is the shared object `0x6` (required by `create`/`create_with`).
 *
 * `withdraw` and `close` are non-`entry` `public` functions that RETURN a
 * `Coin<T>`. In a PTB that returned coin is a result handle, NOT auto-routed
 * anywhere — so each builder transfers it to the owner (`sender`) to mirror the
 * Move test/usage contract (the funds land back in the owner's wallet).
 */

const GOAL_VAULT_MODULE = "goal_vault";

/** USDsui smallest-unit (micro) scaling — matches `appendNaviSupply`. */
function toMicros(amountUsdsui: number): bigint {
  return BigInt(Math.round(amountUsdsui * 10 ** USDSUI_DECIMALS));
}

/**
 * The published `talise` package id that hosts the `goal_vault` module, when
 * configured. Returns null (on-chain goal-vault rail gated off) when unset, so
 * an absent id never builds a broken MoveCall. Mirrors `chequePackageId()` /
 * `streamPackageId()`.
 */
export function goalVaultPackageId(): string | null {
  return process.env.GOAL_VAULT_PACKAGE_ID?.trim() || null;
}

/**
 * True when the on-chain goal-vault rail is configured (package id set). The
 * ONE gate a future route checks before attempting to build a vault PTB; when
 * false the backend should keep serving the DB tracking-envelope model
 * (`lib/rewards/goals.ts`).
 */
export function goalVaultEnabled(): boolean {
  return !!goalVaultPackageId();
}

/**
 * Resolve the package id or THROW with a clear, actionable message. Every
 * builder calls this first so a misconfigured env fails loudly at build time
 * (caught by the route → 503) instead of emitting a MoveCall against `null`.
 */
function requireGoalVaultPackageId(): string {
  const pkg = goalVaultPackageId();
  if (!pkg) {
    throw new Error(
      "goal-vault not configured: GOAL_VAULT_PACKAGE_ID is unset (the goal_vault Move module is not deployed yet — Phase 3)."
    );
  }
  return pkg;
}

function target(pkg: string, fn: string): `${string}::${string}::${string}` {
  return `${pkg}::${GOAL_VAULT_MODULE}::${fn}`;
}

/**
 * Append `goal_vault::create<USDsui>(name, target, &Clock)` — creates an EMPTY
 * owner-owned vault and transfers it to the sender (the Move fun does the
 * `public_transfer` internally). Use when the user names a goal without an
 * opening deposit. For "create + fund in one tx" use {@link appendCreateVaultWith}.
 *
 * @param targetUsdsui goal target in USDsui (0 = no target). Scaled to micros.
 */
export function appendCreateVault(
  tx: Transaction,
  opts: { name: string; targetUsdsui: number }
): void {
  const pkg = requireGoalVaultPackageId();
  const name = opts.name.trim().slice(0, 64);
  tx.moveCall({
    target: target(pkg, "create"),
    typeArguments: [USDSUI_TYPE],
    arguments: [
      tx.pure.string(name),
      tx.pure.u64(toMicros(opts.targetUsdsui)),
      tx.object("0x6"),
    ],
  });
}

/**
 * Append `goal_vault::create_with<USDsui>(name, target, coin, &Clock)` — creates
 * a vault AND funds it from a freshly-split USDsui coin in the same tx. The coin
 * is sourced via `coinWithBalance({ useGasCoin: false })` so it never touches
 * the sponsor's gas coin (see sponsor-prepare).
 */
export function appendCreateVaultWith(
  tx: Transaction,
  opts: { name: string; targetUsdsui: number; amountUsdsui: number }
): void {
  const pkg = requireGoalVaultPackageId();
  const name = opts.name.trim().slice(0, 64);
  const onchain = toMicros(opts.amountUsdsui);
  if (onchain <= 0n) throw new Error("amount too small");
  const coin = tx.add(
    coinWithBalance({ type: USDSUI_TYPE, balance: onchain, useGasCoin: false })
  );
  tx.moveCall({
    target: target(pkg, "create_with"),
    typeArguments: [USDSUI_TYPE],
    arguments: [
      tx.pure.string(name),
      tx.pure.u64(toMicros(opts.targetUsdsui)),
      coin,
      tx.object("0x6"),
    ],
  });
}

/**
 * Append `goal_vault::deposit<USDsui>(&mut vault, coin)` — adds funds to an
 * existing vault. `vaultId` is the owned `GoalVault<USDsui>` object id. The
 * deposit coin is split via `coinWithBalance({ useGasCoin: false })`, mirroring
 * `appendNaviSupply`.
 */
export function appendDepositToVault(
  tx: Transaction,
  opts: { vaultId: string; amountUsdsui: number }
): void {
  const pkg = requireGoalVaultPackageId();
  const onchain = toMicros(opts.amountUsdsui);
  if (onchain <= 0n) throw new Error("amount too small");
  const coin = tx.add(
    coinWithBalance({ type: USDSUI_TYPE, balance: onchain, useGasCoin: false })
  );
  tx.moveCall({
    target: target(pkg, "deposit"),
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.object(opts.vaultId), coin],
  });
}

/**
 * Append `goal_vault::withdraw<USDsui>(&mut vault, amount, ctx): Coin<T>` and
 * route the returned coin back to `owner`. `withdraw` is owner-gated on chain
 * (`assert sender == owner`), so the caller MUST `setSender(owner)` before
 * build; passing the same `owner` here keeps the returned coin with them.
 *
 * Returns the coin handle in case a caller wants to chain it (e.g. withdraw →
 * send-to-bank) instead of transferring to the owner; pass `transferToOwner:
 * false` to suppress the transfer and take ownership of routing the coin.
 */
export function appendWithdrawFromVault(
  tx: Transaction,
  opts: {
    vaultId: string;
    amountUsdsui: number;
    owner: string;
    transferToOwner?: boolean;
  }
): TransactionObjectArgument {
  const pkg = requireGoalVaultPackageId();
  const onchain = toMicros(opts.amountUsdsui);
  if (onchain <= 0n) throw new Error("amount too small");
  const [coin] = tx.moveCall({
    target: target(pkg, "withdraw"),
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.object(opts.vaultId), tx.pure.u64(onchain)],
  });
  if (opts.transferToOwner !== false) {
    tx.transferObjects([coin], opts.owner);
  }
  return coin;
}

/**
 * Append `goal_vault::close<USDsui>(vault, ctx): Coin<T>` — drains the FULL
 * remaining balance, deletes the vault, and routes the coin back to `owner`.
 * Owner-gated on chain. The Move `close` aborts (`EReceiptParked`) if a venue
 * yield receipt is still parked, so a future yield integration must redeem
 * (`take_receipt` → SDK redeem → `deposit`) before closing.
 *
 * `vaultId` is consumed BY VALUE (the object is deleted), so this takes a plain
 * object id, not a `&mut`. Returns the coin handle for optional chaining; pass
 * `transferToOwner: false` to route it yourself.
 */
export function appendCloseVault(
  tx: Transaction,
  opts: { vaultId: string; owner: string; transferToOwner?: boolean }
): TransactionObjectArgument {
  const pkg = requireGoalVaultPackageId();
  const [coin] = tx.moveCall({
    target: target(pkg, "close"),
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.object(opts.vaultId)],
  });
  if (opts.transferToOwner !== false) {
    tx.transferObjects([coin], opts.owner);
  }
  return coin;
}
