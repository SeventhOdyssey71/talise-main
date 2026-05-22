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
  // We do TWO passes: first collect every `*.talise.sui` SubDomain NFT
  // the user owns, then verify each via SuinsClient.getNameRecord and
  // only surface one whose targetAddress is set.
  //
  // Why: early mints (and any mint where `setTargetAddress` failed) leave
  // a SubDomainRegistration NFT in the wallet with a null SuiNS target.
  // The previous version returned the *first owned* NFT regardless of
  // whether the name actually resolved on chain — which made Home show
  // "alice@talise.sui" but Send return "couldn't find" for the same
  // name. We refuse to surface broken handles so Home shows the
  // "Claim your name" CTA and the user can re-claim cleanly.
  const owned: OwnedSubname[] = [];
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
        // Subdomain NFTs are the only SuiNS objects that resolve via
        // SubDomainRegistration; the main suins_registration is the parent.
        if (!/subdomain_registration::SubDomainRegistration/.test(t)) continue;
        const name = o.data?.display?.data?.name ?? "";
        if (!name.endsWith(PARENT_SUFFIX)) continue;
        owned.push({
          username: name.slice(0, -PARENT_SUFFIX.length),
          fullName: name,
          nftId: o.data?.objectId ?? "",
        });
      }

      if (!r.hasNextPage || !r.nextCursor) break;
      cursor = r.nextCursor;
    }
  } catch {
    return null;
  }

  if (owned.length === 0) return null;

  // Pass 2: verify each name actually resolves on chain. The first one
  // whose SuiNS NameRecord has a non-null targetAddress wins. If every
  // owned NFT has a null target (early mints, partial mints), we return
  // null so the UI prompts the user to claim a new one rather than
  // surfacing a name Send can't resolve.
  try {
    const { SuinsClient } = await import("@mysten/suins");
    const suins = new SuinsClient({
      client: client() as never,
      network: "mainnet",
    });
    for (const cand of owned) {
      try {
        const rec = await suins.getNameRecord(cand.fullName);
        if (rec?.targetAddress) return cand;
      } catch {
        // "Object does not exist" / RPC hiccup — keep trying others.
      }
    }
  } catch {
    // SuinsClient init failed (rare) — be conservative and report none
    // rather than risk surfacing a non-resolvable handle.
  }
  return null;
}
