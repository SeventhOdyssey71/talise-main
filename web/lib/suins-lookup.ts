import "server-only";

import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
} from "@mysten/sui/jsonRpc";

/**
 * Reverse SuiNS lookup — given a Sui address, find any `*.talise.sui`
 * subname NFTs that address owns. Pure on-chain; no DB.
 *
 * We page the user's owned objects, filter for any whose `display.name`
 * field ends with `.talise.sui`, and return the first match. This
 * deliberately doesn't hardcode the SubDomainRegistration package id —
 * SuiNS has shipped multiple subdomain packages over time and the type
 * can vary. The `display.name` is set by the SuiNS Move package's
 * display metadata and is stable across versions.
 *
 * Future: if the user holds multiple `*.talise.sui` names, a "set primary"
 * UI can let them pick which to display. For v1, we return the first.
 */

const PARENT_SUFFIX = ".talise.sui";

let _client: SuiJsonRpcClient | null = null;
function client(): SuiJsonRpcClient {
  if (_client) return _client;
  _client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl("mainnet"),
    network: "mainnet",
  });
  return _client;
}

export type OwnedSubname = {
  /** Bare username, no parent suffix: e.g. "sele". */
  username: string;
  /** SuiNS canonical: e.g. "sele.talise.sui". */
  fullName: string;
  /** Object id of the subname NFT. */
  nftId: string;
};

/**
 * Return EVERY `*.talise.sui` NFT the owner holds, together with the address
 * the SuiNS resolver currently points the name to. Used by the "fix
 * resolution" flow: when a subname was minted before we wired
 * `setTargetAddress` into the mint PTB, the NFT exists but has a null
 * target — these are surfaced here so the user can repair them in one tap.
 */
export type OwnedSubnameWithTarget = OwnedSubname & {
  targetAddress: string | null;
};

export async function findAllTaliseSubnamesForOwner(
  owner: string
): Promise<OwnedSubnameWithTarget[]> {
  const all: OwnedSubname[] = [];
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const r: {
        data?: Array<{
          data?: {
            objectId?: string;
            type?: string;
            display?: { data?: Record<string, string> } | null;
          };
        }>;
        nextCursor?: string | null;
        hasNextPage?: boolean;
      } = await (client() as unknown as {
        getOwnedObjects: (args: unknown) => Promise<{
          data?: Array<{
            data?: {
              objectId?: string;
              type?: string;
              display?: { data?: Record<string, string> } | null;
            };
          }>;
          nextCursor?: string | null;
          hasNextPage?: boolean;
        }>;
      }).getOwnedObjects({
        owner,
        options: { showType: true, showDisplay: true },
        cursor,
      });
      for (const o of r.data ?? []) {
        const t = o.data?.type ?? "";
        if (!/subdomain_registration::SubDomainRegistration/.test(t)) continue;
        const name = o.data?.display?.data?.name ?? "";
        if (!name.endsWith(PARENT_SUFFIX)) continue;
        all.push({
          username: name.slice(0, -PARENT_SUFFIX.length),
          fullName: name,
          nftId: o.data?.objectId ?? "",
        });
      }
      if (!r.hasNextPage || !r.nextCursor) break;
      cursor = r.nextCursor;
    }

    // Resolve each name's target address. Stale ones come back as null.
    // Lazy-load @mysten/suins so the cost is paid only when this list is non-empty.
    if (all.length === 0) return [];
    const { SuinsClient } = await import("@mysten/suins");
    const suins = new SuinsClient({
      client: client() as never,
      network: "mainnet",
    });
    const out: OwnedSubnameWithTarget[] = [];
    for (const s of all) {
      try {
        const rec = await suins.getNameRecord(s.fullName);
        out.push({ ...s, targetAddress: rec?.targetAddress ?? null });
      } catch {
        out.push({ ...s, targetAddress: null });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function findTaliseSubnameForOwner(
  owner: string
): Promise<OwnedSubname | null> {
  try {
    // Page through owned objects. 50 per page is usually enough for one
    // wallet; if a power user holds more we'd add pagination, but the very
    // first matching subname wins, so an early break keeps it cheap.
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const r: {
        data?: Array<{
          data?: {
            objectId?: string;
            type?: string;
            display?: { data?: Record<string, string> } | null;
          };
        }>;
        nextCursor?: string | null;
        hasNextPage?: boolean;
      } = await (client() as unknown as {
        getOwnedObjects: (args: unknown) => Promise<{
          data?: Array<{
            data?: {
              objectId?: string;
              type?: string;
              display?: { data?: Record<string, string> } | null;
            };
          }>;
          nextCursor?: string | null;
          hasNextPage?: boolean;
        }>;
      }).getOwnedObjects({
        owner,
        options: { showType: true, showDisplay: true },
        cursor,
      });

      for (const o of r.data ?? []) {
        const t = o.data?.type ?? "";
        // Subdomain NFTs are the only SuiNS objects that resolve via
        // SubDomainRegistration; the main suins_registration is the parent.
        if (!/subdomain_registration::SubDomainRegistration/.test(t)) continue;
        const name = o.data?.display?.data?.name ?? "";
        if (!name.endsWith(PARENT_SUFFIX)) continue;
        const username = name.slice(0, -PARENT_SUFFIX.length);
        return {
          username,
          fullName: name,
          nftId: o.data?.objectId ?? "",
        };
      }

      if (!r.hasNextPage || !r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return null;
  } catch {
    return null;
  }
}
