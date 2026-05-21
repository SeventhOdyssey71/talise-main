import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { db, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Persist the App Attest keyId + first attestation object.
 *
 * Full Apple validation (AppleAppAttestRoot CA chain, RPID hash, counter,
 * AAGUID, etc.) lives in `lib/app-attest.ts` (to be written — out of scope
 * for the iOS scaffold commit). For now we store the raw blob + keyId so
 * subsequent asserts can be verified.
 *
 * Schema is idempotent.
 */
async function ensureAttestSchema() {
  await ensureSchema();
  await db().execute(`
    CREATE TABLE IF NOT EXISTS app_attest_keys (
      key_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      attestation_blob TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
}

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { keyId?: string; attestation?: string; challenge?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.keyId || !body.attestation || !body.challenge) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // TODO(security): full Apple App Attest verification — verify cert chain,
  // RPID hash matches teamID+bundleID, counter starts at 0, etc. Until that
  // ships, accept the blob and rely on TLS + the cookie session as a soft
  // gate. Document this gap in SECURITY.md.

  await ensureAttestSchema();
  await db().execute({
    sql: `INSERT OR REPLACE INTO app_attest_keys
            (key_id, user_id, attestation_blob, counter, created_at)
          VALUES (?, ?, ?, 0, ?)`,
    args: [body.keyId, userId, body.attestation, Date.now()],
  });
  return NextResponse.json({ ok: true });
}
