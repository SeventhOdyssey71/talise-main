import { getRecentActivityWithMeta } from "@/lib/activity";
import type { IndexedTx } from "@/lib/analytics/types";

/**
 * Index a single address's on-chain transaction history via the existing
 * gRPC / GraphQL activity pipeline.
 *
 * Reuses `getRecentActivityWithMeta` (limit 80, includeNonTalise) and maps each
 * `ActivityEntry` -> `IndexedTx` with `source: "grpc"`.
 *
 * Returns `null` when no data could be read (the call threw, or the tx-history
 * leg timed out — `complete: false` — and yielded zero entries), so the caller
 * can distinguish "no data read" from a genuine zero-activity address (which
 * returns `[]`). Never throws.
 */
export async function indexAddressViaGrpc(
  address: string
): Promise<IndexedTx[] | null> {
  let entries;
  let complete: boolean;
  try {
    const res = await getRecentActivityWithMeta(address, 80, {
      includeNonTalise: true,
    });
    entries = res.entries;
    complete = res.complete;
  } catch {
    // Hard failure — could not read the chain at all.
    return null;
  }

  // A partial read (timed out) that produced nothing is indistinguishable from
  // "no data" — signal that to the caller rather than reporting a false zero.
  if (!complete && entries.length === 0) {
    return null;
  }

  const txs: IndexedTx[] = entries.map((e) => ({
    digest: e.digest,
    ts: e.timestampMs,
    direction: e.direction,
    amountUsd:
      e.amountUsdsui === null || !Number.isFinite(e.amountUsdsui)
        ? null
        : Math.abs(e.amountUsdsui),
    counterparty: e.counterparty,
    counterpartyName: e.counterpartyName,
    source: "grpc",
  }));

  return txs;
}
