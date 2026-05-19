import "server-only";

import { formatHandle, isHexAddress, normalizeHandle } from "./handle";
import { shortAddress } from "./format";
import { suins } from "./suins-operator";

/**
 * Recipient resolver. **On-chain SuiNS is the source of truth.**
 *
 * No DB lookup. A `name@talise` handle either has an on-chain SuiNS record
 * (the user holds `name.talise.sui` as an NFT and a target address is set)
 * or it doesn't resolve. Same surface every other Sui wallet sees.
 *
 * Hex addresses bypass SuiNS entirely.
 */

export type Resolved = { address: string; displayName: string };

export async function resolveRecipient(input: string): Promise<Resolved | null> {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (isHexAddress(trimmed)) {
    return { address: trimmed, displayName: shortAddress(trimmed, 4, 4) };
  }

  const username = normalizeHandle(trimmed);
  if (!username) return null;

  try {
    const record = await suins().getNameRecord(`${username}.talise.sui`);
    if (record?.targetAddress) {
      return {
        address: record.targetAddress,
        displayName: formatHandle(username),
      };
    }
  } catch {
    // RPC hiccup — let the caller surface "couldn't resolve" rather than guess.
  }
  return null;
}
