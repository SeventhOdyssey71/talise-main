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

/** Read every active `AutoSwapCap<T>` owned by `owner`. */
async function readActiveCaps(
  packageId: string,
  owner: string
): Promise<ActiveCap[]> {
  // JSON-RPC: walks `getOwnedObjects({showType, showContent})`. gRPC's
  // `listOwnedObjects` returns a different shape that we'd need to remap.
  const client = suiJsonRpc();
  const capTypePrefix = `${packageId}::auto_swap::AutoSwapCap<`;
  const out: ActiveCap[] = [];
  let cursor: string | null | undefined = null;
  const now = BigInt(Date.now());
  do {
    const page = await client.getOwnedObjects({
      owner,
      options: { showType: true, showContent: true },
      cursor,
    });
    for (const item of page.data ?? []) {
      const t = item.data?.type;
      if (!t || !t.startsWith(capTypePrefix)) continue;
      const inner = t.slice(capTypePrefix.length, -1);
      const c = item.data?.content;
      if (!c || c.dataType !== "moveObject") continue;
      const fields = (c as unknown as {
        fields?: {
          max_per_swap?: string | number;
          expires_at_ms?: string | number;
          paused?: boolean;
        };
      }).fields ?? {};
      const paused = Boolean(fields.paused);
      const maxPerSwap = BigInt(String(fields.max_per_swap ?? "0"));
      const expiresAtMs = BigInt(String(fields.expires_at_ms ?? "0"));
      if (paused) continue;
      if (expiresAtMs !== 0n && expiresAtMs < now) continue;
      if (maxPerSwap === 0n) continue;
      out.push({
        id: item.data!.objectId,
        sourceType: canonicalizeTypeTag(inner),
        maxPerSwap,
        expiresAtMs,
        paused: false,
      });
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return out;
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
  const client = suiJsonRpc();
  const out: OwnedCoin[] = [];
  let cursor: string | null | undefined = null;
  do {
    const page = await client.getOwnedObjects({
      owner: vaultId,
      options: { showType: true, showContent: true },
      cursor,
    });
    for (const item of page.data ?? []) {
      const t = item.data?.type;
      if (!t) continue;
      const m = COIN_TYPE_RE.exec(t);
      if (!m) continue;
      const innerType = m[1];
      const c = item.data?.content;
      if (!c || c.dataType !== "moveObject") continue;
      const fields = (
        c as unknown as {
          fields?: { balance?: string | number };
        }
      ).fields ?? {};
      let balance = 0n;
      try {
        balance = BigInt(String(fields.balance ?? "0"));
      } catch {
        balance = 0n;
      }
      const coinObjectId = item.data!.objectId;
      out.push({ coinObjectId, innerType: canonicalizeTypeTag(innerType), balance });
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
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
      // reused twice.
      const caps = await readActiveCaps(packageId, u.sui_address);

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
          if (!capByType.has(oc.innerType)) {
            // No cap → we can't auto-swap it, so don't pay gas to
            // pull it into the bag. (It'll get claimed once the user
            // enables a cap for that type.)
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

  return NextResponse.json({ ok: true, ...summary });
}
