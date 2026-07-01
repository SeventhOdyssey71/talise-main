import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { WRAP_PREFIX } from "@/lib/shield/sdk/escrow-wrap";

export const runtime = "nodejs";

/**
 * Shield note-master ESCROW — the OAuth-bound recovery rail (Workstream D).
 *
 * The note master is the root of a user's shielded notes. The PRIMARY copy
 * lives on-device (iCloud-synchronizable Keychain); this endpoint is the
 * RECOVERY rail so a user who reinstalls / switches devices can restore it by
 * signing back in (it's keyed to their stable Talise account id). Combined with
 * the keychain, a user recovers by: re-sign-in → restore master → re-scan.
 *
 * TRUST MODEL: this endpoint is a BLIND blob store — it never interprets what
 * it holds. Two shapes are accepted:
 *   • Legacy plaintext-hex master (operator-readable) — the original pilot
 *     posture, still honored for already-escrowed users.
 *   • A `tsw1:` NON-CUSTODIAL envelope: the master wrapped client-side under a
 *     user-held recovery code (see lib/shield/sdk/escrow-wrap.ts). The server
 *     cannot open it. This closes the "operator can read every shielded amount"
 *     gap. Clients wrap by default; existing plaintext rows can be UPGRADED to a
 *     wrapped envelope in place (never downgraded — see POST).
 */

let _escrowReady: Promise<void> | null = null;
async function ensureEscrowTable(): Promise<void> {
  if (_escrowReady) return _escrowReady;
  _escrowReady = (async () => {
    await ensureSchema();
    await db().execute(
      `CREATE TABLE IF NOT EXISTS shield_key_escrow (
         user_id TEXT PRIMARY KEY,
         note_master TEXT NOT NULL,
         created_at BIGINT NOT NULL,
         updated_at BIGINT NOT NULL
       )`
    );
  })();
  return _escrowReady;
}

/** GET → restore: `{ noteMaster: string | null }`. */
export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  await ensureEscrowTable();
  const r = await db().execute({
    sql: `SELECT note_master FROM shield_key_escrow WHERE user_id = ?`,
    args: [String(userId)],
  });
  const noteMaster = (r.rows[0]?.note_master as string | undefined) ?? null;
  return NextResponse.json({ noteMaster });
}

/** POST { noteMaster } → backup. First-writer-wins: never overwrite an existing
 *  master (the on-device copy is authoritative; a clobber would orphan notes). */
export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  let body: { noteMaster?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const noteMaster = String(body.noteMaster ?? "").trim();
  // Accept EITHER a legacy plaintext-hex master (32–128 hex chars) OR a
  // non-custodial `tsw1:` envelope (base64 payload, length-bounded). The server
  // never parses the envelope — it only stores/serves it.
  const isLegacyHex = /^[0-9a-f]{32,128}$/i.test(noteMaster);
  const isWrapped =
    noteMaster.startsWith(WRAP_PREFIX) &&
    /^tsw1:[A-Za-z0-9+/=]{40,400}$/.test(noteMaster);
  if (!isLegacyHex && !isWrapped) {
    return NextResponse.json(
      { error: "noteMaster must be hex (32–128 chars) or a tsw1: envelope" },
      { status: 400 }
    );
  }

  await ensureEscrowTable();
  const now = Date.now();
  // 1) First-writer-wins for the no-row case: a re-derived / re-generated master
  //    can never overwrite an existing recovery copy.
  await db().execute({
    sql: `INSERT INTO shield_key_escrow (user_id, note_master, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id) DO NOTHING`,
    args: [String(userId), noteMaster, now, now],
  });
  // 2) Guarded UPGRADE: if the client sends a wrapped envelope and the stored
  //    copy is still legacy PLAINTEXT, flip it to the non-custodial envelope.
  //    The `NOT LIKE 'tsw1:%'` predicate is a compare-and-swap: it makes this a
  //    one-way, race-safe transition — a wrapped blob is never downgraded to
  //    plaintext, and two concurrent upgrades can't clobber each other (only the
  //    first matches; the second sees an already-wrapped row and updates 0 rows).
  if (isWrapped) {
    await db().execute({
      sql: `UPDATE shield_key_escrow
              SET note_master = ?, updated_at = ?
            WHERE user_id = ? AND note_master NOT LIKE 'tsw1:%'`,
      args: [noteMaster, now, String(userId)],
    });
  }
  // Echo back the authoritative stored master so the client adopts the escrow
  // copy if one already existed (prevents two devices diverging on first use).
  const r = await db().execute({
    sql: `SELECT note_master FROM shield_key_escrow WHERE user_id = ?`,
    args: [String(userId)],
  });
  return NextResponse.json({ noteMaster: (r.rows[0]?.note_master as string | undefined) ?? noteMaster });
}
