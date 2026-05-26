import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { vaultPackageIds, VaultNotDeployedError } from "@/lib/vault";
import { suiJsonRpc } from "@/lib/sui";
import {
  gql,
  VAULT_AND_CAPS_QUERY,
  BAG_DYNAMIC_FIELDS_QUERY,
  decodeBagKeyVectorU8,
  type GraphQLVaultAndCapsResponse,
  type GraphQLBagDynamicFieldsResponse,
} from "@/lib/sui-graphql";

export const runtime = "nodejs";

/**
 * GET /api/vault/state
 *
 * Returns the user's vault contents + active auto-swap caps.
 *
 * Backend: a single GraphQL query against Sui GraphQL fetches the vault
 * object's contents (to extract the bag UID) AND lists the user's
 * AutoSwapCap<...> objects in one round-trip. A second GraphQL call reads
 * every dynamic field on the bag with the nested Balance<T> value
 * materialized — typically a single page (<10 coin types in the wild).
 *
 * Compared to the legacy JSON-RPC fan-out (vault getObject + bag
 * getDynamicFields + N × getObject + getOwnedObjects), this is 2 hits
 * down from 5+. The cache layer in `lib/sui-graphql.ts` also dedups
 * within the 10s TTL window.
 *
 * Shape (unchanged — iOS decodes strictly):
 *   {
 *     vault: { id, balances: [{ coinType, amount }] } | null,
 *     caps: Array<{ id, sourceType, maxPerSwap, expiresAtMs, paused }>
 *   }
 *
 * `vault` is null when the user hasn't created one yet (talise_vault_id
 * is NULL on the user row). `caps` is always an array — empty if the
 * user owns no AutoSwapCaps.
 */

type Balance = { coinType: string; amount: string };
type Cap = {
  id: string;
  sourceType: string;
  maxPerSwap: string;
  expiresAtMs: string;
  paused: boolean;
  /**
   * True when the cap is still user-owned (v2-era mint) and needs to be
   * promoted to a shared object via `vault::share_existing_cap<T>` before
   * the Onara cron worker can reference it. The owner-objects GraphQL
   * filter we use below only returns address-owned objects by definition,
   * so every cap we surface here is user-owned. After v3 migration, caps
   * become shared and stop appearing in this list (a separate discovery
   * path is needed for those — out of scope for the migration flow).
   *
   * Key is camelCase to match every other field on this DTO; iOS uses
   * a plain JSONDecoder (no snake_case conversion).
   */
  needsMigration: boolean;
};
type State = {
  vault: { id: string; balances: Balance[] } | null;
  caps: Cap[];
};

// 15s in-process cache. Vault balance + caps are not transactionally
// critical — when a user just supplied / withdrew, AutoSwapSettings
// invalidates by re-fetching after the optimistic write, and the
// resulting GraphQL hit refills this cache. Bumped from 10s because
// EarnView appears once per session and the 5s saving is meaningful.
const CACHE_TTL_MS = 15_000;
const cache = new Map<number, { at: number; state: State }>();

/** Extract the bag UID from the vault Move struct's `contents.json`. */
function extractBagId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  // Move serializes `Bag` as `{ id: { id: "0x..." }, size: "N" }`. The
  // outer wrapping `balances: { ... }` is the field name on the vault.
  const balances = (json as { balances?: unknown }).balances;
  if (!balances || typeof balances !== "object") return undefined;
  const id = (balances as { id?: unknown }).id;
  if (!id || typeof id !== "object") return undefined;
  const inner = (id as { id?: unknown }).id;
  if (typeof inner === "string") return inner;
  return undefined;
}

/**
 * Extract the u64 value from a Balance<T>'s JSON representation. Sui's
 * GraphQL emits u64 as a JSON string ("12345"); u32 and below as a number.
 * Defensive against both.
 */
function extractBalanceValue(json: unknown): string {
  if (!json || typeof json !== "object") return "0";
  const v = (json as { value?: unknown }).value;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "0";
}

/** Pull AutoSwapCap fields out of `MoveObject.contents.json`. */
function extractCapFields(
  json: unknown
): { max_per_swap: string; expires_at_ms: string; paused: boolean } {
  if (!json || typeof json !== "object") {
    return { max_per_swap: "0", expires_at_ms: "0", paused: false };
  }
  const f = json as {
    max_per_swap?: string | number;
    expires_at_ms?: string | number;
    paused?: boolean;
  };
  return {
    max_per_swap: String(f.max_per_swap ?? "0"),
    expires_at_ms: String(f.expires_at_ms ?? "0"),
    paused: Boolean(f.paused),
  };
}

/**
 * Parse the type argument out of a fully-qualified cap type repr.
 * Input:  `0x<pkg>::auto_swap::AutoSwapCap<0x<addr>::module::Name>`
 * Output: `0x<addr>::module::Name`
 *
 * The cap has exactly one type parameter so slicing between the first `<`
 * and the matching `>` is unambiguous. Returns null when the input is
 * malformed (defensive — the type-filter should have ruled that out).
 */
function extractCapInnerType(repr: string): string | null {
  const lt = repr.indexOf("<");
  if (lt < 0) return null;
  const gt = repr.lastIndexOf(">");
  if (gt < 0 || gt <= lt) return null;
  return repr.slice(lt + 1, gt);
}

/// Hard cap on AutoSwapEnabled events walked when looking up shared
/// caps. The GraphQL `owner.objects` query can't see shared objects
/// (they have no AddressOwner), so we mirror the cron's event-walk
/// approach: descend recent `AutoSwapEnabled` events, filter by owner,
/// then `getObject` each cap to verify ownership state + freshness.
const MAX_EVENTS_SCAN = 100;

type SharedCapRow = {
  id: string;
  sourceType: string;
  maxPerSwap: string;
  expiresAtMs: string;
  paused: boolean;
};

/**
 * Find every Shared `AutoSwapCap<T>` minted by `owner` via the v3
 * `enable_auto_swap` path. The cron uses the same shape — keeping the
 * UI in sync means a freshly-minted shared cap shows up as "Active"
 * on the AutoSwapSettings row instead of staying on the Enable button.
 *
 * Returns only caps whose on-chain owner is currently Shared. Burned
 * or transferred-out caps are skipped silently. Paused-but-shared caps
 * are returned (caller renders the paused-state UI).
 */
async function readSharedCapsForOwner(
  packageId: string,
  owner: string
): Promise<SharedCapRow[]> {
  const client = suiJsonRpc();
  const out: SharedCapRow[] = [];
  const seen = new Set<string>();

  let cursor: unknown = null;
  let scanned = 0;
  while (scanned < MAX_EVENTS_SCAN) {
    const page = await (
      client as unknown as {
        queryEvents: (a: {
          query: { MoveEventType: string };
          cursor?: unknown;
          limit?: number;
          order?: "ascending" | "descending";
        }) => Promise<{
          data: Array<{ parsedJson?: { cap_id?: string; owner?: string } }>;
          nextCursor: unknown;
          hasNextPage: boolean;
        }>;
      }
    ).queryEvents({
      query: { MoveEventType: `${packageId}::auto_swap::AutoSwapEnabled` },
      cursor,
      limit: 50,
      order: "descending",
    });
    for (const ev of page.data ?? []) {
      scanned++;
      const p = ev.parsedJson ?? {};
      if (p.owner !== owner) continue;
      const capId = p.cap_id;
      if (!capId || seen.has(capId)) continue;
      seen.add(capId);

      try {
        const obj = await client.getObject({
          id: capId,
          options: { showOwner: true, showType: true, showContent: true },
        });
        const d = obj.data;
        if (!d) continue;
        // Only surface SHARED caps here. Address-owned caps are surfaced
        // via the GraphQL path below (with needsMigration: true).
        const isShared = Boolean(
          (d.owner as unknown as { Shared?: unknown })?.Shared
        );
        if (!isShared) continue;

        const t = d.type;
        if (!t || !t.startsWith(`${packageId}::auto_swap::AutoSwapCap<`)) continue;
        const inner = extractCapInnerType(t);
        if (!inner) continue;

        const content = d.content;
        if (!content || content.dataType !== "moveObject") continue;
        const fields = extractCapFields(
          (content as unknown as { fields: unknown }).fields
        );
        out.push({
          id: capId,
          sourceType: inner,
          maxPerSwap: fields.max_per_swap,
          expiresAtMs: fields.expires_at_ms,
          paused: fields.paused,
        });
      } catch {
        // Burned, schema-skewed, or transient RPC error — skip silently.
      }
    }
    if (!page.hasNextPage) break;
    cursor = page.nextCursor;
  }
  return out;
}

export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  // Cache hit — short-circuit before hitting the chain.
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.state, {
      headers: {
        "Cache-Control":
          "private, max-age=0, s-maxage=10, stale-while-revalidate=30",
      },
    });
  }

  let packageId: string;
  let packageIdLatest: string;
  try {
    ({ packageId, packageIdLatest } = vaultPackageIds());
  } catch (err) {
    if (err instanceof VaultNotDeployedError) {
      return NextResponse.json(
        { error: "auto-swap package not yet deployed" },
        { status: 503 }
      );
    }
    throw err;
  }

  const vaultId = user.talise_vault_id ?? null;
  // Type prefix accepted by `ObjectFilter.type` — matches every
  // `AutoSwapCap<T>` instantiation under our package.
  const capTypePrefix = `${packageId}::auto_swap::AutoSwapCap`;

  // ──────────────────────────────────────────────────────────────
  // 1. Single GraphQL hit: vault contents + owned caps.
  let vault: State["vault"] = null;
  const caps: Cap[] = [];

  let bagId: string | undefined;
  let initialCapPage: GraphQLVaultAndCapsResponse["owner"] | null = null;
  try {
    const data = await gql<GraphQLVaultAndCapsResponse>(VAULT_AND_CAPS_QUERY, {
      vaultId, // may be null — GraphQL accepts a null SuiAddress and skips
      owner: user.sui_address,
      capType: capTypePrefix,
      first: 50,
      afterObj: null,
    });

    if (vaultId && data.vault?.asMoveObject?.contents?.json) {
      bagId = extractBagId(data.vault.asMoveObject.contents.json);
    }
    initialCapPage = data.owner;
  } catch (err) {
    // Network / GraphQL error — surface a degraded state rather than 500.
    // The frontend can still render management controls; caps falls back
    // to empty and vault to {id, balances: []} below.
    console.warn(
      `[vault/state] GraphQL vault+caps read failed: ${(err as Error).message}`
    );
  }

  // ──────────────────────────────────────────────────────────────
  // 2. Vault balances. One GraphQL call per bag page (typically 1).
  if (vaultId) {
    const balances: Balance[] = [];
    if (bagId) {
      try {
        let cursor: string | null = null;
        do {
          const data: GraphQLBagDynamicFieldsResponse = await gql<GraphQLBagDynamicFieldsResponse>(
            BAG_DYNAMIC_FIELDS_QUERY,
            { bagId, first: 50, after: cursor }
          );
          const conn: NonNullable<GraphQLBagDynamicFieldsResponse["address"]>["dynamicFields"] | undefined =
            data.address?.dynamicFields;
          if (!conn) break;
          for (const node of conn.nodes ?? []) {
            // Bag key: vector<u8> rendered as a base64 string in
            // MoveValue.json. Decode to the underlying type-name UTF-8.
            const coinType = decodeBagKeyVectorU8(node.name.json);
            if (!coinType) continue;

            // Value: Balance<T> stored by-value → MoveValue branch with
            // `json: { value: "<u64>" }`.
            let amount = "0";
            if (node.value && node.value.__typename === "MoveValue") {
              amount = extractBalanceValue(node.value.json);
            } else if (node.value && node.value.__typename === "MoveObject") {
              // Defensive — if the bag stores Balance<T> wrapped in an
              // object somewhere, the shape is the same `{ value: u64 }`
              // under `contents.json`.
              amount = extractBalanceValue(node.value.contents?.json);
            }
            balances.push({ coinType, amount });
          }
          cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
        } while (cursor);
      } catch (err) {
        console.warn(
          `[vault/state] GraphQL bag DF read failed for ${bagId}: ${
            (err as Error).message
          }`
        );
        // Continue with whatever balances we did manage to read.
      }
    }
    vault = { id: vaultId, balances };
  }

  // ──────────────────────────────────────────────────────────────
  // 3. Caps — continue paginating if the first page hit the cursor.
  if (initialCapPage) {
    const pushFromPage = (
      page: NonNullable<GraphQLVaultAndCapsResponse["owner"]>
    ) => {
      for (const node of page.objects.nodes ?? []) {
        if (!node.contents) continue;
        const inner = extractCapInnerType(node.contents.type.repr);
        if (!inner) continue;
        const fields = extractCapFields(node.contents.json);
        caps.push({
          id: node.address,
          sourceType: inner,
          maxPerSwap: fields.max_per_swap,
          expiresAtMs: fields.expires_at_ms,
          paused: fields.paused,
          // The owner-objects GraphQL filter returns ONLY address-owned
          // objects — by construction every cap here is user-owned and
          // therefore needs the v3 share_existing_cap promotion.
          needsMigration: true,
        });
      }
    };
    pushFromPage(initialCapPage);

    // Rare — typical users own <50 caps. Paginate defensively.
    let cursor: string | null = initialCapPage.objects.pageInfo.hasNextPage
      ? initialCapPage.objects.pageInfo.endCursor
      : null;
    while (cursor) {
      try {
        const data = await gql<GraphQLVaultAndCapsResponse>(
          VAULT_AND_CAPS_QUERY,
          {
            // Reuse the same query — vaultId is null so the vault branch
            // is a no-op on follow-up pages.
            vaultId: null,
            owner: user.sui_address,
            capType: capTypePrefix,
            first: 50,
            afterObj: cursor,
          }
        );
        if (!data.owner) break;
        pushFromPage(data.owner);
        cursor = data.owner.objects.pageInfo.hasNextPage
          ? data.owner.objects.pageInfo.endCursor
          : null;
      } catch (err) {
        console.warn(
          `[vault/state] GraphQL cap page failed: ${(err as Error).message}`
        );
        break;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 4. Shared caps (v3) — invisible to the owner-objects GraphQL query
  // because they have no AddressOwner. Walk recent AutoSwapEnabled
  // events filtered by owner, getObject each, keep only those still
  // Shared. needsMigration: false — these are the v3 path.
  //
  // De-dupe against the address-owned set in case a cap appears in both
  // (e.g. mid-migration race). Shared wins so the UI doesn't surface
  // a "migrate this" CTA on an already-migrated cap.
  try {
    const sharedCaps = await readSharedCapsForOwner(packageId, user.sui_address);
    const haveIds = new Set(caps.map((c) => c.id));
    // Drop address-owned duplicates of caps that have since been
    // promoted to shared.
    const sharedIds = new Set(sharedCaps.map((c) => c.id));
    for (let i = caps.length - 1; i >= 0; i--) {
      if (sharedIds.has(caps[i].id)) caps.splice(i, 1);
    }
    for (const sc of sharedCaps) {
      if (haveIds.has(sc.id)) continue;
      caps.push({
        id: sc.id,
        sourceType: sc.sourceType,
        maxPerSwap: sc.maxPerSwap,
        expiresAtMs: sc.expiresAtMs,
        paused: sc.paused,
        needsMigration: false,
      });
    }
  } catch (err) {
    console.warn(
      `[vault/state] shared-cap event scan failed: ${(err as Error).message}`
    );
    // Non-fatal — user-owned caps still surface above.
  }
  // packageIdLatest is read above so the lint stays happy when the
  // v3 codepath ships independently; we don't need it here yet beyond
  // signaling the v3-aware mode is wired.
  void packageIdLatest;

  const state: State = { vault, caps };
  cache.set(userId, { at: Date.now(), state });
  return NextResponse.json(state, {
    headers: {
      "Cache-Control":
        "private, max-age=0, s-maxage=10, stale-while-revalidate=30",
    },
  });
}
