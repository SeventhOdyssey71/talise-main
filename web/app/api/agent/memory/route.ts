import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { db, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Agent-memory POINTER rail — the user's current memory blob id.
 *
 *   GET /api/agent/memory   -> { blobId: string | null }   (current pointer)
 *   PUT /api/agent/memory   body { blobId: string }  -> { ok: true }   (upsert)
 *
 * The pointer is the ONLY memory state the server holds in its own DB: a row
 * (user_id, blob_id, updated_at) in `agent_memory_pointers`. The blob it points
 * at is opaque ciphertext on Walrus (see ./blob/route.ts); the server never
 * holds the key and never decrypts. The pointer table itself is created by the
 * integrator in lib/db.ts ensureSchema() — this route only SELECTs / UPSERTs.
 *
 * Gated like the money/agent routes: FEATURE_AGENT_MEMORY (default-on),
 * authenticated entry id, and private-beta app-access.
 */

/** Feature flag — enabled UNLESS explicitly set to "false". */
function memoryDisabled(): boolean {
  return process.env.FEATURE_AGENT_MEMORY?.trim().toLowerCase() === "false";
}

/** GET → the caller's current pointer: `{ blobId: string | null }`. */
export async function GET(req: Request) {
  if (memoryDisabled()) return NextResponse.json({ disabled: true }, { status: 404 });

  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT blob_id FROM agent_memory_pointers WHERE user_id = ? LIMIT 1`,
    args: [userId],
  });
  const blobId = (r.rows[0]?.blob_id as string | null | undefined) ?? null;
  return NextResponse.json({ blobId });
}

/** PUT { blobId } → upsert the caller's pointer to the latest blob. */
export async function PUT(req: Request) {
  if (memoryDisabled()) return NextResponse.json({ disabled: true }, { status: 404 });

  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  let body: { blobId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const blobId = typeof body.blobId === "string" ? body.blobId.trim() : "";
  if (!blobId) return NextResponse.json({ error: "missing blobId" }, { status: 400 });

  await ensureSchema();
  await db().execute({
    sql: `INSERT INTO agent_memory_pointers (user_id, blob_id, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT (user_id) DO UPDATE
            SET blob_id = EXCLUDED.blob_id, updated_at = EXCLUDED.updated_at`,
    args: [userId, blobId, Date.now()],
  });
  return NextResponse.json({ ok: true });
}
