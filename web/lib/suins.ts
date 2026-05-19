import "server-only";

import { userByTaliseUsername } from "./db";
import { formatHandle, isHexAddress, normalizeHandle } from "./handle";
import { shortAddress } from "./format";

/**
 * Recipient resolver.
 *
 * Today: DB lookup against `users.talise_username`. Anyone who has claimed a
 * username can be paid by their handle. This is the only resolution path.
 *
 * TODO(suins): When `talise.sui` is registered with the parent name owned by
 * the operator, swap the DB lookup for a SuiNS resolver call.
 *   import { SuinsClient } from "@mysten/suins";
 *   const suins = new SuinsClient({ client: suiClient, network: "mainnet" });
 *   const record = await suins.getNameRecord(`${username}.talise.sui`);
 *   if (record?.targetAddress) return { address, displayName };
 * That single function body change is the entire migration — every caller
 * stays the same.
 */

export type Resolved = { address: string; displayName: string };

/**
 * Resolve any of:
 *  - bare username `sele`
 *  - user-facing `sele@talise`
 *  - SuiNS canonical `sele.talise.sui`
 *  - raw hex `0x...64-hex`
 *
 * Returns null if the input doesn't match any of those, or if the username
 * exists in no row.
 */
export async function resolveRecipient(input: string): Promise<Resolved | null> {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (isHexAddress(trimmed)) {
    return { address: trimmed, displayName: shortAddress(trimmed, 4, 4) };
  }

  const username = normalizeHandle(trimmed);
  if (!username) return null;

  const user = await userByTaliseUsername(username);
  if (!user) return null;

  return {
    address: user.sui_address,
    displayName: formatHandle(username),
  };
}
