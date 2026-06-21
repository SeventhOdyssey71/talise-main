import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { shieldConfigured } from "@/lib/shield/onchain";
import { merklePathForLeaf, dummyPath, refreshMerkleCache } from "@/lib/shield/merkle";
import { runShieldIndexer } from "@/lib/shield/indexer";
import { memoTtl } from "@/lib/perf-cache";
import { USDSUI_TYPE } from "@/lib/usdsui";

export const runtime = "nodejs";

/**
 * LIVE CATCH-UP — pull just-landed commitments straight from chain on demand,
 * so a withdraw's Merkle path (and the deposit's current root) is available
 * within ~seconds of the deposit finalizing, NOT gated by the 2-min indexer
 * cron. Deduped to one in-flight run per 3s window so the harness's rapid polls
 * don't spawn parallel indexer runs. Failures are swallowed — the cron + the
 * caller's retry remain the backstop. THIS is what makes the shielded send fire
 * at Sui speed instead of waiting minutes.
 */
function liveIndexCatchUp(): Promise<unknown> {
  return memoTtl("shield-live-index", 3_000, () => runShieldIndexer().catch(() => null));
}

/**
 * POST /api/shield/merkle-path
 *
 * Returns the 26 `[left,right]` authentication-path pairs (WASM-prover format)
 * for a shielded-note commitment, so the client can build a spend proof.
 *
 * Body: { coinType?, leafIndex?, commitment?, dummy? }
 *   - pass `commitment` (u256 decimal string) OR `leafIndex`; `commitment`
 *     additionally validates the indexer agrees on placement.
 *   - `dummy: true` returns the all-ZERO path for an unused 2-in slot.
 *
 * Money-adjacent (it feeds a spend), so gated behind auth + app approval.
 * Dormant → 503 until `shieldConfigured()`.
 */
export async function POST(req: Request) {
  if (!shieldConfigured()) {
    return NextResponse.json({ error: "privacy not yet live", code: "SHIELD_OFF" }, { status: 503 });
  }

  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  let body: {
    coinType?: string;
    leafIndex?: number;
    commitment?: string;
    dummy?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Catch up to chain on-demand BEFORE serving — both the deposit's current
  // root and the withdraw's path are then live (no 2-min cron wait).
  await liveIndexCatchUp();

  if (body.dummy) {
    const p = dummyPath();
    // The deposit leg uses dummy input paths (zero-amount inputs skip the
    // membership check) but its proof's `root` public signal must be a KNOWN
    // on-chain root, so surface the live tree root alongside the dummy path.
    const coinType = body.coinType || USDSUI_TYPE;
    let currentRoot: string | undefined;
    try {
      currentRoot = await refreshMerkleCache(coinType);
    } catch {
      /* leave undefined — the caller falls back / retries */
    }
    return NextResponse.json({ dummy: true, ...p, ...(currentRoot ? { currentRoot } : {}) });
  }

  const coinType = body.coinType || USDSUI_TYPE;
  const hasIndex = typeof body.leafIndex === "number" && Number.isInteger(body.leafIndex);
  const hasCommitment = typeof body.commitment === "string" && body.commitment.length > 0;
  if (!hasIndex && !hasCommitment) {
    return NextResponse.json(
      { error: "provide leafIndex or commitment (or dummy:true)" },
      { status: 400 }
    );
  }

  let commitment: bigint | undefined;
  if (hasCommitment) {
    try {
      commitment = BigInt(body.commitment as string);
    } catch {
      return NextResponse.json({ error: "commitment must be a u256 decimal string" }, { status: 400 });
    }
  }

  try {
    const path = await merklePathForLeaf(coinType, {
      leafIndex: hasIndex ? body.leafIndex : undefined,
      commitment,
    });
    return NextResponse.json({ coinType, ...path });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
