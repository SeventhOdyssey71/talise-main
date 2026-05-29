import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { vaultPackageIds, VaultNotDeployedError } from "@/lib/vault";
import { sui } from "@/lib/sui";
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
  /**
   * True when the cap is a v1 `AutoSwapCap<T>` (lacks the v7 per-day
   * throttle) and the user should run `vault::upgrade_cap_to_v2<T>` to
   * promote it to a `AutoSwapCapV2<T>`. After v7 lands the cron only
   * sweeps v2 caps — v1 caps still execute swaps via the legacy path
   * during the transition but UI surfaces an Upgrade CTA so the user
   * opts in to the daily-budget protection. False for v2 caps, which
   * are the post-upgrade shape and need no further action.
   */
  isV1: boolean;
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
  /** v1 `AutoSwapCap<T>` vs v2 `AutoSwapCapV2<T>` — drives the iOS
   *  Upgrade banner. */
  isV1: boolean;
};

/**
 * GraphQL query: paginated `events` filtered by event type. gRPC's
 * subscriptionService.subscribeEvents is forward-streaming only — historical
 * walks must go through GraphQL. We request `contents.json` so the parsed
 * Move struct (cap_id, owner, new_cap_id) is available without a second BCS
 * decode.
 */
const EVENTS_BY_TYPE_QUERY = /* GraphQL */ `
  query EventsByType($type: String!, $first: Int!, $after: String) {
    events(filter: { type: $type }, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        contents { json }
      }
    }
  }
`;

type GraphQLEventsByTypeResponse = {
  events: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ contents: { json: unknown } | null }>;
  } | null;
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
  const client = sui();
  const out: SharedCapRow[] = [];
  const seen = new Set<string>();

  let cursor: string | null = null;
  let scanned = 0;
  while (scanned < MAX_EVENTS_SCAN) {
    const page: GraphQLEventsByTypeResponse = await gql<GraphQLEventsByTypeResponse>(
      EVENTS_BY_TYPE_QUERY,
      {
        type: `${packageId}::auto_swap::AutoSwapEnabled`,
        first: 50,
        after: cursor,
      }
    );
    if (!page.events) break;
    for (const ev of page.events.nodes ?? []) {
      scanned++;
      const p = (ev.contents?.json ?? {}) as {
        cap_id?: string;
        owner?: string;
      };
      if (p.owner !== owner) continue;
      const capId = p.cap_id;
      if (!capId || seen.has(capId)) continue;
      seen.add(capId);

      try {
        // gRPC `getObject` with `include.json: true` materializes the
        // Move struct fields as a JS record. `type`, `owner`, and `json`
        // are all top-level on the response's `.object`.
        const obj = await client.getObject({
          objectId: capId,
          include: { json: true },
        });
        const d = obj.object;
        if (!d) continue;
        // Only surface SHARED caps here. Address-owned caps are surfaced
        // via the GraphQL path below (with needsMigration: true).
        // gRPC owner is discriminated — `$kind === "Shared"` for shared
        // objects (legacy `owner.Shared` key is also present on the
        // SharedOwner shape, but reading `$kind` is the documented path).
        if (d.owner?.$kind !== "Shared") continue;

        const t = d.type;
        if (!t || !t.startsWith(`${packageId}::auto_swap::AutoSwapCap<`)) continue;
        const inner = extractCapInnerType(t);
        if (!inner) continue;

        // gRPC: `json` IS the parsed fields directly (no `dataType` /
        // `fields` indirection that JSON-RPC had).
        const fields = extractCapFields(d.json);
        out.push({
          id: capId,
          sourceType: inner,
          maxPerSwap: fields.max_per_swap,
          expiresAtMs: fields.expires_at_ms,
          paused: fields.paused,
          isV1: true,
        });
      } catch {
        // Burned, schema-skewed, or transient RPC error — skip silently.
      }
    }
    if (!page.events.pageInfo.hasNextPage) break;
    cursor = page.events.pageInfo.endCursor;
    if (!cursor) break;
  }
  return out;
}

/**
 * Find every Shared `AutoSwapCapV2<T>` minted by `owner` via the v7
 * `vault::upgrade_cap_to_v2` migration. Emits `CapUpgradedToV2` —
 * we walk those (descending) and getObject each `new_cap_id` to
 * confirm it's still Shared and read its current fields.
 *
 * `enable_auto_swap_v2` (if/when added) would emit a different event,
 * but for the v7 transition window the only path to a v2 cap is the
 * upgrade entry. New mints get added as a separate walker later.
 */
async function readSharedV2CapsForOwner(
  packageId: string,
  owner: string
): Promise<SharedCapRow[]> {
  const client = sui();
  const out: SharedCapRow[] = [];
  const seen = new Set<string>();

  let cursor: string | null = null;
  let scanned = 0;
  while (scanned < MAX_EVENTS_SCAN) {
    let page: GraphQLEventsByTypeResponse;
    try {
      page = await gql<GraphQLEventsByTypeResponse>(EVENTS_BY_TYPE_QUERY, {
        type: `${packageId}::auto_swap::CapUpgradedToV2`,
        first: 50,
        after: cursor,
      });
    } catch {
      // Pre-v7 deploys won't have the event type registered. Bail.
      break;
    }
    if (!page.events) break;

    for (const ev of page.events.nodes ?? []) {
      scanned++;
      const p = (ev.contents?.json ?? {}) as {
        new_cap_id?: string;
        owner?: string;
      };
      if (p.owner !== owner) continue;
      const capId = p.new_cap_id;
      if (!capId || seen.has(capId)) continue;
      seen.add(capId);

      try {
        const obj = await client.getObject({
          objectId: capId,
          include: { json: true },
        });
        const d = obj.object;
        if (!d) continue;
        if (d.owner?.$kind !== "Shared") continue;

        const t = d.type;
        if (!t || !t.startsWith(`${packageId}::auto_swap::AutoSwapCapV2<`)) {
          continue;
        }
        const inner = extractCapInnerType(t);
        if (!inner) continue;

        const fields = extractCapFields(d.json);
        out.push({
          id: capId,
          sourceType: inner,
          maxPerSwap: fields.max_per_swap,
          expiresAtMs: fields.expires_at_ms,
          paused: fields.paused,
          isV1: false,
        });
      } catch {
        // Burned, schema-skewed, or transient RPC error — skip silently.
      }
    }
    if (!page.events.pageInfo.hasNextPage) break;
    cursor = page.events.pageInfo.endCursor;
    if (!cursor) break;
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
  // Sui GraphQL `ObjectFilter.type` matches against the canonical struct
  // tag. Passing `…::auto_swap::AutoSwapCap` would *not* reliably catch
  // `AutoSwapCapV2` (different struct name), so we fetch both prefixes
  // and merge. v1 page also fetches the vault contents in the same hit.
  const capTypeV1 = `${packageId}::auto_swap::AutoSwapCap`;
  const capTypeV2 = `${packageId}::auto_swap::AutoSwapCapV2`;

  // ──────────────────────────────────────────────────────────────
  // 1. Single GraphQL hit: vault contents + owned v1 caps. The v2
  // caps come from a second query just below (couldn't compose into a
  // single one without bloating the shared query module).
  let vault: State["vault"] = null;
  const caps: Cap[] = [];

  let bagId: string | undefined;
  let initialCapPage: GraphQLVaultAndCapsResponse["owner"] | null = null;
  try {
    const data = await gql<GraphQLVaultAndCapsResponse>(VAULT_AND_CAPS_QUERY, {
      vaultId, // may be null — GraphQL accepts a null SuiAddress and skips
      owner: user.sui_address,
      capType: capTypeV1,
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
  // 3. v1 Caps — continue paginating if the first page hit the cursor.
  // Every cap surfaced here is `AutoSwapCap<T>` (v1, pre-v7 shape).
  // v1 caps lack a per-day throttle, so we flag `isV1: true` to drive
  // the iOS "Upgrade to per-day protection" banner. They are also
  // user-owned (the GraphQL filter only returns AddressOwner), so
  // `needsMigration: true` still applies for the v2→v3 share step on
  // legacy deploys — but in practice the v7 upgrade subsumes that
  // (the v1→v2 entry mints a SHARED cap directly).
  if (initialCapPage) {
    const pushV1FromPage = (
      page: NonNullable<GraphQLVaultAndCapsResponse["owner"]>
    ) => {
      for (const node of page.objects.nodes ?? []) {
        if (!node.contents) continue;
        const repr = node.contents.type.repr;
        // Defensive: GraphQL `type:` filter is supposed to scope to the
        // exact struct name, but if a future SDK change loosens that to
        // a prefix we'd accidentally pull in `AutoSwapCapV2` here.
        // Reject anything that isn't the literal v1 struct prefix.
        if (!repr.startsWith(`${packageId}::auto_swap::AutoSwapCap<`)) continue;
        const inner = extractCapInnerType(repr);
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
          isV1: true,
        });
      }
    };
    pushV1FromPage(initialCapPage);

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
            capType: capTypeV1,
            first: 50,
            afterObj: cursor,
          }
        );
        if (!data.owner) break;
        pushV1FromPage(data.owner);
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
  // 3b. v2 owned caps. The v7 `upgrade_cap_to_v2` entry shares the
  // freshly-minted cap, so an AddressOwner-filtered query won't surface
  // those — but `enable_auto_swap_v2` (future) could mint user-owned
  // ones, and on testnets we want both flows to render. We still query
  // the AddressOwner objects for `AutoSwapCapV2<T>` to cover both
  // shapes; shared v2 caps come in via the event-walk pass below.
  try {
    let cursorV2: string | null = null;
    do {
      const data: GraphQLVaultAndCapsResponse = await gql<GraphQLVaultAndCapsResponse>(
        VAULT_AND_CAPS_QUERY,
        {
          vaultId: null,
          owner: user.sui_address,
          capType: capTypeV2,
          first: 50,
          afterObj: cursorV2,
        }
      );
      if (!data.owner) break;
      for (const node of data.owner.objects.nodes ?? []) {
        if (!node.contents) continue;
        const repr = node.contents.type.repr;
        if (!repr.startsWith(`${packageId}::auto_swap::AutoSwapCapV2<`)) continue;
        const inner = extractCapInnerType(repr);
        if (!inner) continue;
        const fields = extractCapFields(node.contents.json);
        caps.push({
          id: node.address,
          sourceType: inner,
          maxPerSwap: fields.max_per_swap,
          expiresAtMs: fields.expires_at_ms,
          paused: fields.paused,
          // v2 caps are the post-upgrade shape — no further migration.
          needsMigration: false,
          isV1: false,
        });
      }
      cursorV2 = data.owner.objects.pageInfo.hasNextPage
        ? data.owner.objects.pageInfo.endCursor
        : null;
    } while (cursorV2);
  } catch (err) {
    console.warn(
      `[vault/state] GraphQL v2 cap read failed: ${(err as Error).message}`
    );
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
        isV1: sc.isV1,
      });
    }
  } catch (err) {
    console.warn(
      `[vault/state] shared-cap event scan failed: ${(err as Error).message}`
    );
    // Non-fatal — user-owned caps still surface above.
  }

  // ──────────────────────────────────────────────────────────────
  // 4b. Shared v2 caps — invisible to the AddressOwner GraphQL query.
  // Walk `CapUpgradedToV2` events filtered by owner, then getObject the
  // `new_cap_id` and keep only those still Shared. Bails early on
  // pre-v7 deploys (event type unknown), so this is a no-op there.
  try {
    const sharedV2 = await readSharedV2CapsForOwner(packageId, user.sui_address);
    const haveIds = new Set(caps.map((c) => c.id));
    // After a successful upgrade the corresponding v1 cap is BURNED on
    // chain. We don't need explicit de-dupe between v1 and v2 ids —
    // they're distinct object ids by construction.
    for (const sc of sharedV2) {
      if (haveIds.has(sc.id)) continue;
      caps.push({
        id: sc.id,
        sourceType: sc.sourceType,
        maxPerSwap: sc.maxPerSwap,
        expiresAtMs: sc.expiresAtMs,
        paused: sc.paused,
        needsMigration: false,
        isV1: false,
      });
    }
  } catch (err) {
    console.warn(
      `[vault/state] shared v2-cap event scan failed: ${(err as Error).message}`
    );
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
