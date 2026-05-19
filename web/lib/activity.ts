import "server-only";

import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
} from "@mysten/sui/jsonRpc";
import { USDSUI_TYPE } from "./usdsui";
import { findTaliseSubnameForOwner } from "./suins-lookup";
import { formatHandle } from "./handle";

/**
 * On-chain activity feed.
 *
 * We don't trust our local `tx_history` table as the source of truth —
 * inbound payments aren't recorded there at all, and outbound rows can be
 * lost across DB resets or failed write-backs. The chain has everything
 * we need: who sent what, to whom, when, in which coin.
 *
 * Approach per address:
 *   1. Query `suix_queryTransactionBlocks` twice — FromAddress + ToAddress
 *   2. Parse the `balanceChanges` block of each tx; isolate the user's
 *      net delta in USDsui (or SUI, for non-converted holdings).
 *   3. The counterparty is the other address with the inverse delta.
 *   4. Reverse-resolve the counterparty's `*.talise.sui` if they hold one,
 *      so the UI can render "from emma@talise" instead of `0xb9aa…866c`.
 */

export type ActivityEntry = {
  digest: string;
  timestampMs: number;
  direction: "sent" | "received";
  /** Net amount the user's address moved, in human units. Positive = received. */
  amountUsdsui: number | null;
  amountSui: number | null;
  /** Counterparty Sui address (or null for self / sponsor-only flows). */
  counterparty: string | null;
  /** Resolved `name@talise` display string, if the counterparty holds a Talise subname. */
  counterpartyName: string | null;
};

const SPONSOR_ADDRESSES = new Set<string>([
  "0x8a319488de2a8043a7b503d4a906ce5feedb793787bdb9a63bc6327d46310cdb",
]);

let _client: SuiJsonRpcClient | null = null;
function client(): SuiJsonRpcClient {
  if (_client) return _client;
  _client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl("mainnet"),
    network: "mainnet",
  });
  return _client;
}

type RawTx = {
  digest?: string;
  timestampMs?: string;
  effects?: { status?: { status?: string } };
  balanceChanges?: Array<{
    owner?: { AddressOwner?: string } | string;
    coinType?: string;
    amount?: string;
  }>;
};

type RawBalanceChange = NonNullable<RawTx["balanceChanges"]>[number];

function ownerOf(b: RawBalanceChange): string | null {
  if (!b.owner) return null;
  if (typeof b.owner === "string") return null;
  return b.owner.AddressOwner ?? null;
}

/** Split balance changes into per-(address × coin) deltas, ignoring sponsor moves. */
function summarize(
  tx: RawTx,
  myAddress: string
): {
  myUsdsui: number;
  mySui: number;
  counterparty: string | null;
} {
  const me = myAddress.toLowerCase();
  let myUsdsui = 0;
  let mySui = 0;
  // pick the largest non-self, non-sponsor counterparty by absolute USDsui (then SUI) movement
  const others: Record<string, { usdsui: number; sui: number }> = {};

  for (const b of tx.balanceChanges ?? []) {
    const owner = (ownerOf(b) ?? "").toLowerCase();
    if (!owner) continue;
    const amt = Number(b.amount ?? "0");
    if (b.coinType === USDSUI_TYPE) {
      const human = amt / 1e6;
      if (owner === me) myUsdsui += human;
      else if (!SPONSOR_ADDRESSES.has(owner)) {
        others[owner] ??= { usdsui: 0, sui: 0 };
        others[owner].usdsui += human;
      }
    } else if (b.coinType === "0x2::sui::SUI") {
      const human = amt / 1e9;
      if (owner === me) mySui += human;
      else if (!SPONSOR_ADDRESSES.has(owner)) {
        others[owner] ??= { usdsui: 0, sui: 0 };
        others[owner].sui += human;
      }
    }
  }

  // Pick counterparty with the biggest opposing movement (largest abs USDsui, fallback SUI).
  let counterparty: string | null = null;
  let bestScore = 0;
  for (const [addr, d] of Object.entries(others)) {
    const score = Math.abs(d.usdsui) || Math.abs(d.sui);
    if (score > bestScore) {
      bestScore = score;
      counterparty = addr;
    }
  }

  return { myUsdsui, mySui, counterparty };
}

export async function getRecentActivity(
  address: string,
  limit = 12
): Promise<ActivityEntry[]> {
  const c = client();
  const options = {
    showEffects: true,
    showBalanceChanges: true,
  };
  type Resp = { data?: RawTx[]; nextCursor?: string | null; hasNextPage?: boolean };
  let raw: RawTx[];
  try {
    const [from, to] = await Promise.all([
      (
        c as unknown as {
          queryTransactionBlocks: (a: unknown) => Promise<Resp>;
        }
      ).queryTransactionBlocks({
        filter: { FromAddress: address },
        options,
        limit,
        order: "descending",
      }),
      (
        c as unknown as {
          queryTransactionBlocks: (a: unknown) => Promise<Resp>;
        }
      ).queryTransactionBlocks({
        filter: { ToAddress: address },
        options,
        limit,
        order: "descending",
      }),
    ]);
    raw = [...(from.data ?? []), ...(to.data ?? [])];
  } catch {
    return [];
  }

  // Dedupe by digest. A tx can appear in both filters (e.g. a self-send).
  const byDigest = new Map<string, RawTx>();
  for (const tx of raw) {
    if (tx.digest && !byDigest.has(tx.digest)) byDigest.set(tx.digest, tx);
  }

  const entries: ActivityEntry[] = [];
  for (const tx of byDigest.values()) {
    if (tx.effects?.status?.status !== "success") continue;
    const { myUsdsui, mySui, counterparty } = summarize(tx, address);
    // Ignore txs where the user's net movement is essentially zero (e.g.
    // sponsorship-only events, dust). Don't clutter the feed with noise.
    if (Math.abs(myUsdsui) < 0.0001 && Math.abs(mySui) < 0.0001) continue;

    const direction: "sent" | "received" =
      myUsdsui < 0 || mySui < 0 ? "sent" : "received";
    entries.push({
      digest: tx.digest!,
      timestampMs: Number(tx.timestampMs ?? 0),
      direction,
      amountUsdsui: myUsdsui === 0 ? null : Math.abs(myUsdsui),
      amountSui: mySui === 0 ? null : Math.abs(mySui),
      counterparty,
      counterpartyName: null,
    });
  }

  // Sort newest first, slice to limit.
  entries.sort((a, b) => b.timestampMs - a.timestampMs);
  const limited = entries.slice(0, limit);

  // Reverse-resolve unique counterparties to talise handles. One RPC per
  // unique address; cache within this render so we don't hit the same
  // address twice.
  const uniqueCounterparties = Array.from(
    new Set(limited.map((e) => e.counterparty).filter((x): x is string => !!x))
  );
  const nameCache = new Map<string, string | null>();
  await Promise.all(
    uniqueCounterparties.map(async (addr) => {
      const sub = await findTaliseSubnameForOwner(addr);
      nameCache.set(addr, sub ? formatHandle(sub.username) : null);
    })
  );
  for (const e of limited) {
    if (e.counterparty) e.counterpartyName = nameCache.get(e.counterparty) ?? null;
  }

  return limited;
}
