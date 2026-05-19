import "server-only";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
} from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { SuinsClient, SuinsTransaction } from "@mysten/suins";

/**
 * SuiNS operator — server-side helper that owns the `talise.sui` parent name
 * and mints `name.talise.sui` subname NFTs for users on claim.
 *
 * Flow per claim:
 *   1. User taps "Claim sele" at /claim.
 *   2. Server validates input + writes the username row (race-safe via UNIQUE).
 *   3. Server calls `mintSubname({ username, userAddress })`:
 *      - Builds a `SuinsTransaction.createSubName(...)` PTB
 *      - Transfers the resulting NFT to the user's Sui address
 *      - Signs with the operator key (pays its own gas)
 *      - Submits to mainnet
 *   4. The user's wallet now contains `sele.talise.sui` as a transferable
 *      NFT, and every SuiNS resolver (suivision, suiscan, every wallet)
 *      sees it.
 *
 * If the on-chain mint fails, the claim route rolls back the DB row so DB
 * state stays consistent with chain state.
 */

const PACKAGE_NETWORK = "mainnet" as const;

let _operator: Ed25519Keypair | null = null;
let _client: SuiJsonRpcClient | null = null;
let _suins: SuinsClient | null = null;

function operator(): Ed25519Keypair {
  if (_operator) return _operator;
  const k = process.env.TALISE_SUINS_OPERATOR_KEY;
  if (!k) {
    throw new Error(
      "TALISE_SUINS_OPERATOR_KEY missing — the operator wallet that holds talise.sui"
    );
  }
  _operator = Ed25519Keypair.fromSecretKey(k);
  return _operator;
}

function sui(): SuiJsonRpcClient {
  if (_client) return _client;
  _client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(PACKAGE_NETWORK),
    network: PACKAGE_NETWORK,
  });
  return _client;
}

export function suins(): SuinsClient {
  if (_suins) return _suins;
  _suins = new SuinsClient({
    client: sui() as never,
    network: PACKAGE_NETWORK,
  });
  return _suins;
}

export function suinsOperatorEnabled(): boolean {
  return (
    !!process.env.TALISE_SUINS_OPERATOR_KEY &&
    !!process.env.TALISE_SUI_NFT_ID &&
    !!process.env.TALISE_SUI_EXPIRY_MS
  );
}

export function suinsOperatorAddress(): string {
  return operator().getPublicKey().toSuiAddress();
}

/**
 * Mint `<username>.talise.sui` as a transferable NFT and send it to
 * `userAddress`. Returns the tx digest + the new subname NFT object id.
 *
 * Bare username (e.g. "sele"), no `.talise.sui` suffix — the SuiNS SDK
 * appends the parent's labels under the hood.
 */
export async function mintSubname(opts: {
  username: string;
  userAddress: string;
}): Promise<{ digest: string; subnameNftId: string | null }> {
  const parentNftId = process.env.TALISE_SUI_NFT_ID;
  const parentExpiryMs = Number(process.env.TALISE_SUI_EXPIRY_MS);
  if (!parentNftId) throw new Error("TALISE_SUI_NFT_ID missing");
  if (!Number.isFinite(parentExpiryMs) || parentExpiryMs <= Date.now()) {
    throw new Error(
      `TALISE_SUI_EXPIRY_MS invalid or expired (got ${process.env.TALISE_SUI_EXPIRY_MS})`
    );
  }

  const tx = new Transaction();
  const suinsTx = new SuinsTransaction(suins(), tx);

  const nft = suinsTx.createSubName({
    parentNft: parentNftId,
    name: `${opts.username}.talise.sui`,
    expirationTimestampMs: parentExpiryMs,
    allowChildCreation: false,
    allowTimeExtension: false,
  });

  // Bind the subname to the user's address so `getNameRecord` resolves.
  // Without this, the SuiNS dynamic field exists but `targetAddress` is
  // null — the name is "taken" but resolves to nothing. The operator can
  // sign for this call while it still holds the NFT (before the transfer
  // below in the same PTB).
  suinsTx.setTargetAddress({
    nft,
    address: opts.userAddress,
    isSubname: true,
  });

  tx.transferObjects([nft], opts.userAddress);

  const kp = operator();
  tx.setSender(kp.getPublicKey().toSuiAddress());

  const client = sui();
  const bytes = await tx.build({ client: client as never });
  const { signature } = await kp.signTransaction(bytes);

  const result = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature,
    options: { showEffects: true, showObjectChanges: true },
  });

  if (result.effects?.status?.status !== "success") {
    const reason = result.effects?.status?.error ?? "unknown failure";
    throw new Error(`subname mint failed: ${reason}`);
  }

  // The created NFT is the SubDomainRegistration / SuinsRegistration object
  // owned by the user. Extract its id from the object changes.
  let subnameNftId: string | null = null;
  for (const ch of result.objectChanges ?? []) {
    const c = ch as { type?: string; objectType?: string; objectId?: string };
    if (
      c.type === "created" &&
      c.objectId &&
      /SubDomainRegistration|SuinsRegistration/.test(c.objectType ?? "")
    ) {
      subnameNftId = c.objectId;
      break;
    }
  }

  return { digest: result.digest, subnameNftId };
}
