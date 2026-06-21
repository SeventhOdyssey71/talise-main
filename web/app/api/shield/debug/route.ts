import { NextResponse } from "next/server";
import { shieldConfigured, SHIELD, SHIELD_RPC } from "@/lib/shield/onchain";
import { ensureShieldSchema } from "@/lib/shield/db";
import { db } from "@/lib/db";
import { runShieldIndexer } from "@/lib/shield/indexer";
import { currentRoot } from "@/lib/shield/merkle";
import { USDSUI_TYPE } from "@/lib/usdsui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/shield/debug?key=<SHIELD_DEBUG_KEY>
 *
 * TEMPORARY read-only operator diagnostic. Secret-gated (NOT user auth) so an
 * operator can inspect why the shielded withdraw never delivers, without the
 * sensitive DATABASE_URL/relayer key locally. Returns: on-chain next_index vs
 * the indexer's commitment count (is it behind?), the encrypted_output wire
 * shape (hex vs base64 — the scan bug), and the merkle cache root. Reads only;
 * runs the indexer catch-up. Remove once the withdraw path is healthy.
 */
async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(SHIELD_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.SHIELD_DEBUG_KEY || key !== process.env.SHIELD_DEBUG_KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!shieldConfigured()) {
    return NextResponse.json({ error: "shield not configured" }, { status: 503 });
  }
  await ensureShieldSchema();

  const out: Record<string, unknown> = {};

  // ?reset=1 — clear the per-pipeline cursors so the next indexer run re-scans
  // from genesis (recovers from a stuck/stale cursor). Also report the cursor.
  const url = new URL(req.url);
  try {
    const cur = await db().execute({ sql: "SELECT pipeline, tx_digest, event_seq FROM shield_index_cursor", args: [] });
    out.cursors_before = cur.rows;
  } catch (e) {
    out.cursors_before_error = (e as Error).message;
  }
  // Report + force-drop the broken event_seq unique indexes (the warm-Lambda
  // schema path may not have re-run the DROP). With them present, inserting any
  // leaf whose per-tx event_seq collides throws → the whole batch fails → only
  // the first tx's leaves persist.
  try {
    const idx = await db().execute({
      sql: "SELECT indexname FROM pg_indexes WHERE indexname IN ('uniq_shield_commitments_event_seq','uniq_shield_nullifiers_event_seq')",
      args: [],
    });
    out.bad_indexes_present = (idx.rows as any[]).map((r) => r.indexname);
  } catch (e) {
    out.bad_indexes_error = (e as Error).message;
  }
  if (url.searchParams.get("fixidx") === "1") {
    try {
      await db().execute({ sql: "DROP INDEX IF EXISTS uniq_shield_commitments_event_seq", args: [] });
      await db().execute({ sql: "DROP INDEX IF EXISTS uniq_shield_nullifiers_event_seq", args: [] });
      out.bad_indexes_dropped = true;
    } catch (e) {
      out.bad_indexes_drop_error = (e as Error).message;
    }
  }
  if (url.searchParams.get("reset") === "1") {
    try {
      await db().execute({ sql: "DELETE FROM shield_index_cursor", args: [] });
      out.cursor_reset = true;
    } catch (e) {
      out.cursor_reset_error = (e as Error).message;
    }
  }
  try {
    const mt = await rpc("sui_getObject", [
      "0x5a32ce39a3d9961ca5c1785f708f95b22434287047cb0db1bff76090de2c3e47",
      { showContent: true },
    ]);
    out.onchain_next_index = Number(mt?.data?.content?.fields?.next_index ?? -1);
  } catch (e) {
    out.onchain_next_index_error = (e as Error).message;
  }

  try {
    const before = await db().execute({
      sql: "SELECT COUNT(*)::int c, COALESCE(MAX(leaf_index),-1)::int m FROM shield_commitments WHERE coin_type = ?",
      args: [USDSUI_TYPE],
    });
    out.commitments_before = { count: (before.rows[0] as any).c, maxLeaf: (before.rows[0] as any).m };
  } catch (e) {
    out.commitments_before_error = (e as Error).message;
  }

  try {
    out.indexer_run = await runShieldIndexer();
  } catch (e) {
    out.indexer_run_error = (e as Error).message;
  }

  try {
    const after = await db().execute({
      sql: "SELECT COUNT(*)::int c, COALESCE(MAX(leaf_index),-1)::int m FROM shield_commitments WHERE coin_type = ?",
      args: [USDSUI_TYPE],
    });
    out.commitments_after = { count: (after.rows[0] as any).c, maxLeaf: (after.rows[0] as any).m };

    // Encrypted-output wire shape on the latest few leaves (hex vs base64 = scan bug).
    const rows = await db().execute({
      sql: "SELECT leaf_index, encrypted_output FROM shield_commitments WHERE coin_type = ? ORDER BY leaf_index DESC LIMIT 6",
      args: [USDSUI_TYPE],
    });
    out.encrypted_output_shapes = (rows.rows as any[]).map((r) => {
      const v = r.encrypted_output as string | null;
      return {
        leaf: r.leaf_index,
        shape: v == null ? "NULL" : v.startsWith("0x") ? "hex" : /^[0-9a-fA-F]+$/.test(v) ? "bare-hex" : "base64/other",
        len: v?.length ?? 0,
      };
    });
  } catch (e) {
    out.commitments_after_error = (e as Error).message;
  }

  try {
    out.merkle_cache_root = await currentRoot(USDSUI_TYPE);
  } catch (e) {
    out.merkle_cache_root_error = (e as Error).message;
  }

  out.pkg = SHIELD.packageId;
  return NextResponse.json(out);
}
