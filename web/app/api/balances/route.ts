import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import {
  getSuiBalance,
  getUsdsuiBalance,
  USDSUI_DECIMALS,
  USDSUI_TYPE,
} from "@/lib/sui";
import { getSuiUsdcPrice } from "@/lib/deepbook";
import { memoTtl } from "@/lib/perf-cache";
import {
  gql,
  BAG_DYNAMIC_FIELDS_QUERY,
  decodeBagKeyVectorU8,
  type GraphQLBagDynamicFieldsResponse,
  type GraphQLVaultAndCapsResponse,
  VAULT_AND_CAPS_QUERY,
} from "@/lib/sui-graphql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SUI/USD spot is a global value — every user sees the same number, so
 * cache it process-wide. DeepBook level-2 quotes cost 800-2000ms; serving
 * a 45s-old price is fine for a balance display (the headline number is
 * USDsui anyway, and the SUI side is sweep-banner UX). With this cache,
 * the price slot effectively never trips the 600ms timeout below.
 */
const PRICE_CACHE_TTL_MS = 45_000;
function cachedSuiUsdcPrice(): Promise<number> {
  return memoTtl("sui-usdc-price", PRICE_CACHE_TTL_MS, () =>
    getSuiUsdcPrice().catch(() => 0)
  );
}

// ───────────────────────────────────────────────────────────────────
// Vault contents fold-in
//
// The auto-swap vault sits on a shared `TaliseVault` Move object whose
// `balances` field is a `Bag<vector<u8>, Balance<T>>`. Coin types written
// by Move's `type_name::get<T>()` arrive in the FULL canonical form
//   "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
// (no `0x`, address left-padded to 64 hex chars). Wallet RPC calls — and
// our `USDSUI_TYPE` constant — use the SHORT form
//   "0x44f838…::usdsui::USDSUI"
// So we canonicalize both sides before comparing. We keep the SHORT form
// (matches `USDSUI_TYPE`, `0x2::sui::SUI`, the Sui SDK default, and what
// the iOS app would see if it ever asked for the breakdown — which it
// currently doesn't, but the response shape stays consistent).

/**
 * Normalize a Move type tag to short form: lowercase, drop the `0x`
 * prefix on the address half, strip leading zeros (keeping one), then
 * re-add `0x`. `<addr>::module::Name` shape only — anything else returns
 * unchanged.
 */
function canonicalizeTypeTag(t: string): string {
  const idx = t.indexOf("::");
  if (idx < 0) return t;
  let addr = t.slice(0, idx);
  const tail = t.slice(idx);
  if (addr.startsWith("0x") || addr.startsWith("0X")) addr = addr.slice(2);
  addr = addr.toLowerCase().replace(/^0+/, "") || "0";
  return `0x${addr}${tail}`;
}

const SUI_TYPE_SHORT = "0x2::sui::SUI";
const USDSUI_TYPE_SHORT = canonicalizeTypeTag(USDSUI_TYPE);

/** Sum of vault Balance<T> entries scaled into wallet-equivalent units. */
type VaultTotals = {
  /** Vault contribution to the `usdsui` field (human-scaled). */
  usdsui: number;
  /** Vault contribution to the `sui` field (human-scaled). */
  sui: number;
};

/** Extract the bag UID from the vault Move struct's `contents.json`. */
function extractBagId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const balances = (json as { balances?: unknown }).balances;
  if (!balances || typeof balances !== "object") return undefined;
  const id = (balances as { id?: unknown }).id;
  if (!id || typeof id !== "object") return undefined;
  const inner = (id as { id?: unknown }).id;
  return typeof inner === "string" ? inner : undefined;
}

/** Pull the u64 `value` out of a Balance<T>'s json (string or number). */
function extractBalanceValue(json: unknown): bigint {
  if (!json || typeof json !== "object") return 0n;
  const v = (json as { value?: unknown }).value;
  try {
    if (typeof v === "string") return BigInt(v);
    if (typeof v === "number") return BigInt(v);
  } catch {
    /* fall through */
  }
  return 0n;
}

/**
 * Read the vault's Bag<vector<u8>, Balance<T>> and fold SUI/USDsui
 * entries into wallet-equivalent totals. Other coin types are ignored
 * for `totalUsd` because the wallet path doesn't price arbitrary coins
 * either — keeping symmetry.
 *
 * 10s memo matches `/api/vault/state` (the bag is also re-read there;
 * underlying GraphQL responses share a process-wide cache anyway, so
 * a hit here usually doesn't even hit the wire).
 */
async function readVaultTotals(vaultId: string): Promise<VaultTotals> {
  return memoTtl(`vault-balances:${vaultId}`, 10_000, async () => {
    const totals: VaultTotals = { usdsui: 0, sui: 0 };

    // Step 1 — vault contents to discover the bag UID. Reuses the
    // existing query so the GraphQL cache is shared with /api/vault/state.
    const headData = await gql<GraphQLVaultAndCapsResponse>(
      VAULT_AND_CAPS_QUERY,
      {
        vaultId,
        // owner / capType are required by the schema but irrelevant here;
        // pass the vault id as owner (a benign SuiAddress) and a type-
        // prefix that yields zero matches. The owner branch is dropped.
        owner: vaultId,
        capType: "0x0::__balances_route_unused__::Sentinel",
        first: 1,
        afterObj: null,
      }
    );
    const bagId = extractBagId(headData.vault?.asMoveObject?.contents?.json);
    if (!bagId) return totals;

    // Step 2 — walk the bag's dynamic fields, fold matching coin types.
    let cursor: string | null = null;
    do {
      const data: GraphQLBagDynamicFieldsResponse =
        await gql<GraphQLBagDynamicFieldsResponse>(BAG_DYNAMIC_FIELDS_QUERY, {
          bagId,
          first: 50,
          after: cursor,
        });
      const conn = data.address?.dynamicFields;
      if (!conn) break;
      for (const node of conn.nodes ?? []) {
        const rawType = decodeBagKeyVectorU8(node.name.json);
        if (!rawType) continue;
        const coinType = canonicalizeTypeTag(rawType);
        let amount = 0n;
        if (node.value && node.value.__typename === "MoveValue") {
          amount = extractBalanceValue(node.value.json);
        } else if (node.value && node.value.__typename === "MoveObject") {
          amount = extractBalanceValue(node.value.contents?.json);
        }
        if (amount === 0n) continue;
        if (coinType === USDSUI_TYPE_SHORT) {
          totals.usdsui += Number(amount) / Math.pow(10, USDSUI_DECIMALS);
        } else if (coinType === SUI_TYPE_SHORT) {
          totals.sui += Number(amount) / 1e9;
        }
        // Other types: no wallet-side conversion path, so they don't
        // contribute to `totalUsd`. The cron sweeps them into USDsui
        // before they linger long enough to matter.
      }
      cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (cursor);

    return totals;
  });
}

/**
 * GET /api/balances — wallet + vault balance snapshot for the authed user.
 *
 * Critical path is USDsui (the only unit iOS displays). SUI balance +
 * spot price are returned alongside but populated in the background —
 * the sweep banner / future flows use them, but they shouldn't gate
 * the headline number.
 *
 * Latency profile on mainnet (measured):
 *   getUsdsuiBalance:   ~600-1800ms (one sui_getBalance call)
 *   getSuiBalance:      ~400-800ms  (one sui_getBalance call)
 *   getSuiUsdcPrice:    ~800-2000ms (DeepBook level-2 quote)
 *   readVaultTotals:    ~300-800ms  (2 GraphQL hits, 10s memo)
 *
 * The vault read runs alongside the wallet reads. If the vault read
 * fails for any reason we log and return wallet-only totals — a vault
 * hiccup should never 500 the headline-balance endpoint.
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

  // Critical: USDsui — the headline number. Wait for this.
  const usdsuiPromise = getUsdsuiBalance(user.sui_address).catch(() => ({
    usdsui: 0,
    raw: "0",
  }));

  // Best-effort: SUI balance + spot price for the sweep banner. Capped
  // at 600ms so a slow DeepBook quote doesn't block the response.
  const suiPromise = withTimeout(
    getSuiBalance(user.sui_address).catch(() => ({ sui: 0, mist: "0" })),
    600,
    { sui: 0, mist: "0" }
  );
  // Price is cached process-wide for 45s. The cached path returns in <1ms;
  // the cold path still respects the 600ms cap so a slow DeepBook quote
  // can't drag the response down.
  const pricePromise = withTimeout(
    cachedSuiUsdcPrice(),
    600,
    0
  );

  // Vault fold-in. Capped at 800ms so an unusually slow GraphQL fetch
  // doesn't drag the response down on the cold path; warm hits (10s
  // memo) resolve in <1ms.
  const vaultId = user.talise_vault_id ?? null;
  const vaultPromise: Promise<VaultTotals> = vaultId
    ? withTimeout(
        readVaultTotals(vaultId).catch((err: unknown) => {
          // Resilience: never let a vault-read failure poison the
          // wallet snapshot. Caller still gets the wallet number.
          console.warn(
            `[balances] vault fold-in failed for ${vaultId}: ${
              (err as Error)?.message ?? String(err)
            }`
          );
          return { usdsui: 0, sui: 0 };
        }),
        800,
        { usdsui: 0, sui: 0 }
      )
    : Promise.resolve({ usdsui: 0, sui: 0 });

  const usdsui = await usdsuiPromise;
  const [sui, suiPrice, vault] = await Promise.all([
    suiPromise,
    pricePromise,
    vaultPromise,
  ]);

  // Fold vault contributions into the wallet-shaped fields. iOS reads
  // these strictly; the response schema is unchanged.
  const combinedUsdsui = usdsui.usdsui + vault.usdsui;
  const combinedSui = sui.sui + vault.sui;
  const totalUsd = combinedUsdsui + combinedSui * (suiPrice || 0);

  // Edge cache: serve repeat hits within 3s from Vercel's CDN. Kept
  // below the 1.5s optimistic-tx reconcile (see HomeView.applyOptimisticTx)
  // so a post-send refresh sees fresh on-chain state. `private` keeps the
  // response from being shared across users — the body is per-user.
  return NextResponse.json(
    {
      address: user.sui_address,
      usdsui: combinedUsdsui,
      sui: combinedSui,
      suiPriceUsd: suiPrice,
      totalUsd,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=0, s-maxage=3, stale-while-revalidate=15",
      },
    }
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
