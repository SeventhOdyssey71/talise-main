import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { db, ensureSchema, userById } from "@/lib/db";
import { resolveLinqBank } from "@/lib/linq-banks";
import { getRecentActivity, type ActivityEntry } from "@/lib/activity";
import { memoTtl } from "@/lib/perf-cache";
import {
  readActivitySnapshot,
  writeActivitySnapshot,
  refreshInBackground,
} from "@/lib/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cache the (heavy) chain scan per (address, limit). The scan issues
 * two `queryTransactionBlocks` calls + a counterparty-name resolution
 * fan-out — 1-3 seconds cold. The TTL is kept short on purpose: the
 * iOS optimistic-tx flow (`HomeView.applyOptimisticTx`) schedules a
 * "reconcile" reload 1.5s after a send, then `loadActivity` overwrites
 * `activity` with the server response. A longer TTL here would serve
 * pre-tx data into that reconcile window and visibly wipe the
 * optimistic row off screen. 5s captures the common cases (appear +
 * foreground + pull-to-refresh thrash, both `.task` modifiers in
 * HomeView racing on first render) without crossing the 1.5s
 * reconcile boundary.
 */
const ACTIVITY_CACHE_TTL_MS = 5_000;

/**
 * Outer hard cap on the chain scan. Every individual leg inside
 * `getRecentActivity` is already fenced with a per-leg timeout (see
 * `withTimeout` in `lib/activity.ts`), but we wrap the orchestrator
 * one more time so a runaway scheduler / event-loop stall can't push
 * the response past iOS's 15s URLSession request deadline.
 *
 * Why 8s (was 10s): iOS APIClient sets
 * `timeoutIntervalForRequest = 15s`. A 10s outer cap left only a 5s
 * cushion for Vercel cold-start + TLS + JSON round-trip, which under
 * production load occasionally pushed the iOS receive window past 15s
 * and surfaced as NSURLErrorTimedOut (-1001) on `/api/activity?limit=20`
 * (see iOS console log forwarded 2026-05-29). 8s preserves 7s of
 * end-to-end headroom — enough for cold start + handshake — while
 * still letting the chain scan run to a useful depth (leg 1 takes
 * 1-3s warm, ~4s cold).
 */
const OUTER_CAP_MS = 8_000;

function outerCap<T>(p: Promise<T>, fallback: T): Promise<T> {
  const start = Date.now();
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(
        `[api/activity] outer cap hit at ${Date.now() - start}ms — serving fallback`
      );
      resolve(fallback);
    }, OUTER_CAP_MS);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        console.warn(
          `[api/activity] orchestrator failed after ${Date.now() - start}ms: ${(e as Error).message}`
        );
        resolve(fallback);
      }
    );
  });
}

function cachedActivity(
  address: string,
  limit: number,
  vaultId: string | null
): Promise<ActivityEntry[]> {
  // Vault id is part of the cache key so users mid-flight (vault just
  // recorded after the first activity load) get a fresh scan instead
  // of a stale wallet-only render.
  const vaultKey = vaultId ? vaultId.toLowerCase() : "novault";
  return memoTtl(
    `activity:${address.toLowerCase()}:${limit}:${vaultKey}`,
    ACTIVITY_CACHE_TTL_MS,
    () =>
      outerCap(
        getRecentActivity(address, limit, {
          includeNonTalise: true,
          vaultId,
        }),
        [] as ActivityEntry[]
      )
  );
}

/** The iOS-facing row shape. Persisted verbatim in the activity snapshot. */
type SerializedEntry = {
  digest: string;
  timestampMs: number;
  direction: ActivityEntry["direction"];
  amountUsdsui: ActivityEntry["amountUsdsui"];
  amountSui: ActivityEntry["amountSui"];
  counterparty: ActivityEntry["counterparty"];
  counterpartyName: ActivityEntry["counterpartyName"];
  venue: ActivityEntry["venue"];
  roundupUsdsui: ActivityEntry["roundupUsdsui"];
  otherCoin: ActivityEntry["otherCoin"];
  offramp: ActivityEntry["offramp"];
};

function serializeEntries(entries: ActivityEntry[]): SerializedEntry[] {
  return entries.map((e) => ({
    digest: e.digest,
    timestampMs: e.timestampMs,
    direction: e.direction,
    amountUsdsui: e.amountUsdsui,
    amountSui: e.amountSui,
    counterparty: e.counterparty,
    counterpartyName: e.counterpartyName,
    venue: e.venue,
    // Compound spend+save flag — iOS renders "Sent + saved" with both amounts.
    roundupUsdsui: e.roundupUsdsui,
    // Non-USDsui/SUI coin movement (WAL, USDC, …) — iOS renders "+ 10 WAL".
    otherCoin: e.otherCoin,
    // Cash-out detail when this send is a Linq off-ramp (set by enrichOfframps).
    offramp: e.offramp ?? null,
  }));
}

/**
 * Relabel "sent" rows whose recipient is one of the user's Linq off-ramp
 * deposit wallets into CASH-OUTS — attaching the NGN figure, bank, payout
 * status, and rate from `linq_offramps`. Lets History render "Cash out →
 * {bank}" and a proper receipt instead of an anonymous send to a 0x address.
 * Best-effort: any failure leaves the rows untouched (history must not break).
 */
async function enrichOfframps(
  userId: number,
  entries: SerializedEntry[]
): Promise<SerializedEntry[]> {
  if (!entries.some((e) => e.direction === "sent" && e.counterparty)) {
    return entries;
  }
  try {
    await ensureSchema();
    const r = await db().execute({
      sql: `SELECT wallet_address, amount_ngn, bank_code, bank_account_number,
                   status, rate, linq_order_id
            FROM linq_offramps WHERE user_id = ?`,
      args: [String(userId)],
    });
    if (r.rows.length === 0) return entries;
    const byWallet = new Map<string, Record<string, unknown>>();
    for (const row of r.rows as Array<Record<string, unknown>>) {
      const w = String(row.wallet_address ?? "").toLowerCase();
      if (w) byWallet.set(w, row);
    }
    return entries.map((e) => {
      if (e.direction !== "sent" || !e.counterparty) return e;
      const off = byWallet.get(e.counterparty.toLowerCase());
      if (!off) return e;
      const bankName = resolveLinqBank(String(off.bank_code ?? ""))?.name ?? null;
      const acct = String(off.bank_account_number ?? "");
      return {
        ...e,
        // Surface the bank instead of the raw 0x deposit wallet.
        counterpartyName: bankName ?? "Bank account",
        venue: "linq",
        offramp: {
          provider: "linq" as const,
          amountNgn: Number(off.amount_ngn ?? 0),
          bankName,
          accountLast4: acct ? acct.slice(-4) : null,
          status: String(off.status ?? "initiated"),
          rate: Number(off.rate ?? 0),
          orderId: String(off.linq_order_id ?? ""),
        },
      };
    });
  } catch (err) {
    console.warn(`[api/activity] offramp enrich failed: ${(err as Error).message}`);
    return entries;
  }
}

// Display-only snapshot freshness, mirroring /api/balances. The ?fresh=1
// post-send reconcile ALWAYS bypasses both the snapshot and the memo so a
// just-landed tx is never hidden.
const ACTIVITY_SNAPSHOT_SERVE_MAX_MS = 120_000;
const ACTIVITY_SNAPSHOT_BG_REFRESH_MS = 15_000;

// How many newest immutable events we retain in the snapshot floor. Home shows
// 4, "See all" requests up to 50; keeping 50 covers both and bounds the row.
const ACTIVITY_SNAPSHOT_CAP = 50;

/**
 * Stable de-dup key for an activity row. On-chain rows carry a unique tx
 * `digest`; for any (rare) digest-less row fall back to a synthetic key so it
 * still de-dups across merges instead of multiplying.
 */
function entryKey(e: SerializedEntry): string {
  return e.digest && e.digest.length > 0
    ? `d:${e.digest}`
    : `s:${e.direction}:${e.timestampMs}:${e.amountUsdsui ?? ""}:${e.amountSui ?? ""}`;
}

/**
 * MONOTONIC merge. On-chain history is IMMUTABLE — a row that existed last time
 * must never disappear because this refresh's chain scan was partial, timed
 * out, or transiently empty. So we union the prior snapshot with the fresh scan
 * by `digest`: existing rows are the floor, the fresh scan may UPGRADE a
 * same-digest row's classification and ADD newer rows, but can never DELETE
 * one. Result is sorted newest-first and capped. This is what makes history
 * strictly non-decreasing across refreshes.
 */
function mergeMonotonic(
  existing: SerializedEntry[],
  fresh: SerializedEntry[]
): SerializedEntry[] {
  const byKey = new Map<string, SerializedEntry>();
  for (const e of existing) byKey.set(entryKey(e), e);
  for (const e of fresh) byKey.set(entryKey(e), e); // fresh wins on collision
  return Array.from(byKey.values())
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, ACTIVITY_SNAPSHOT_CAP);
}

/**
 * Live chain scan → serialized rows, merged into the per-user snapshot as a
 * monotonic floor (see `mergeMonotonic`). `bypassMemo` forces a fresh scan
 * (the ?fresh=1 reconcile path). Because the merge can only ADD to the prior
 * snapshot, a partial/empty/failed scan can never shrink the returned feed.
 * We persist only when the fresh scan actually returned rows, so a pure
 * failure (fresh === []) leaves the existing snapshot AND its `refreshedAt`
 * untouched (it stays "due for refresh" rather than looking falsely fresh).
 */
async function computeLiveActivity(
  user: { id: number; sui_address: string; talise_vault_id: string | null },
  limit: number,
  bypassMemo: boolean
): Promise<SerializedEntry[]> {
  const raw = bypassMemo
    ? await outerCap(
        getRecentActivity(user.sui_address, limit, {
          includeNonTalise: true,
          vaultId: user.talise_vault_id ?? null,
        }),
        [] as ActivityEntry[]
      )
    : await cachedActivity(user.sui_address, limit, user.talise_vault_id ?? null);
  const fresh = await enrichOfframps(user.id, serializeEntries(raw));

  const prev = await readActivitySnapshot(user.id);
  const prevEntries = (prev?.entries as SerializedEntry[] | undefined) ?? [];
  const merged = mergeMonotonic(prevEntries, fresh);

  if (fresh.length > 0) {
    await writeActivitySnapshot({
      userId: user.id,
      address: user.sui_address,
      entries: merged,
      limit: ACTIVITY_SNAPSHOT_CAP,
      source: "chain",
    });
  }
  return merged.slice(0, limit);
}

/**
 * GET /api/activity?limit=20 — recent on-chain activity for the authed
 * user. Source of truth is the chain; a per-user Postgres snapshot serves
 * an instant first paint and is refreshed from chain in the background.
 * `?fresh=1` always reads the chain (the post-send reconcile path).
 *
 * Response: { entries: [...] } in the iOS-friendly row shape, plus
 * additive { refreshedAt, stale, source } the client may ignore.
 */
export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 20);
  const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 20));
  // `fresh=1` bypasses BOTH the snapshot and the in-process memo. iOS sets
  // this on the post-send/supply/swap reconcile so a tx that just landed
  // isn't hidden behind a stale slice (HomeView.applyOptimisticTx → reconcile).
  const bypassCache = url.searchParams.get("fresh") === "1";

  // Snapshot-first: serve a reasonably-fresh last-known feed instantly and
  // refresh from chain in the background. Never on ?fresh=1.
  if (!bypassCache) {
    const snap = await readActivitySnapshot(userId);
    if (snap && Date.now() - snap.refreshedAt <= ACTIVITY_SNAPSHOT_SERVE_MAX_MS) {
      const ageMs = Date.now() - snap.refreshedAt;
      if (ageMs > ACTIVITY_SNAPSHOT_BG_REFRESH_MS) {
        refreshInBackground(async () => {
          await computeLiveActivity(
            { id: user.id, sui_address: user.sui_address, talise_vault_id: user.talise_vault_id ?? null },
            limit,
            false
          );
        });
      }
      const entries = (snap.entries as SerializedEntry[]).slice(0, limit);
      return NextResponse.json(
        { entries, refreshedAt: snap.refreshedAt, stale: ageMs > ACTIVITY_SNAPSHOT_BG_REFRESH_MS, source: "snapshot" },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
  }

  try {
    const entries = await computeLiveActivity(
      { id: user.id, sui_address: user.sui_address, talise_vault_id: user.talise_vault_id ?? null },
      limit,
      bypassCache
    );
    return NextResponse.json(
      { entries, refreshedAt: Date.now(), stale: false, source: "chain" },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    console.warn(`[api/activity] failed: ${(err as Error).message}`);
    // Last resort: serve the immutable snapshot floor rather than blanking the
    // feed. History must never shrink just because a live compute threw.
    const snap = await readActivitySnapshot(userId).catch(() => null);
    const entries = snap ? (snap.entries as SerializedEntry[]).slice(0, limit) : [];
    return NextResponse.json(
      {
        entries,
        refreshedAt: snap?.refreshedAt ?? 0,
        stale: true,
        source: "snapshot-fallback",
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
