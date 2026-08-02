import "server-only";

import type { Transaction, TransactionObjectArgument } from "@mysten/sui/transactions";
import { sui } from "@/lib/sui";

/**
 * Talise Yield Optimizer — the aggregating (vault-of-vaults) USDC venue.
 *
 * WHAT IT IS. A share-vault sitting one level above the lending markets Talise
 * already routes to: deposit USDC, receive an appreciating share coin, and the
 * vault spreads the pool across Scallop / Suilend (three markets) / NAVI,
 * harvests their reward tokens, swaps them back to USDC, and rebalances on a
 * permissionless keeper call. Yield accrues purely through SHARE PRICE — no
 * rebasing, no claim step, no lock-up. One venue id here therefore stands in
 * for five underlying markets plus reward compounding, which is work Talise
 * would otherwise rebuild inside `talise_yield::yield_router`.
 *
 * WHERE THE CODE COMES FROM. The on-chain programs are a third party's, already
 * deployed on Sui mainnet; we only *call* them, which is permissionless. The
 * PTB shape is genuinely hard to hand-roll (see the flow note below), so we
 * build transactions with the vendor's MIT-licensed npm SDK rather than
 * transcribing it. Nothing in this repo vendors, forks, or redeploys their Move
 * code — that is deliberate, their contract source is under a source-available
 * licence that forbids operating it, and none of that touches calling a live
 * package from a client.
 *
 * ── WHY THE FLOW IS SHAPED LIKE THIS ──────────────────────────────────────
 * Every interaction is a hot-potato PTB. There are no `entry` functions at all,
 * so each step returns a value that MUST be consumed in the same transaction:
 *
 *   1. snapshot the shared AllowedVersions object → an `AllowedVersions` value
 *      (a `drop`-only snapshot, NOT the object) reused by every later call;
 *   2. open a protocol request;
 *   3. refresh NAVI's oracle price, then have EVERY registered adapter approve
 *      onto that request — the vault compares the approval set for exact
 *      equality with its registry, so a missing adapter aborts the whole tx;
 *   4. the deposit / withdraw call itself;
 *   5. settle the returned request vectors in order: fill → allocate → reclaim.
 *
 * That is ~20 MoveCalls across four foreign packages for one deposit. Deposit
 * hands back a share `Coin` (the caller must transfer it); withdraw hands back a
 * `Balance` plus two request vectors, so the underlying has to be rebuilt from
 * the balance and merged with the settled request coin.
 *
 * ── READS ARE OURS, BUILDS ARE THEIRS ─────────────────────────────────────
 * The SDK's read paths default to a JSON-RPC fullnode endpoint that no longer
 * serves JSON-RPC, and Talise is gRPC-native besides (see the lint gate in
 * scripts/lint-no-jsonrpc.sh). So every read below goes through Talise's own
 * gRPC client and this module never imports a JSON-RPC symbol. We use the SDK
 * strictly for the two transaction builders, which touch config only.
 *
 * ── GATED OFF BY DEFAULT ──────────────────────────────────────────────────
 * `FEATURE_YIELD_OPTIMIZER` must be "true" for this venue to appear anywhere.
 * It is off deliberately, not as a placeholder: at the time of wiring the vault
 * held about a dollar in total, carried no third-party audit, and kept its admin
 * and every upgrade capability on a single hot key. Turning it on is a risk
 * decision with real user money behind it, so it is a flag rather than a
 * default. Read docs/strategy/YIELD-OPTIMIZER.md before flipping it.
 */

// ── Config ────────────────────────────────────────────────────────────────
//
// Identifiers are NEVER hardcoded here. They come from the vendor config that
// ships with the pinned SDK version, so a `pnpm update` is the only way they can
// move, and `EXPECTED_SHARE_TYPE` below turns "they moved" into a loud failure
// rather than a silent redirect. That guard matters more than usual for this
// venue: its operator's habit has been to abandon a package and republish on
// fresh ids rather than upgrade in place, which changes the share coin type and
// would otherwise strand every position we track.

/** Our vault keys → the vendor's. Keeps their naming out of the rest of Talise. */
const VAULTS = { usdc: "samUSDC" } as const;
export type OptimizerVaultKey = keyof typeof VAULTS;

/**
 * The share coin type we believe we are holding, pinned in env. When set, a
 * mismatch against the SDK config disables the venue instead of depositing into
 * a vault our ledger knows nothing about. Leave unset only in development.
 */
const EXPECTED_SHARE_TYPE = process.env.YIELD_OPTIMIZER_SHARE_TYPE;

export function optimizerEnabled(): boolean {
  return process.env.FEATURE_YIELD_OPTIMIZER === "true";
}

export type OptimizerVault = {
  /** Shared vault object id. */
  state: string;
  /** Underlying asset coin type (native USDC). */
  underlyingType: string;
  /** Appreciating share coin type. */
  shareType: string;
  decimals: number;
};

/**
 * Resolve a vault from the pinned SDK config. Returns null when the feature is
 * off, when the SDK can't be loaded, or when the share type has drifted from
 * `EXPECTED_SHARE_TYPE` — every caller treats null as "venue unavailable".
 */
export async function optimizerVault(
  key: OptimizerVaultKey = "usdc"
): Promise<OptimizerVault | null> {
  if (!optimizerEnabled()) return null;
  try {
    const { MAINNET, getVault } = await import("@usesamxyz/sdk");
    const v = getVault(MAINNET, VAULTS[key]);
    if (!v) return null;
    if (EXPECTED_SHARE_TYPE && v.samCoinType !== EXPECTED_SHARE_TYPE) {
      console.warn(
        `[yield/optimizer] share type drifted (${v.samCoinType} != pinned ` +
          `${EXPECTED_SHARE_TYPE}); venue disabled pending migration`
      );
      return null;
    }
    return {
      state: v.state,
      underlyingType: v.coinType,
      shareType: v.samCoinType,
      decimals: v.decimals,
    };
  } catch (e) {
    console.warn(`[yield/optimizer] config unavailable: ${(e as Error).message}`);
    return null;
  }
}

export async function optimizerConfigured(): Promise<boolean> {
  return (await optimizerVault()) !== null;
}

// ── Share math ────────────────────────────────────────────────────────────
//
// Mirrors the on-chain accounting exactly, including the ERC4626-style virtual
// offset of 1 unit on BOTH sides of the ratio. The offset is what removes the
// empty-vault special case and makes share-price inflation uneconomical, and
// omitting it (as the vendor's own quote helpers do) is off by a base unit or
// two — fine for display, wrong for settlement. Everything user-facing rounds
// DOWN; fees round UP. Both directions favour the pool, which is the only safe
// way to round when the alternative is minting value out of a rounding error.

const VIRTUAL = 1n;

/** Shares minted for a NET deposit `assets`: ⌊assets·(S+1)/(C+1)⌋. */
export function sharesForDeposit(assets: bigint, C: bigint, S: bigint): bigint {
  if (assets <= 0n) return 0n;
  return (assets * (S + VIRTUAL)) / (C + VIRTUAL);
}

/** Underlying returned for redeeming `shares`: ⌊shares·(C+1)/(S+1)⌋. */
export function underlyingForShares(shares: bigint, C: bigint, S: bigint): bigint {
  if (shares <= 0n) return 0n;
  return (shares * (C + VIRTUAL)) / (S + VIRTUAL);
}

/** Fee on an amount, rounded UP, matching the on-chain bps helper. */
export function feeUp(amount: bigint, bps: number): bigint {
  if (amount <= 0n || bps <= 0) return 0n;
  const x = BigInt(bps) * amount;
  return x / 10_000n + (x % 10_000n > 0n ? 1n : 0n);
}

// ── Vault + position reads (native gRPC) ──────────────────────────────────

export type OptimizerVaultState = {
  paused: boolean;
  /** Total underlying backing the pool (idle + deployed + accrued), base units. */
  totalUnderlying: bigint;
  /** Total share supply, base units. */
  totalShares: bigint;
  /** Underlying per share, as a float. Display only — settle with the bigint math. */
  price: number;
  /** Live fee schedule read off chain, in bps. */
  fees: { depositBps: number; withdrawBps: number; performanceBps: number };
};

type GrpcObjectReader = {
  getObject: (a: { objectId: string; include: { json: boolean } }) => Promise<{
    object?: { json?: Record<string, unknown> | null } | null;
  }>;
  listDynamicFields: (a: { parentId: string }) => Promise<{
    dynamicFields?: Array<{ fieldId?: string; objectId?: string; objectType?: string }>;
  }>;
};

/** Cached inner-state object id per vault — a dynamic object field id is stable. */
const innerStateCache = new Map<string, string>();

/**
 * The shared vault object carries no data; the real struct is a dynamic OBJECT
 * field hanging off it. Resolve that child's id once, then read it directly.
 */
async function innerStateId(vault: OptimizerVault): Promise<string | null> {
  const cached = innerStateCache.get(vault.state);
  if (cached) return cached;
  const pinned = process.env.YIELD_OPTIMIZER_INNER_STATE_ID;
  if (pinned) {
    innerStateCache.set(vault.state, pinned);
    return pinned;
  }
  try {
    const res = await (sui() as unknown as GrpcObjectReader).listDynamicFields({
      parentId: vault.state,
    });
    const inner = (res.dynamicFields ?? []).find((f) =>
      String(f.objectType ?? "").includes("::state_inner::SamStateV1")
    );
    const id = inner?.objectId ?? inner?.fieldId;
    if (!id) return null;
    innerStateCache.set(vault.state, id);
    return id;
  } catch {
    return null;
  }
}

const u = (v: unknown): bigint => {
  try {
    return BigInt(String((v as { value?: unknown })?.value ?? v ?? 0));
  } catch {
    return 0n;
  }
};
/** Basis-point wrappers serialize as a positional struct: `{ pos0: "100" }`. */
const bps = (v: unknown): number =>
  Number((v as { pos0?: unknown })?.pos0 ?? (v as { fields?: { pos0?: unknown } })?.fields?.pos0 ?? 0);

/**
 * Read pool value, share supply, pause state, and the live fee schedule.
 * Returns null on any failure so a slow or reshaped read degrades the venue out
 * of the comparison rather than reporting a fabricated position.
 */
export async function fetchOptimizerVaultState(
  key: OptimizerVaultKey = "usdc"
): Promise<OptimizerVaultState | null> {
  const vault = await optimizerVault(key);
  if (!vault) return null;
  const innerId = await innerStateId(vault);
  if (!innerId) return null;
  try {
    const res = await (sui() as unknown as GrpcObjectReader).getObject({
      objectId: innerId,
      include: { json: true },
    });
    // A dynamic field's json may arrive wrapped as `{ name, value }`.
    const raw = res.object?.json;
    if (!raw || typeof raw !== "object") return null;
    const f = ((raw as { value?: Record<string, unknown> }).value ?? raw) as Record<
      string,
      unknown
    >;
    const rate = f.exchange_rate as { sam?: unknown; coin_in?: unknown } | undefined;
    if (!rate) return null; // unrecognised shape → refuse to interpret
    const totalShares = u(rate.sam);
    const totalUnderlying = u(rate.coin_in);
    const fc = (f.fee_config ?? {}) as Record<string, unknown>;
    return {
      paused: Boolean(f.paused),
      totalUnderlying,
      totalShares,
      price:
        totalShares > 0n ? Number(totalUnderlying) / Number(totalShares) : 1,
      fees: {
        depositBps: bps(fc.deposit),
        withdrawBps: bps(fc.withdraw),
        performanceBps: bps(fc.protocol),
      },
    };
  } catch {
    return null;
  }
}

/**
 * A user's position: share balance valued at the current price, net of the
 * withdraw fee. `earned` is measured against a caller-supplied cost basis from
 * Talise's own ledger rather than inferred from chain state, so it can't be
 * inflated by depositing and immediately re-reading.
 */
export async function readOptimizerPosition(
  address: string,
  costBasis?: bigint,
  key: OptimizerVaultKey = "usdc"
): Promise<{ shares: bigint; value: bigint; earned: bigint } | null> {
  const vault = await optimizerVault(key);
  if (!vault) return null;
  const [state, shares] = await Promise.all([
    fetchOptimizerVaultState(key),
    // gRPC returns `{ balance: { balance } }`; the JSON-RPC `totalBalance`
    // field does not exist on this shape and silently reads as zero.
    sui()
      .getBalance({ owner: address, coinType: vault.shareType })
      .then((b) => {
        const raw = (b as unknown as { balance?: { balance?: string } }).balance?.balance;
        return raw ? BigInt(raw) : 0n;
      })
      .catch(() => 0n),
  ]);
  if (!state) return null;
  const gross = underlyingForShares(shares, state.totalUnderlying, state.totalShares);
  const value = gross - feeUp(gross, state.fees.withdrawBps);
  const earned = costBasis != null ? (value > costBasis ? value - costBasis : 0n) : 0n;
  return { shares, value: value > 0n ? value : 0n, earned };
}

// ── APY ───────────────────────────────────────────────────────────────────

/** Don't annualize a window shorter than this — the noise swamps the signal. */
const MIN_APY_WINDOW_MS = 6 * 60 * 60 * 1000;

export type PricePoint = { price: number; atMs: number };

/**
 * REALIZED APY from share-price growth between two observations.
 *
 * There is no APY field on chain — the per-adapter rates that do exist are
 * routing weights the contracts explicitly say never affect valuation, so
 * quoting one as a user-facing yield would be reporting a number that doesn't
 * describe what a holder earns. Share price is the only honest source: it only
 * moves when the pool actually gains, and it is already net of the performance
 * fee. Returns null rather than a guess when the window is too short or the
 * inputs are unusable, which keeps the venue out of the comparison instead of
 * ranking it on a fabricated rate.
 *
 * Caller supplies the two points; `lib/yield.ts` persists them through the same
 * durable global_kv the other venues' APYs are cached in.
 */
export function realizedApy(past: PricePoint, latest: PricePoint): number | null {
  const elapsed = latest.atMs - past.atMs;
  if (elapsed < MIN_APY_WINDOW_MS) return null;
  if (!(past.price > 0) || !(latest.price > 0)) return null;
  const growth = latest.price / past.price;
  if (!Number.isFinite(growth) || growth <= 0) return null;
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const apy = Math.pow(growth, YEAR_MS / elapsed) - 1;
  // A share vault that claims >100% on stablecoins is a broken read, not alpha.
  return Number.isFinite(apy) && apy >= 0 && apy < 1 ? apy : null;
}

// ── PTB builders ──────────────────────────────────────────────────────────
//
// These append the full hot-potato sequence onto an existing sponsored
// Transaction. They THROW when the venue is unavailable so a half-configured
// environment can never execute a partially-built call — a PTB that reaches the
// chain missing one adapter approval aborts anyway, and it's better to fail in
// our process than to burn a sponsored transaction proving it.

async function client() {
  const { SamClient, MAINNET } = await import("@usesamxyz/sdk");
  // Config only: the builders below never touch the SDK's read client, so the
  // fact that its default transport points at a retired endpoint is irrelevant.
  return new SamClient({ config: MAINNET });
}

/**
 * The SDK declares `@mysten/sui@^2.17` while this app is pinned to 2.16, so pnpm
 * installs a second copy and TypeScript sees two nominally distinct `Transaction`
 * types. They are the same shape and the SDK only ever calls `moveCall` /
 * `object` on the instance we hand it, so this is a compile-time artifact of the
 * duplicate install, not a runtime one. Narrowed to the two builder boundaries
 * rather than loosened repo-wide. Remove once the app moves to 2.17+.
 */
type SdkTx = Parameters<Awaited<ReturnType<typeof client>>["buyWithCoin"]>[0];
type SdkArg = ReturnType<Awaited<ReturnType<typeof client>>["buyWithCoin"]>;

/**
 * Deposit `underlyingCoin` (a `Coin<USDC>` argument) and transfer the resulting
 * share coin to `recipient`. Deposit does NOT transfer internally — the share
 * coin comes back as a value, and leaving it unconsumed fails the build.
 */
export async function buildOptimizerDeposit(
  tx: Transaction,
  underlyingCoin: TransactionObjectArgument,
  recipient: string,
  key: OptimizerVaultKey = "usdc"
): Promise<void> {
  const vault = await optimizerVault(key);
  if (!vault) throw new Error("yield optimizer unavailable");
  const c = await client();
  const shares = c.buyWithCoin(tx as unknown as SdkTx, VAULTS[key], underlyingCoin as SdkArg);
  tx.transferObjects([shares as unknown as TransactionObjectArgument], recipient);
}

/**
 * Redeem `shareCoin` back to underlying and transfer it to `recipient`. The
 * withdraw fee is charged once per leg the vault has to pull from — idle plus
 * every protocol it unwinds — so the realized fee can exceed a naive single-fee
 * quote by a base unit per leg.
 */
export async function buildOptimizerRedeem(
  tx: Transaction,
  shareCoin: TransactionObjectArgument,
  recipient: string,
  key: OptimizerVaultKey = "usdc"
): Promise<void> {
  const vault = await optimizerVault(key);
  if (!vault) throw new Error("yield optimizer unavailable");
  const c = await client();
  const out = c.redeemCoin(tx as unknown as SdkTx, VAULTS[key], shareCoin as SdkArg);
  tx.transferObjects([out as unknown as TransactionObjectArgument], recipient);
}
