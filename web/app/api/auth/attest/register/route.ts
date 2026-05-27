import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { db, ensureSchema } from "@/lib/db";
import { consumeAttestChallenge } from "@/lib/app-attest";

export const runtime = "nodejs";

/**
 * Persist the App Attest keyId + first attestation object.
 *
 * Phase 1 (this commit): we verify the challenge half of the protocol
 * (one-time, server-persisted nonce with 5-minute TTL) and store the
 * raw attestation blob keyed by the iOS Secure Enclave keyId.
 *
 * Phase 2 (deferred, see `TODO-APPATTEST.md`): full Apple chain
 * verification. Until that ships, a stolen bearer can still register
 * a forged attestation; the challenge layer just prevents replays.
 *
 * Schema is idempotent.
 */
async function ensureAttestSchema() {
  await ensureSchema();
  await db().execute(`
    CREATE TABLE IF NOT EXISTS app_attest_keys (
      key_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      attestation_blob TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
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

  const consumed = await consumeAttestChallenge({
    nonce: body.challenge,
    userId,
  });
  if (!consumed.ok) {
    return NextResponse.json({ error: consumed.reason }, { status: 400 });
  }

  // TODO(P1-5 phase 2): full Apple App Attest verification:
  //   - decode CBOR attestation, walk authData,
  //   - verify AppleAppAttestRoot CA chain on the attestation cert,
  //   - check `nonce` extension matches SHA256(challenge || appId),
  //   - verify RPID hash == SHA256(teamID || "." || bundleID),
  //   - assert counter starts at 0,
  //   - persist credentialPublicKey + AAGUID so future asserts can
  //     be verified via signature + counter monotonicity.
  // See `TODO-APPATTEST.md` for the runbook.

  await ensureAttestSchema();
  await db().execute({
    sql: `INSERT INTO app_attest_keys
            (key_id, user_id, attestation_blob, counter, created_at)
          VALUES (?, ?, ?, 0, ?)
          ON CONFLICT (key_id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            attestation_blob = EXCLUDED.attestation_blob,
            counter = 0,
            created_at = EXCLUDED.created_at`,
    args: [body.keyId, userId, body.attestation, Date.now()],
  });
  return NextResponse.json({ ok: true });
}
