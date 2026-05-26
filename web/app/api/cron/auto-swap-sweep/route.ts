import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { sui } from "@/lib/sui";
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
  const client = sui();
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
        if (amount > 0n) out.push({ coinType, amount });
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
  const client = sui();
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
        sourceType: inner,
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
// Onara dispatch

type SwapResult =
  | { ok: true; digest: string }
  | { ok: false; error: string };

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
  let registryId: string;
  let usdsuiType: string;
  try {
    ({ packageId, registryId, usdsuiType } = vaultPackageIds());
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

  const summary = {
    scanned: 0,
    eligible: 0,
    swept: 0,
    skipped_dust: 0,
    failed: 0,
    details: [] as Array<{
      userId: number;
      vault: string;
      coinType?: string;
      amount?: string;
      digest?: string;
      error?: string;
    }>,
  };

  for (const u of users) {
    summary.scanned++;
    try {
      const [balances, caps] = await Promise.all([
        readVaultBalances(u.talise_vault_id),
        readActiveCaps(packageId, u.sui_address),
      ]);

      // Index caps by source type for O(1) match-up.
      const capByType = new Map<string, ActiveCap>();
      for (const c of caps) capByType.set(c.sourceType, c);

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
