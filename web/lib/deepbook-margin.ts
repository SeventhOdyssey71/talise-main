/**
 * DeepBook V3 Margin — WITHDRAW ONLY.
 *
 * Removed as a supply venue 2026-07-30: USDsui borrow demand was ~0, so the
 * realized supply APY was ~0 and it was already barred from the "best"
 * auto-pick. What remains is deliberately the exit path and nothing else —
 * anyone already holding a SupplierCap needs a way out, and deleting this
 * would strand their principal on chain with no in-app redemption. Delete the
 * file once no SupplierCaps are outstanding.
 *
 * Historical note (the original rationale, which did not hold):
 *
 * Suppliers deposit USDsui into the DeepBook margin pool and earn the
 * borrow rate × utilization × (1 − protocol spread). This generally
 * pays more than NAVI on stablecoins because DeepBook margin is the
 * default funding source for every leveraged trader on the venue.
 *
 * Flow:
 *   1. First time: mint a `SupplierCap` NFT (one per user, owns supply shares).
 *   2. Supply: deposit USDsui into the margin pool.
 *   3. Withdraw: redeem shares (cap-gated).
 *
 * The on-chain refs below are pulled directly from `@mysten/deepbook-v3`
 * mainnet config (v1.3.6, margin v8), we don't hand-roll any object ids
 * other than the lending-pool key map.
 */

import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { network, sui } from "./sui";

/**
 * Lending pool object ids by coin key. Verified against Surflux
 * /deepbook-margin/pools (2026-05-11). USDsui is the only pool we
 * surface in Talise, the others (SUI/USDC/DEEP) sit underneath the
 * trading flows.
 */
export const LENDING_POOLS = {
  USDSUI: "0x78a0ddd02745d9b500fb7e9aae2ff8b665d974f00fd1f6060d59f4a8e891402c",
} as const;

/**
 * SupplierCap struct type used to filter owned objects.
 *
 * Sui's qualified type names anchor to the package that ORIGINALLY
 * defined the struct, even after upgrades, so this is always the
 * margin protocol's v1 (canonical) package id. DeepBook upgraded
 * its margin package in late 2026 (new MARGIN_PACKAGE_ID =
 * 0x124bb3…cff2e in SDK 1.4.1), but existing SupplierCap objects
 *, and any newly minted ones, keep the v1 type identifier below.
 *
 * Earlier code hardcoded the intermediate 0xfbd3…1377 id, which
 * lookups never matched (returning null for every user), forcing
 * `buildSupplyUsdsuiMargin` to mint a fresh cap on every call.
 * That always aborted on `margin_registry::load_inner` (code 10 -
 * Versioned mismatch) because the OLD package's mint helper was
 * touching the NEW registry's versioned inner.
 */
const SUPPLIER_CAP_TYPE =
  "0x97d9473771b01f77b0940c589484184b49f6444627ec121314fae6a6d36fb86b::margin_pool::SupplierCap";

const USDSUI_DECIMALS = 6;

function dbClient(address: string): DeepBookClient {
  const net = network();
  // Reuse the shared gRPC client, DeepBookClient hits the unified
  // BaseClient surface under the hood, so passing `sui()` is fine.
  return new DeepBookClient({
    client: sui() as never,
    address,
    network: net,
  });
}

/**
 * Compute the live supply APY for USDsui by reading the on-chain margin
 * pool stats. Supply APY ≈ borrow_rate × utilization × (1 − spread). The
 * borrow rate itself is a piecewise function of utilization, so this
 * always reflects the moment's supply yield.
 */

/**
 * Find the user's SupplierCap (if any), needed for every supply +
 * withdraw call after the first mint.
 */
export async function fetchSupplierCapId(
  address: string
): Promise<string | null> {
  try {
    // gRPC `listOwnedObjects` filters by exact type via the `type`
    // string param (the canonical tag of the SupplierCap struct).
    const objs = await sui().listOwnedObjects({
      owner: address,
      type: SUPPLIER_CAP_TYPE,
      limit: 50,
    });
    return objs.objects[0]?.objectId ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the user's USDsui supply position. Returns null if they have no
 * SupplierCap yet.
 */

/**
 * Build a PTB that supplies USDsui into the margin pool. If the user
 * doesn't have a SupplierCap yet, this also mints one (single tx, single
 * signature).
 *
 * The returned `{ build }` shape mirrors the Talise PTB builders in
 * `lib/intents.ts` so it composes cleanly with the Payment Intent layer.
 */

/**
 * Withdraw USDsui from the margin pool. Omit `amountUsdsui` to withdraw
 * everything the user has supplied.
 */
export function buildWithdrawUsdsuiMargin(opts: {
  senderAddress: string;
  supplierCapId: string;
  amountUsdsui?: number;
}): { build: (tx: Transaction) => void } {
  return {
    build: (tx: Transaction) => {
      const c = dbClient(opts.senderAddress);
      const coin = c.marginPool.withdrawFromMarginPool(
        "USDSUI",
        tx.object(opts.supplierCapId),
        opts.amountUsdsui
      )(tx);
      tx.transferObjects([coin], opts.senderAddress);
    },
  };
}
