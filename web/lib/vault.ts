/**
 * TaliseVault + AutoSwapCap PTB builders.
 *
 * Composes the management-side Programmable Transactions for the
 * `talise::vault` and `talise::auto_swap` Move modules. Each builder
 * returns a fully-populated `Transaction` with the sender set; callers
 * are responsible for building to bytes (`onlyTransactionKind: true`)
 * and feeding the result into the sponsor-execute flow.
 *
 * The package + registry object ids live behind env vars because the
 * Move package is not yet deployed. `vaultPackageIds()` throws a typed
 * error so route handlers can convert that to a 503 cleanly — the iOS
 * and web UIs are expected to hide the auto-swap feature gracefully
 * until publish.
 *
 * Generic `<T>` Move handling:
 *   The user-supplied `sourceType` is plumbed verbatim into Transaction's
 *   `typeArguments`. The Sui SDK accepts the canonical
 *   `0x<addr>::<module>::<Name>` form and rejects malformed ones at
 *   build time — but we still do an upfront regex check in the route
 *   handlers to surface a 400 instead of a confusing 500.
 */

import { Transaction } from "@mysten/sui/transactions";
import { USDSUI_TYPE } from "./usdsui";
import { SuinsTransaction } from "@mysten/suins";
import { suins } from "./suins-operator";

// ───────────────────────────────────────────────────────────────────
// Env / package resolution

export type VaultPackageIds = {
  /**
   * Original published-at package id — the one auto-swap caps were minted
   * against. Used for any call that references types or capabilities tied
   * to the original publish (caps, registry, type matches).
   */
  packageId: string;
  /**
   * Latest published-at package id. Same upgrade lineage as `packageId`,
   * just newer code. Use this when calling entry functions that ONLY exist
   * in a later upgrade (e.g. `vault::receive_and_deposit` shipped in v2).
   *
   * If `TALISE_AUTOSWAP_PACKAGE_LATEST` is unset, this falls back to
   * `packageId` — so callers using only v1 functions don't break, and a
   * pre-v2 deploy keeps working.
   */
  packageIdLatest: string;
  registryId: string;
  usdsuiType: string;
};

/**
 * Sentinel error thrown by `vaultPackageIds()` when the Move package
 * hasn't been deployed yet (env vars missing). Route handlers catch
 * this specifically and return a 503 so the client UI can degrade.
 */
export class VaultNotDeployedError extends Error {
  constructor(missing: string[]) {
    super(`auto-swap package not yet deployed (missing: ${missing.join(", ")})`);
    this.name = "VaultNotDeployedError";
  }
}

/**
 * Resolve the live Move package + shared registry ids from env. Throws
 * `VaultNotDeployedError` if either is unset — callers convert that to
 * a 503 `{ error: "auto-swap package not yet deployed" }`.
 */
export function vaultPackageIds(): VaultPackageIds {
  const packageId = process.env.TALISE_AUTOSWAP_PACKAGE_ID;
  const registryId = process.env.TALISE_AUTOSWAP_REGISTRY_ID;
  const missing: string[] = [];
  if (!packageId) missing.push("TALISE_AUTOSWAP_PACKAGE_ID");
  if (!registryId) missing.push("TALISE_AUTOSWAP_REGISTRY_ID");
  if (missing.length > 0) throw new VaultNotDeployedError(missing);
  // `TALISE_USDSUI_TYPE` can override the compiled-in constant for testnet
  // / staging deploys where USDsui lives at a different address.
  const usdsuiType = process.env.TALISE_USDSUI_TYPE || USDSUI_TYPE;
  // `TALISE_AUTOSWAP_PACKAGE_LATEST` holds the most recent upgrade's
  // `published-at` id. Calls to entry functions added in a newer version
  // (e.g. `vault::receive_and_deposit`, added in v2) must target this
  // package id — old `packageId` won't resolve the new symbol. We fall
  // back to `packageId` if the env var is missing so single-version
  // deploys still work.
  const packageIdLatest =
    process.env.TALISE_AUTOSWAP_PACKAGE_LATEST || packageId!;
  return {
    packageId: packageId!,
    packageIdLatest,
    registryId: registryId!,
    usdsuiType,
  };
}

// ───────────────────────────────────────────────────────────────────
// Coin-type validation

/**
 * Strict-ish Sui type-tag matcher: `0x<hex>::<module>::<Name>` with
 * optional nested generics. We accept any printable identifier in the
 * module/name segments; the SDK will reject anything truly malformed
 * at PTB build time. Generic arguments (`<...>`) are allowed for cases
 * like `0x2::coin::Coin<0x...::usdc::USDC>`.
 */
const TYPE_TAG_RE = /^0x[0-9a-fA-F]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*(<.+>)?$/;

export function isValidTypeTag(t: string): boolean {
  if (typeof t !== "string") return false;
  return TYPE_TAG_RE.test(t.trim());
}

// ───────────────────────────────────────────────────────────────────
// PTB builders

/**
 * `talise::vault::create()` — mint a per-user shared vault.
 *
 * Anyone can call this for themselves; the entry function records
 * `ctx.sender()` as the vault owner. No type arguments.
 */
export function buildCreateVaultTx(sender: string): Transaction {
  const { packageId } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${packageId}::vault::create`,
    arguments: [],
  });
  return tx;
}

/**
 * `talise::vault::enable_auto_swap<Source>(&vault, max_per_swap, expires_at_ms)`.
 *
 * Mints an `AutoSwapCap<Source>` hardwired to the user's vault and
 * transfers it to the user. The cap object id is recoverable from
 * the tx digest's `objectChanges`.
 *
 * Post-audit (v2): the entry lives in `vault.move` and asserts
 * `vault.owner == ctx.sender()`, closing the previous mint-against-
 * victim's-vault hole. We now pass the vault by shared-object reference.
 */
export function buildEnableAutoSwapTx(
  sender: string,
  vaultId: string,
  sourceType: string,
  maxPerSwap: bigint | number,
  expiresAtMs: bigint | number
): Transaction {
  const { packageId } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${packageId}::vault::enable_auto_swap`,
    typeArguments: [sourceType],
    arguments: [
      // Shared vault object — Move asserts vault.owner == sender inside.
      tx.object(vaultId),
      tx.pure.u64(BigInt(maxPerSwap)),
      tx.pure.u64(BigInt(expiresAtMs)),
    ],
  });
  return tx;
}

/**
 * Build a PTB that re-targets a `*.talise.sui` SuiNS subname NFT at a
 * new address (typically the user's vault id). The signer MUST be the
 * current owner of the subname NFT — Talise's operator key cannot do
 * this on the user's behalf because the SubDomainRegistration NFT is
 * transferred to the user at mint time, and SuiNS's `set_target_address`
 * asserts NFT ownership in the calling tx.
 *
 * No package id from `vaultPackageIds()` is needed — the call targets
 * the SuiNS package, which is always live on mainnet. We still keep this
 * builder colocated with the other vault PTBs because every caller pairs
 * a repoint with a vault operation.
 *
 * Use cases:
 *   • `/api/vault/record` returns this PTB so a brand-new vault flow
 *     can immediately repoint the user's existing handle.
 *   • `/api/vault/migrate-bundle` issues this as stage B of the
 *     legacy-user migration (after stage A created the vault).
 */
export function buildRepointSubnameTx(
  sender: string,
  nftId: string,
  newTarget: string
): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  const sx = new SuinsTransaction(suins(), tx);
  sx.setTargetAddress({
    nft: nftId,
    address: newTarget,
    isSubname: true,
  });
  return tx;
}

/** `auto_swap::pause<T>(&mut cap)` — flip the cap's `paused` flag to true. */
export function buildPauseAutoSwapTx(
  sender: string,
  capId: string,
  sourceType: string
): Transaction {
  const { packageId } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${packageId}::auto_swap::pause`,
    typeArguments: [sourceType],
    arguments: [tx.object(capId)],
  });
  return tx;
}

/** `auto_swap::resume<T>(&mut cap)` — flip `paused` back to false. */
export function buildResumeAutoSwapTx(
  sender: string,
  capId: string,
  sourceType: string
): Transaction {
  const { packageId } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${packageId}::auto_swap::resume`,
    typeArguments: [sourceType],
    arguments: [tx.object(capId)],
  });
  return tx;
}

/**
 * `auto_swap::disable<T>(cap)` — consumes the cap (takes by value),
 * burning it permanently. The user must re-mint a new cap (via
 * `enable<T>`) to opt back in.
 */
export function buildDisableAutoSwapTx(
  sender: string,
  capId: string,
  sourceType: string
): Transaction {
  const { packageId } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${packageId}::auto_swap::disable`,
    typeArguments: [sourceType],
    arguments: [tx.object(capId)],
  });
  return tx;
}

/**
 * `auto_swap::update_bounds<T>(&mut cap, max_per_swap, expires_at_ms)`.
 *
 * In-place edit of the cap's limits — cheaper than disable + re-enable
 * because we don't burn + re-mint the object.
 */
export function buildUpdateBoundsTx(
  sender: string,
  capId: string,
  sourceType: string,
  maxPerSwap: bigint | number,
  expiresAtMs: bigint | number
): Transaction {
  const { packageId } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${packageId}::auto_swap::update_bounds`,
    typeArguments: [sourceType],
    arguments: [
      tx.object(capId),
      tx.pure.u64(BigInt(maxPerSwap)),
      tx.pure.u64(BigInt(expiresAtMs)),
    ],
  });
  return tx;
}
