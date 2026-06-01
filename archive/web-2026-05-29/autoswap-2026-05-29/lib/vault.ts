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
  /**
   * v1 registry (`AutoSwapRegistry`) — the singleton minted at the
   * original `init`. Still used by the v1 PTB path (`auto_swap_extract`
   * + `auto_swap_deposit`) and by `enable_auto_swap` event walks. Stays
   * pinned to its original object id for the lifetime of the package;
   * never rotated.
   */
  registryId: string;
  /**
   * v7 registry (`AutoSwapRegistryV2`) — the hardened shared object minted
   * by `bootstrap_v7` post-upgrade. Required by every v2 swap path:
   * `auto_swap_extract_v2` / `auto_swap_deposit_to_owner_v2`. Carries the
   * dest-allowlist, registry pause flag, per-cap throttle bookkeeping,
   * and the worker membership list. Onara dispatches against this when
   * `capVersion === "v2"`.
   *
   * Distinct env var (`TALISE_AUTOSWAP_REGISTRY_V2_ID`) so the v1 id can
   * stay frozen for v1 cap-event walks while we cut callers over.
   */
  registryV2Id: string;
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
  const registryV2Id = process.env.TALISE_AUTOSWAP_REGISTRY_V2_ID;
  const missing: string[] = [];
  if (!packageId) missing.push("TALISE_AUTOSWAP_PACKAGE_ID");
  if (!registryId) missing.push("TALISE_AUTOSWAP_REGISTRY_ID");
  if (!registryV2Id) missing.push("TALISE_AUTOSWAP_REGISTRY_V2_ID");
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
    registryV2Id: registryV2Id!,
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
  // Must use the LATEST package id so that v3's `enable_auto_swap` body
  // (which calls `transfer::public_share_object(cap)` instead of
  // `transfer::public_transfer(cap, owner)`) runs. The old v1/v2 entry
  // would mint a user-owned cap, which the cron worker can't reference
  // when signing as the Onara admin (Sui requires the signer to own every
  // owned-object argument, and a user-owned cap defeats that).
  const { packageIdLatest } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${packageIdLatest}::vault::enable_auto_swap`,
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
 * Default source coins minted at vault setup so the auto-swap cron has a
 * cap for every common deposit type without the user signing three times.
 *
 * `maxPerSwap` is the on-chain u64 in the coin's native decimals. We pick
 * conservative-but-generous demo defaults rather than fetch live prices
 * here — the route building this PTB needs to be cheap and deterministic,
 * and the user can later tighten any bound via `auto_swap::update_bounds`:
 *
 *   • SUI  (9d) — 1e10 raw  = 10 SUI   (≈ $20 at $2/SUI; covers any
 *                                       reasonable single transfer)
 *   • USDC (6d) — 1e10 raw  = 10_000 USDC
 *   • USDT (6d) — 1e10 raw  = 10_000 USDT
 *
 * Both stables get the same large headroom — the cap is a per-swap ceiling,
 * not a daily total, so 10k USD covers any consumer-tier inbound transfer
 * the cron is likely to sweep before a human notices and tightens it.
 *
 * `expiresAtMs = 0` is the never-expires sentinel enforced by the Move
 * `enable_auto_swap` entry — same semantic the manual Enable flow uses
 * when the user picks "no expiry".
 */
export const DEFAULT_AUTO_SWAP_CAPS: ReadonlyArray<{
  sourceType: string;
  maxPerSwap: bigint;
  expiresAtMs: bigint;
}> = [
  { sourceType: "0x2::sui::SUI", maxPerSwap: 10_000_000_000n, expiresAtMs: 0n },
  {
    sourceType:
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    maxPerSwap: 10_000_000_000n,
    expiresAtMs: 0n,
  },
  {
    sourceType:
      "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
    maxPerSwap: 10_000_000_000n,
    expiresAtMs: 0n,
  },
];

/**
 * Build a single PTB that mints `AutoSwapCap<T>` for every entry in
 * `DEFAULT_AUTO_SWAP_CAPS` (or the supplied subset) against the user's
 * existing shared vault. Three `enable_auto_swap` MoveCalls in one tx —
 * the user signs once, the cron sees caps for SUI / USDC / USDT, and any
 * subsequent inbound transfer of any of those coins gets swept on the
 * next pass instead of stranding at the vault address.
 *
 * Targets `packageIdLatest` for the same reason `buildEnableAutoSwapTx`
 * does — v3's entry shares the cap; v1/v2 transfers it to the owner and
 * the cron can't reference it.
 */
export function buildEnableDefaultCapsTx(
  sender: string,
  vaultId: string,
  sources: ReadonlyArray<{
    sourceType: string;
    maxPerSwap: bigint | number;
    expiresAtMs: bigint | number;
  }> = DEFAULT_AUTO_SWAP_CAPS
): Transaction {
  const { packageIdLatest } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  for (const src of sources) {
    tx.moveCall({
      target: `${packageIdLatest}::vault::enable_auto_swap`,
      typeArguments: [src.sourceType],
      arguments: [
        tx.object(vaultId),
        tx.pure.u64(BigInt(src.maxPerSwap)),
        tx.pure.u64(BigInt(src.expiresAtMs)),
      ],
    });
  }
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

/**
 * `talise::vault::withdraw_and_send<T>(&mut vault, amount, recipient)` —
 * pulls `amount` units of `Balance<T>` out of the shared vault's bag and
 * transfers the resulting `Coin<T>` to `recipient` (the user's wallet).
 *
 * Move asserts (all on `talise::vault`):
 *   • `ctx.sender() == vault.owner` (E_NOT_OWNER)
 *   • `amount > 0` (E_ZERO_AMOUNT)
 *   • bag holds the requested type (E_TYPE_NOT_HELD)
 *   • bag balance ≥ amount (E_INSUFFICIENT_BALANCE)
 *
 * Targets `packageIdLatest` — the entry symbol is stable across the v2→v3
 * chain but pinning to latest keeps the call forward-compatible with any
 * future tweak. `amount` is the raw u64 in the coin's native decimals.
 */
export function buildWithdrawFromVaultTx(
  sender: string,
  vaultId: string,
  coinType: string,
  amount: bigint
): Transaction {
  const { packageIdLatest } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${packageIdLatest}::vault::withdraw_and_send`,
    typeArguments: [coinType],
    arguments: [
      tx.object(vaultId),
      tx.pure.u64(amount),
      tx.pure.address(sender),
    ],
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
 * `vault::share_existing_cap<T>(cap)` — promotes a v2-era user-owned
 * `AutoSwapCap<T>` to a shared object so the Onara cron worker can
 * reference it. Move asserts `ctx.sender() == cap.owner` (the recorded
 * owner field, not just the runtime AddressOwner) so a transferred cap
 * is rejected before sharing.
 *
 * Targets `packageIdLatest` — the entry was added in v3, so callers
 * referencing the original `packageId` would 404 the symbol.
 */
export function buildShareExistingCapTx(
  sender: string,
  capId: string,
  sourceType: string
): Transaction {
  const { packageIdLatest } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${packageIdLatest}::vault::share_existing_cap`,
    typeArguments: [sourceType],
    arguments: [tx.object(capId)],
  });
  return tx;
}

/**
 * `vault::upgrade_cap_to_v2<T>(cap, max_per_day, clock)` — burns the
 * existing v1 `AutoSwapCap<T>` and mints an equivalent
 * `AutoSwapCapV2<T>` (shared) with the v7 per-day throttle. After v7
 * lands, the cron only sweeps v2 caps — v1 caps require this owner-
 * signed migration.
 *
 * Move asserts (`talise::auto_swap::upgrade_cap_to_v2`):
 *   • `ctx.sender() == cap.owner`   (E_NOT_OWNER) — owner-only.
 *   • `max_per_day > 0`              (E_INVALID_MAX_PER_DAY)
 *   • `max_per_day >= max_per_swap`  (E_INVALID_MAX_PER_DAY)
 *
 * Targets `packageIdLatest` — the entry was added in v7, so calls
 * pinned to the original `packageId` would 404 the symbol. `maxPerDay`
 * is a raw u64 in the source coin's native decimals (the caller scales
 * 10× the existing `max_per_swap`). `clock` is the well-known shared
 * `0x6` system clock object — used to initialize `day_reset_at_ms`.
 */
export function buildUpgradeCapToV2Tx(
  sender: string,
  capId: string,
  sourceType: string,
  maxPerDay: bigint | number
): Transaction {
  const { packageIdLatest } = vaultPackageIds();
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    // Function lives in the auto_swap module, not vault. Spec text
    // referred to it under the vault namespace because v7 cap mgmt is
    // a "vault concern" — but the actual `fun upgrade_cap_to_v2` is
    // defined in auto_swap.move (next to `new_cap_v2`).
    target: `${packageIdLatest}::auto_swap::upgrade_cap_to_v2`,
    typeArguments: [sourceType],
    arguments: [
      // v1 cap, consumed by value — Move destructures the old struct
      // and shares the freshly-minted v2 cap in the same call.
      tx.object(capId),
      tx.pure.u64(BigInt(maxPerDay)),
      // System Clock at 0x6 — used for the v2 cap's initial
      // `day_reset_at_ms` (now + 24h).
      tx.object("0x6"),
    ],
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
