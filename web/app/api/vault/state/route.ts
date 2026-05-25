import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { sui } from "@/lib/sui";
import { vaultPackageIds, VaultNotDeployedError } from "@/lib/vault";

export const runtime = "nodejs";

/**
 * GET /api/vault/state
 *
 * Returns the user's vault contents + active auto-swap caps. Cached
 * per-user for ~10s because these reads spawn 3+ JSON-RPC roundtrips
 * (vault object, bag dynamic-fields, every cap object).
 *
 * Shape:
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
};
type State = {
  vault: { id: string; balances: Balance[] } | null;
  caps: Cap[];
};

const CACHE_TTL_MS = 10_000;
const cache = new Map<number, { at: number; state: State }>();

export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  // Cache hit — short-circuit before hitting RPC.
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.state);
  }

  let packageId: string;
  try {
    ({ packageId } = vaultPackageIds());
  } catch (err) {
    if (err instanceof VaultNotDeployedError) {
      return NextResponse.json(
        { error: "auto-swap package not yet deployed" },
        { status: 503 }
      );
    }
    throw err;
  }

  const client = sui();
  const vaultId = user.talise_vault_id ?? null;

  // ──────────────────────────────────────────────────────────────
  // 1. Vault balances. The vault stores `Balance<T>` inside a Bag —
  //    keyed by the UTF-8 bytes of the type name. We discover the
  //    held types by listing the bag's dynamic fields.
  let vault: State["vault"] = null;
  if (vaultId) {
    try {
      const vObj = await client.getObject({
        id: vaultId,
        options: { showContent: true },
      });
      // The Bag is a field on the vault struct. Move's `bag::new` returns
      // a `Bag` which itself wraps a UID — that wrapped UID is what we
      // pass to `getDynamicFields`. The exposed shape is
      //   { fields: { balances: { fields: { id: { id: "0x..." }, size: N } } } }
      const content = vObj.data?.content;
      let bagId: string | undefined;
      if (content && content.dataType === "moveObject") {
        const fields = (content as unknown as {
          fields?: {
            balances?: { fields?: { id?: { id?: string } } };
          };
        }).fields;
        bagId = fields?.balances?.fields?.id?.id;
      }

      const balances: Balance[] = [];
      if (bagId) {
        // Page through every dynamic field on the bag. With Sui's max
        // page size (~50) and typical Talise users holding a handful of
        // coin types, this is one round-trip in the common case.
        let cursor: string | null | undefined = null;
        do {
          // SuiJsonRpcClient.getDynamicFields exists but isn't strongly
          // typed for our pinned version — cast through unknown.
          const page = (await (
            client as unknown as {
              getDynamicFields: (args: {
                parentId: string;
                cursor?: string | null;
              }) => Promise<{
                data: Array<{
                  name: { type: string; value: unknown };
                  objectId: string;
                }>;
                nextCursor: string | null;
                hasNextPage: boolean;
              }>;
            }
          ).getDynamicFields({ parentId: bagId, cursor })) as {
            data: Array<{
              name: { type: string; value: unknown };
              objectId: string;
            }>;
            nextCursor: string | null;
            hasNextPage: boolean;
          };

          for (const f of page.data) {
            // `f.name.value` is the bag key — a vector<u8> rendered as
            // a byte array of the UTF-8 type-name string. Decode it.
            const bytes = f.name.value;
            let coinType = "";
            if (Array.isArray(bytes)) {
              coinType = String.fromCharCode(
                ...(bytes as number[]).filter((n) => typeof n === "number")
              );
            } else if (typeof bytes === "string") {
              coinType = bytes;
            }

            // Read the field object to extract the inner Balance<T>'s value.
            try {
              const fo = await client.getObject({
                id: f.objectId,
                options: { showContent: true },
              });
              const fcontent = fo.data?.content;
              let amount = "0";
              if (fcontent && fcontent.dataType === "moveObject") {
                // Dynamic field layout: `{ id, name, value: { value: <u64> } }`
                // where `value` here is a Balance<T> with a single `value` u64.
                const v = (fcontent as unknown as {
                  fields?: {
                    value?: { fields?: { value?: string | number } } | string | number;
                  };
                }).fields?.value;
                if (typeof v === "object" && v !== null && "fields" in v) {
                  amount = String((v as { fields?: { value?: string | number } }).fields?.value ?? "0");
                } else if (typeof v === "string" || typeof v === "number") {
                  amount = String(v);
                }
              }
              balances.push({ coinType, amount });
            } catch {
              /* skip unreadable fields */
            }
          }
          cursor = page.hasNextPage ? page.nextCursor : null;
        } while (cursor);
      }

      vault = { id: vaultId, balances };
    } catch (err) {
      console.warn(
        `[vault/state] failed to read vault ${vaultId}: ${(err as Error).message}`
      );
      // Surface a vault-known-but-unreadable state rather than 500'ing —
      // the UI can still render management controls.
      vault = { id: vaultId, balances: [] };
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 2. AutoSwapCaps. Each one is a user-owned object of type
  //    `<package>::auto_swap::AutoSwapCap<T>`. We can't filter by the
  //    generic Move type prefix in a single `getOwnedObjects` call, so
  //    we page everything the user owns and filter client-side. For
  //    Talise users this is a tractable list (typically <50 objects).
  const caps: Cap[] = [];
  try {
    const capTypePrefix = `${packageId}::auto_swap::AutoSwapCap<`;
    let cursor: string | null | undefined = null;
    do {
      const page = await client.getOwnedObjects({
        owner: user.sui_address,
        options: { showType: true, showContent: true },
        cursor,
      });
      for (const item of page.data ?? []) {
        const t = item.data?.type;
        if (!t || !t.startsWith(capTypePrefix)) continue;
        // Extract the generic — everything between the first `<` and
        // the matching closing `>`. This is depth-safe for nested
        // generics like `Coin<USDC<X>>` because the cap itself has
        // exactly one type param.
        const inner = t.slice(capTypePrefix.length, -1);
        const content = item.data?.content;
        if (!content || content.dataType !== "moveObject") continue;
        const fields = (content as unknown as {
          fields?: {
            max_per_swap?: string | number;
            expires_at_ms?: string | number;
            paused?: boolean;
          };
        }).fields ?? {};
        caps.push({
          id: item.data!.objectId,
          sourceType: inner,
          maxPerSwap: String(fields.max_per_swap ?? "0"),
          expiresAtMs: String(fields.expires_at_ms ?? "0"),
          paused: Boolean(fields.paused),
        });
      }
      cursor = page.hasNextPage ? page.nextCursor : null;
    } while (cursor);
  } catch (err) {
    console.warn(
      `[vault/state] failed to list caps for ${user.sui_address}: ${(err as Error).message}`
    );
    // Empty caps array is fine — frontend handles it gracefully.
  }

  const state: State = { vault, caps };
  cache.set(userId, { at: Date.now(), state });
  return NextResponse.json(state);
}
