import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { suiJsonRpc } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { vaultPackageIds, VaultNotDeployedError } from "@/lib/vault";

export const runtime = "nodejs";
// Cron handlers should not be cached; force dynamic.
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/auto-swap-sweep
 *
 * Vercel cron entry. Walks every user with a recorded `talise_vault_id`,
 * reads their vault contents + active `AutoSwapCap` set from chain, and
 * for each (non-USDsui balance, matching cap) pair POSTs a swap request
 * to the Onara worker. Onara composes the
 *   `vault::auto_swap_extract → Cetus → vault::auto_swap_deposit`
 * PTB, signs as the registered admin, and broadcasts.
 *
 * Design choices, briefly:
 *   • Sequential per-user iteration. We don't have enough users yet to
 *     justify parallelism, and Onara's `/auto-swap` is a one-tx-at-a-time
 *     operation against the same sponsor wallet — parallel calls would
 *     just queue inside Onara anyway.
 *   • Per-user try/catch. One unreadable vault or one Onara timeout
 *     should not abort the entire sweep — the other users still run.
 *   • Dust floor (`DUST_FLOOR_RAW`). Skip balances small enough that the
 *     Cetus swap fee would dwarf the proceeds.
 *   • Cap-bounded amount. We send `min(balance, cap.maxPerSwap)` so the
 *     Move-level `validate_for_swap` cap is honored upfront; the
 *     remainder gets picked up on the next cron tick.
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` header. Vercel
 * automatically attaches this when invoking declared crons. Any other
 * caller gets a 401.
 */

// ───────────────────────────────────────────────────────────────────
// Tunables

/// Skip balances whose raw u64 value is below this. 100_000 units is
/// a sensible floor across decimals: $0.0001 USDC (6 decimals),
/// 0.0001 SUI (9 decimals), 0.0001 USDsui (6 decimals). Anything below
/// this and the Cetus fee + Sui gas would exceed the swap proceeds.
const DUST_FLOOR_RAW = 100_000n;

/// Hard cap on users processed per cron invocation. Vercel functions
/// time out at 60s on Hobby and 300s on Pro; we want to comfortably
/// finish under either. With ~3s per swap (worst case) this lets us
/// safely sweep up to 80 users on Pro / 15 on Hobby.
const MAX_USERS_PER_TICK = 80;

// ───────────────────────────────────────────────────────────────────
// Auth

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

// ───────────────────────────────────────────────────────────────────
// Type-tag canonicalization
//
// Bag keys (written by Move's `type_name::get<T>()`) are full canonical
// form without `0x` and with the address left-padded to 64 hex chars:
//   "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
//
// Cap `sourceType` (extracted from `getOwnedObjects.data.type`) is the
// RPC's short form, where the SDK collapses leading-zero addresses:
//   "0x2::sui::SUI"
//
// These two never matched via direct string equality, so `capByType.get`
// always missed and the per-user sweep silently fell through with no
// log. Canonicalize both sides into "0x" + 64-char address + "::module::Type"
// before comparing.

function canonicalizeTypeTag(t: string): string {
  // Normalize to the SHORT form: strip leading zeros from the address
  // half. The 64-char canonical form (what `type_name::get` writes into
  // bag keys) and the short form (what the Sui RPC returns in `data.type`
  // and what downstream consumers like the Cetus aggregator's pool index
  // use) both reduce to the same short representation when leading zeros
  // are dropped.
  //
  // We picked SHORT (not 64-char canonical) because:
  //   - Cetus aggregator's pool index keys by short form; long form
  //     hits "Cannot read properties of undefined (reading 'map')"
  //     deep in the SDK.
  //   - The Sui CLI / @mysten/sui SDK canonicalize to short by default.
  const idx = t.indexOf("::");
  if (idx < 0) return t;
  let addr = t.slice(0, idx);
  const tail = t.slice(idx);
  if (addr.startsWith("0x") || addr.startsWith("0X")) {
    addr = addr.slice(2);
  }
  // Strip leading zeros, but keep at least one digit (so "0000…0000"
  // doesn't collapse to "").
  addr = addr.toLowerCase().replace(/^0+/, "") || "0";
  return `0x${addr}${tail}`;
}

// ───────────────────────────────────────────────────────────────────
// Chain reads

type VaultBalance = { coinType: string; amount: bigint };
type ActiveCap = {
  id: string;
  sourceType: string;
  maxPerSwap: bigint;
  expiresAtMs: bigint;
  paused: boolean;
};

/** Outcome of a single cap discovery pass. */
type CapsReadResult = {
  caps: ActiveCap[];
  /** How many candidate caps were user-owned (v2 leftovers) and skipped. */
  userOwnedSkipped: number;
  /** How many candidate caps were paused/expired/zero-max and skipped. */
  skippedInvalid: number;
};

/// Hard cap on `AutoSwapEnabled` events walked per tick. The cron runs
/// every minute against a 60s Vercel budget; even at 100ms/event a 100-
/// event walk only costs ~10s of the budget. Bumping higher risks the
/// per-user processing loop getting starved.
const MAX_EVENTS_PER_TICK = 100;

/** Read a single vault's `Balance<T>` map by paging its inner Bag. */
async function readVaultBalances(vaultId: string): Promise<VaultBalance[]> {
  // JSON-RPC: relies on `getObject({id, options.showContent})` response
  // shape (`{data: {content: {dataType: "moveObject", fields}}}`) and
  // `getDynamicFields` byte-array name decoding — both diverge from gRPC.
  const client = suiJsonRpc();
  const vObj = await client.getObject({
    id: vaultId,
    options: { showContent: true },
  });
  const content = vObj.data?.content;
  if (!content || content.dataType !== "moveObject") return [];
  const bagId = (
    content as unknown as {
      fields?: { balances?: { fields?: { id?: { id?: string } } } };
    }
  ).fields?.balances?.fields?.id?.id;
  if (!bagId) return [];

  const out: VaultBalance[] = [];
  let cursor: string | null | undefined = null;
  do {
    const page = (await (
      client as unknown as {
        getDynamicFields: (a: { parentId: string; cursor?: string | null }) => Promise<{
          data: Array<{ name: { value: unknown }; objectId: string }>;
          nextCursor: string | null;
          hasNextPage: boolean;
        }>;
      }
    ).getDynamicFields({ parentId: bagId, cursor }));
    for (const f of page.data) {
      // Bag key is a vector<u8> of the type-name; decode bytes → string.
      const bytes = f.name.value;
      let coinType = "";
      if (Array.isArray(bytes)) {
        coinType = String.fromCharCode(
          ...(bytes as number[]).filter((n) => typeof n === "number")
        );
      } else if (typeof bytes === "string") {
        coinType = bytes;
      }
      if (!coinType) continue;

      try {
        const fo = await client.getObject({
          id: f.objectId,
          options: { showContent: true },
        });
        const fc = fo.data?.content;
        if (!fc || fc.dataType !== "moveObject") continue;
        const v = (
          fc as unknown as {
            fields?: {
              value?: { fields?: { value?: string | number } } | string | number;
            };
          }
        ).fields?.value;
        let amount = 0n;
        if (typeof v === "object" && v !== null && "fields" in v) {
          amount = BigInt(
            String((v as { fields?: { value?: string | number } }).fields?.value ?? "0")
          );
        } else if (typeof v === "string" || typeof v === "number") {
          amount = BigInt(v);
        }
        if (amount > 0n) out.push({ coinType: canonicalizeTypeTag(coinType), amount });
      } catch {
        /* unreadable field — skip rather than abort the whole user */
      }
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return out;
}

/**
 * Decode an `AutoSwapCap<T>` object response into an `ActiveCap`, filtering
 * out paused / expired / zero-max caps. Returns `null` when the object is
 * not a usable cap, along with an `invalid` flag for the diagnostic counter.
 *
 * `requireShared` is set when we're walking the v3 (shared-cap) world —
 * any cap that still reports `AddressOwner` ownership is from the v2
 * lineage and must be skipped (Onara's PTB build rejects them with
 * "Transaction was not signed by the correct sender"). The caller bumps
 * the `userOwnedSkipped` counter separately, so we just return `null`
 * here and signal via the return shape.
 */
function decodeCapObject(
  raw: {
    data?: {
      objectId?: string;
      type?: string | null;
      owner?: unknown;
      content?: { dataType?: string; fields?: unknown } | null;
    } | null;
  },
  capTypePrefix: string,
  now: bigint
): { cap?: ActiveCap; userOwned?: boolean; invalid?: boolean } {
  const data = raw.data;
  if (!data) return { invalid: true };
  const t = data.type ?? "";
  if (!t.startsWith(capTypePrefix)) return { invalid: true };
  const inner = t.slice(capTypePrefix.length, -1);

  const c = data.content;
  if (!c || c.dataType !== "moveObject") return { invalid: true };
  const fields = (c as { fields?: {
    max_per_swap?: string | number;
    expires_at_ms?: string | number;
    paused?: boolean;
  } }).fields ?? {};
  const paused = Boolean(fields.paused);
  const maxPerSwap = BigInt(String(fields.max_per_swap ?? "0"));
  const expiresAtMs = BigInt(String(fields.expires_at_ms ?? "0"));
  if (paused) return { invalid: true };
  if (expiresAtMs !== 0n && expiresAtMs < now) return { invalid: true };
  if (maxPerSwap === 0n) return { invalid: true };

  // Owner inspection. The Sui RPC encodes ownership as:
  //   "Immutable" | { AddressOwner: string } | { ObjectOwner: string } |
  //   { Shared: { initial_shared_version: number } }
  const owner = data.owner;
  const isShared =
    typeof owner === "object" &&
    owner !== null &&
    "Shared" in (owner as Record<string, unknown>);
  const isAddressOwned =
    typeof owner === "object" &&
    owner !== null &&
    "AddressOwner" in (owner as Record<string, unknown>);

  if (isAddressOwned && !isShared) {
    return { userOwned: true };
  }

  return {
    cap: {
      id: String(data.objectId ?? ""),
      sourceType: canonicalizeTypeTag(inner),
      maxPerSwap,
      expiresAtMs,
      paused: false,
    },
  };
}

/**
 * Read every active `AutoSwapCap<T>` for `owner` via the v2 path:
 * `getOwnedObjects(owner)`. Address-owned caps only — by definition, a
 * shared cap won't show up here, so this function is the v1/v2 legacy
 * read.
 */
async function readActiveCapsLegacy(
  packageId: string,
  owner: string
): Promise<CapsReadResult> {
  // JSON-RPC: walks `getOwnedObjects({showType, showContent})`. gRPC's
  // `listOwnedObjects` returns a different shape that we'd need to remap.
  const client = suiJsonRpc();
  const capTypePrefix = `${packageId}::auto_swap::AutoSwapCap<`;
  const caps: ActiveCap[] = [];
  let skippedInvalid = 0;
  let cursor: string | null | undefined = null;
  const now = BigInt(Date.now());
  do {
    const page = await client.getOwnedObjects({
      owner,
      options: { showType: true, showContent: true, showOwner: true },
      cursor,
    });
    for (const item of page.data ?? []) {
      const t = item.data?.type;
      if (!t || !t.startsWith(capTypePrefix)) continue;
      const decoded = decodeCapObject(item, capTypePrefix, now);
      if (decoded.cap) caps.push(decoded.cap);
      else if (decoded.invalid) skippedInvalid++;
      // userOwned can't happen on the legacy path (we queried by owner)
      // but if it did we'd count it as a skip anyway.
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return { caps, userOwnedSkipped: 0, skippedInvalid };
}

/**
 * Read every active `AutoSwapCap<T>` for `owner` via the v3 event-driven
 * path. Walks the most recent `AutoSwapEnabled` events emitted by the
 * package, filters to those whose `owner` field matches the user, and
 * resolves each `cap_id` via `getObject`. Caps whose ownership is still
 * `AddressOwner` (i.e. minted under v2 before the shared-cap migration)
 * are skipped and counted in `userOwnedSkipped` so callers can log a
 * single roll-up line per tick instead of one log entry per stale cap.
 *
 * Event walk is bounded by `MAX_EVENTS_PER_TICK` so we don't blow the
 * Vercel 60s budget on a long-lived package. Caps are de-duplicated by
 * id within the walk (a paused→resumed cap can re-emit `AutoSwapEnabled`).
 */
async function readActiveCapsViaEvents(
  packageId: string,
  owner: string
): Promise<CapsReadResult> {
  const client = suiJsonRpc();
  const capTypePrefix = `${packageId}::auto_swap::AutoSwapCap<`;
  const now = BigInt(Date.now());
  const moveEventType = `${packageId}::auto_swap::AutoSwapEnabled`;

  // Step 1: collect candidate cap_ids from recent AutoSwapEnabled events.
  const seenCapIds = new Set<string>();
  const seenOwner = owner.toLowerCase();
  let walked = 0;
  let cursor: { txDigest: string; eventSeq: string } | null | undefined = null;
  while (walked < MAX_EVENTS_PER_TICK) {
    const remaining = MAX_EVENTS_PER_TICK - walked;
    const page = await client.queryEvents({
      query: { MoveEventType: moveEventType },
      cursor: cursor ?? null,
      // Page size; we'll loop until we hit MAX_EVENTS_PER_TICK or run out.
      limit: Math.min(50, remaining),
      order: "descending",
    });
    for (const ev of page.data ?? []) {
      walked++;
      const pj = ev.parsedJson as
        | { owner?: string; cap_id?: string }
        | null
        | undefined;
      if (!pj) continue;
      const evOwner = (pj.owner ?? "").toLowerCase();
      const capId = pj.cap_id ?? "";
      if (!capId) continue;
      if (evOwner && evOwner !== seenOwner) continue;
      seenCapIds.add(capId);
    }
    if (!page.hasNextPage || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  if (seenCapIds.size === 0) {
    return { caps: [], userOwnedSkipped: 0, skippedInvalid: 0 };
  }

  // Step 2: resolve each candidate via getObject and classify by ownership.
  const caps: ActiveCap[] = [];
  let userOwnedSkipped = 0;
  let skippedInvalid = 0;
  for (const id of seenCapIds) {
    try {
      const obj = await client.getObject({
        id,
        options: { showOwner: true, showType: true, showContent: true },
      });
      const decoded = decodeCapObject(obj as { data?: typeof obj.data }, capTypePrefix, now);
      if (decoded.cap) caps.push(decoded.cap);
      else if (decoded.userOwned) userOwnedSkipped++;
      else if (decoded.invalid) skippedInvalid++;
    } catch {
      // Cap may have been burned (disable<T>) between the event emission
      // and our getObject — count as invalid and move on.
      skippedInvalid++;
    }
  }
  return { caps, userOwnedSkipped, skippedInvalid };
}

/**
 * Read active `AutoSwapCap<T>` set for `owner`. Picks the discovery
 * strategy by comparing original vs latest package id: if they differ
 * we assume v3 (shared caps) and walk events; otherwise fall back to
 * the legacy owned-object walk.
 */
async function readActiveCaps(
  packageId: string,
  packageIdLatest: string,
  owner: string
): Promise<CapsReadResult> {
  if (packageIdLatest && packageIdLatest !== packageId) {
    return readActiveCapsViaEvents(packageId, owner);
  }
  return readActiveCapsLegacy(packageId, owner);
}

// ───────────────────────────────────────────────────────────────────
// Address-owned coin discovery
//
// When the user's @talise subname resolves to the vault's object id,
// inbound `transfer::public_transfer(coin, vault_addr)` calls leave a
// `Coin<T>` "address-owned" by the vault. The vault is shared, so no
// signer can spend that coin via the normal owned-object pathway —
// `vault::receive_and_deposit<T>` is the only way to fold it in.
//
// `readVaultOwnedCoins` paginates `getOwnedObjects(vaultId)` and returns
// every `Coin<T>` it finds, decoded into `{coinObjectId, innerType,
// balance}`. The caller filters by active-cap source type before
// dispatching to Onara, so coins of unsupported types are silently
// ignored (no one to swap them anyway).

const COIN_TYPE_RE = /^0x2::coin::Coin<(.+)>$/;

type OwnedCoin = {
  coinObjectId: string;
  innerType: string;
  balance: bigint;
};

/** List `Coin<T>` objects address-owned by `vaultId`. */
async function readVaultOwnedCoins(vaultId: string): Promise<OwnedCoin[]> {
  // Use suix_getAllBalances → suix_getCoins(per coinType) instead of
  // suix_getOwnedObjects. Reason: when an `AddressOwner` is the address
  // of a SHARED object (e.g. the vault), the indexer's owner-objects
  // table returns empty even though the coins exist and show up in
  // getAllBalances / getCoins. This is the path coins-sent-to-@handle
  // take, so we MUST use the alternate discovery here.
  const client = suiJsonRpc();
  const out: OwnedCoin[] = [];
  const balances = await (
    client as unknown as {
      getAllBalances: (a: { owner: string }) => Promise<
        Array<{ coinType: string; totalBalance: string }>
      >;
    }
  ).getAllBalances({ owner: vaultId });

  for (const b of balances ?? []) {
    if (!b.coinType) continue;
    if (BigInt(b.totalBalance ?? "0") === 0n) continue;
    // Page through every Coin<T> object of this type at the vault
    // address. Typically 1–2 objects per type for a fresh handle.
    let cursor: string | null | undefined = null;
    do {
      const page = await (
        client as unknown as {
          getCoins: (a: {
            owner: string;
            coinType: string;
            cursor?: string | null;
            limit?: number;
          }) => Promise<{
            data: Array<{ coinObjectId: string; balance: string }>;
            nextCursor: string | null;
            hasNextPage: boolean;
          }>;
        }
      ).getCoins({ owner: vaultId, coinType: b.coinType, cursor, limit: 50 });
      for (const c of page.data ?? []) {
        let bal = 0n;
        try {
          bal = BigInt(c.balance ?? "0");
        } catch {
          bal = 0n;
        }
        if (bal === 0n) continue;
        out.push({
          coinObjectId: c.coinObjectId,
          innerType: canonicalizeTypeTag(b.coinType),
          balance: bal,
        });
      }
      cursor = page.hasNextPage ? page.nextCursor : null;
    } while (cursor);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────
// Onara dispatch

type SwapResult =
  | { ok: true; digest: string }
  | { ok: false; error: string };

/**
 * POST `/receive-and-deposit` — claim an address-owned `Coin<T>` into the
 * vault's bag via `vault::receive_and_deposit<T>` (package v2).
 *
 * `packageId` must be the v2 (or later) published-at id — the entry
 * function does not exist in v1. The caller is responsible for using
 * `packageIdLatest` from `vaultPackageIds()`.
 */
async function callOnaraReceiveAndDeposit(args: {
  onaraUrl: string;
  packageId: string;
  vaultId: string;
  coinObjectId: string;
  coinType: string;
}): Promise<SwapResult> {
  try {
    const r = await fetch(
      `${args.onaraUrl.replace(/\/+$/, "")}/receive-and-deposit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vaultId: args.vaultId,
          coinObjectId: args.coinObjectId,
          coinType: args.coinType,
          packageId: args.packageId,
        }),
      }
    );
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || body.ok === false) {
      return {
        ok: false,
        error: typeof body.error === "string" ? body.error : `HTTP ${r.status}`,
      };
    }
    return { ok: true, digest: String(body.digest ?? "") };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function callOnaraSwap(args: {
  onaraUrl: string;
  packageId: string;
  packageIdLatest: string;
  registryId: string;
  vaultId: string;
  capId: string;
  sourceType: string;
  destType: string;
  amount: bigint;
}): Promise<SwapResult> {
  try {
    const r = await fetch(`${args.onaraUrl.replace(/\/+$/, "")}/auto-swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultId: args.vaultId,
        capId: args.capId,
        sourceType: args.sourceType,
        destType: args.destType,
        amount: args.amount.toString(),
        packageId: args.packageId,
        // v4+ auto_swap_deposit_to_owner only exists in the latest pkg.
        packageIdLatest: args.packageIdLatest,
        registryId: args.registryId,
      }),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || body.ok === false) {
      return {
        ok: false,
        error: typeof body.error === "string" ? body.error : `HTTP ${r.status}`,
      };
    }
    return { ok: true, digest: String(body.digest ?? "") };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ───────────────────────────────────────────────────────────────────
// Handler

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  let packageId: string;
  let packageIdLatest: string;
  let registryId: string;
  let usdsuiType: string;
  try {
    ({ packageId, packageIdLatest, registryId, usdsuiType } = vaultPackageIds());
    // Canonicalize so equality checks against bag keys (which arrive
    // from Move's `type_name::get<T>()` already in canonical form) line
    // up without leading-zero/0x discrepancies.
    usdsuiType = canonicalizeTypeTag(usdsuiType);
  } catch (err) {
    if (err instanceof VaultNotDeployedError) {
      return NextResponse.json(
        { ok: true, skipped: "auto-swap package not deployed", scanned: 0 },
        { status: 200 }
      );
    }
    throw err;
  }

  const onaraUrl = process.env.ONARA_URL;
  if (!onaraUrl) {
    return NextResponse.json(
      { error: "ONARA_URL not configured" },
      { status: 503 }
    );
  }

  await ensureSchema();

  // Eligible users: anyone who's recorded a vault. Vault objects are
  // shared, but only their owner ever holds caps, so the read pivots
  // off the user row.
  const r = await db().execute({
    sql: `SELECT id, sui_address, talise_vault_id
            FROM users
           WHERE talise_vault_id IS NOT NULL
           ORDER BY id ASC
           LIMIT ?`,
    args: [MAX_USERS_PER_TICK],
  });
  const users = r.rows as Array<{
    id: number;
    sui_address: string;
    talise_vault_id: string;
  }>;
  // Diagnostic: surface user count + first row so we can see whether
  // the cron has any work without needing direct DB access. Logged at
  // the top so it shows up even when the per-user loop body never
  // executes (zero-users case).
  console.log(
    `[auto-swap-sweep] users_with_vault=${users.length}` +
      (users[0]
        ? ` first={id:${users[0].id},sui_addr:${users[0].sui_address.slice(0, 10)}...,vault:${users[0].talise_vault_id.slice(0, 10)}...}`
        : "")
  );

  const summary = {
    scanned: 0,
    eligible: 0,
    swept: 0,
    skipped_dust: 0,
    failed: 0,
    /** Address-owned `Coin<T>` claimed into the vault bag this tick. */
    claimed: 0,
    /** Address-owned coins skipped because no matching active cap. */
    claim_skipped_no_cap: 0,
    /** Address-owned coins that failed to claim. */
    claim_failed: 0,
    /** Shared caps (v3) that were usable this tick. */
    caps_shared: 0,
    /**
     * User-owned caps (v2 lineage) skipped this tick because Onara's
     * PTB rejects them with "Transaction was not signed by the correct
     * sender" — they need explicit user migration to v3 before they
     * become sweepable again. Surfaced as a single roll-up counter
     * (one log line per tick, no per-user spam) so we can watch the
     * migration drain over time.
     */
    caps_user_owned_skipped: 0,
    /** Caps skipped because paused / expired / zero max / burned. */
    caps_skipped_invalid: 0,
    details: [] as Array<{
      userId: number;
      vault: string;
      coinType?: string;
      amount?: string;
      digest?: string;
      error?: string;
      step?: "claim" | "swap";
    }>,
  };

  for (const u of users) {
    summary.scanned++;
    try {
      // Active-cap set first — we need it to filter the address-owned
      // coin sweep AND to drive the balance-bag sweep below. One read,
      // reused twice. On v3 deploys (packageIdLatest !== packageId)
      // this walks `AutoSwapEnabled` events and resolves shared caps;
      // on pre-v3 it falls back to `getOwnedObjects(owner)`.
      const capsResult = await readActiveCaps(
        packageId,
        packageIdLatest,
        u.sui_address
      );
      const caps = capsResult.caps;
      summary.caps_shared += caps.length;
      summary.caps_user_owned_skipped += capsResult.userOwnedSkipped;
      summary.caps_skipped_invalid += capsResult.skippedInvalid;

      // Index caps by source type for O(1) match-up.
      const capByType = new Map<string, ActiveCap>();
      for (const c of caps) capByType.set(c.sourceType, c);

      // ─── Step 1: claim address-owned coins into the vault bag ─────
      //
      // Coins sent to the vault's *address* (via @talise subname
      // resolution) sit as orphans until `vault::receive_and_deposit`
      // folds them in. We only claim types where the user has an active
      // cap — otherwise the deposited balance would just sit idle in
      // the bag with nothing to swap it.
      //
      // This step uses `packageIdLatest` because `receive_and_deposit`
      // only exists in package v2+. The cron will silently no-op the
      // claim step on pre-v2 deploys (no coins matched, or Onara errors
      // — either way we fall through to the balance sweep below).
      try {
        const ownedCoins = await readVaultOwnedCoins(u.talise_vault_id);
        for (const oc of ownedCoins) {
          if (oc.balance === 0n) continue;
          // Claim if (a) we have a cap for this type (it'll be swapped
          // on the same tick) OR (b) it's USDsui directly — USDsui has
          // no cap by design (it's the destination, not a source), but
          // we still want to receive it so the v4
          // `auto_swap_deposit_to_owner` drain flushes it to the user's
          // wallet on the next swap tick. Without this special case,
          // USDsui sent to @handle would sit address-owned at the vault
          // forever.
          const isUsdsuiDest = oc.innerType === usdsuiType;
          if (!capByType.has(oc.innerType) && !isUsdsuiDest) {
            // No cap and not the dest type → can't move it forward.
            summary.claim_skipped_no_cap++;
            continue;
          }
          const res = await callOnaraReceiveAndDeposit({
            onaraUrl,
            packageId: packageIdLatest,
            vaultId: u.talise_vault_id,
            coinObjectId: oc.coinObjectId,
            coinType: oc.innerType,
          });
          if (res.ok) {
            summary.claimed++;
            summary.details.push({
              userId: u.id,
              vault: u.talise_vault_id,
              coinType: oc.innerType,
              amount: oc.balance.toString(),
              digest: res.digest,
              step: "claim",
            });
            console.log(
              `[auto-swap-sweep] user=${u.id} claimed ${oc.balance.toString()} of ${oc.innerType} digest=${res.digest}`
            );
          } else {
            summary.claim_failed++;
            summary.details.push({
              userId: u.id,
              vault: u.talise_vault_id,
              coinType: oc.innerType,
              amount: oc.balance.toString(),
              error: res.error,
              step: "claim",
            });
            console.warn(
              `[auto-swap-sweep] user=${u.id} claim-failed ${oc.innerType}: ${res.error}`
            );
          }
        }
      } catch (err) {
        // Don't abort the user — the bag-sweep below may still pick up
        // pre-existing balances.
        console.warn(
          `[auto-swap-sweep] user=${u.id} owned-coin-read-error: ${(err as Error).message}`
        );
      }

      // ─── Step 2: sweep the vault's balance bag through Cetus ──────
      //
      // Read AFTER the claim step so any just-deposited balance is
      // visible to this tick.
      const balances = await readVaultBalances(u.talise_vault_id);

      for (const b of balances) {
        // Don't try to swap USDsui to USDsui.
        if (b.coinType === usdsuiType) continue;
        const cap = capByType.get(b.coinType);
        if (!cap) continue; // user hasn't opted in for this type
        summary.eligible++;

        if (b.amount < DUST_FLOOR_RAW) {
          summary.skipped_dust++;
          continue;
        }

        const amount = b.amount < cap.maxPerSwap ? b.amount : cap.maxPerSwap;

        const res = await callOnaraSwap({
          onaraUrl,
          packageId,
          packageIdLatest,
          registryId,
          vaultId: u.talise_vault_id,
          capId: cap.id,
          sourceType: b.coinType,
          destType: usdsuiType,
          amount,
        });

        if (res.ok) {
          summary.swept++;
          summary.details.push({
            userId: u.id,
            vault: u.talise_vault_id,
            coinType: b.coinType,
            amount: amount.toString(),
            digest: res.digest,
            step: "swap",
          });
          console.log(
            `[auto-swap-sweep] user=${u.id} swept ${amount.toString()} of ${b.coinType} digest=${res.digest}`
          );
        } else {
          summary.failed++;
          summary.details.push({
            userId: u.id,
            vault: u.talise_vault_id,
            coinType: b.coinType,
            amount: amount.toString(),
            error: res.error,
            step: "swap",
          });
          console.warn(
            `[auto-swap-sweep] user=${u.id} failed ${b.coinType}: ${res.error}`
          );
        }
      }
    } catch (err) {
      summary.failed++;
      summary.details.push({
        userId: u.id,
        vault: u.talise_vault_id,
        error: (err as Error).message,
      });
      console.warn(
        `[auto-swap-sweep] user=${u.id} read-error: ${(err as Error).message}`
      );
      // continue with next user
    }
  }

  // Single roll-up line per tick. Avoids per-user spam for the
  // user-owned-cap migration drain — we want to see the count fall,
  // not a wall of "skipped user-owned cap" warnings every minute.
  console.log(
    `[auto-swap-sweep] caps: shared=${summary.caps_shared} ` +
      `user_owned=${summary.caps_user_owned_skipped} ` +
      `skipped_invalid=${summary.caps_skipped_invalid}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
