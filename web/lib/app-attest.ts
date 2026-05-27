import "server-only";

import { db, ensureSchema } from "@/lib/db";
import { isMobileRequest } from "@/lib/mobile-sessions";
import { randomBytes } from "node:crypto";

/**
 * Stateful App Attest support.
 *
 * Phase 1 (this file): persist one-time challenges issued by
 * `/api/auth/attest/challenge`, consume them in
 * `/api/auth/attest/register`, and provide a `requireAppAttest`
 * middleware skeleton for sensitive routes.
 *
 * Phase 2 (deferred, see TODO-APPATTEST.md): full Apple chain
 * verification (AppleAppAttestRoot CA, AAGUID, nonce, RPID hash,
 * counter monotonicity). Without that, the registration endpoint
 * still trusts the attestation blob blindly; this file's job is
 * to make sure the challenge half of the protocol is real.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CHALLENGE_BYTES = 32;

async function ensureAttestChallengeSchema(): Promise<void> {
  await ensureSchema();
  await db().execute(`
    CREATE TABLE IF NOT EXISTS app_attest_challenges (
      nonce TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      issued_at BIGINT NOT NULL,
      consumed_at BIGINT
    )
  `);
  await db().execute(
    `CREATE INDEX IF NOT EXISTS idx_attest_chal_user ON app_attest_challenges(user_id)`
  );
  await db().execute(
    `CREATE INDEX IF NOT EXISTS idx_attest_chal_issued ON app_attest_challenges(issued_at)`
  );
}

/**
 * Issue and persist a fresh challenge for a user. The returned
 * value is what the iOS client passes through
 * `DCAppAttestService.attestKey(_:clientDataHash:)`.
 */
export async function issueAttestChallenge(userId: number): Promise<string> {
  await ensureAttestChallengeSchema();
  const nonce = randomBytes(CHALLENGE_BYTES).toString("base64");
  await db().execute({
    sql: `INSERT INTO app_attest_challenges (nonce, user_id, issued_at)
          VALUES (?, ?, ?)`,
    args: [nonce, userId, Date.now()],
  });
  // Opportunistic GC of expired rows. Best-effort; do not block
  // issuance on failure.
  void db().execute({
    sql: `DELETE FROM app_attest_challenges WHERE issued_at < ?`,
    args: [Date.now() - CHALLENGE_TTL_MS * 4],
  });
  return nonce;
}

/**
 * Atomically consume a challenge. Returns true exactly once per
 * issued nonce, then never again. Rejects expired or unknown
 * nonces and challenges issued to a different user.
 */
export async function consumeAttestChallenge(input: {
  nonce: string;
  userId: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  await ensureAttestChallengeSchema();
  const now = Date.now();
  // Single SQL update with a guard predicate gives us atomic
  // consume-on-first-use without a separate read.
  const r = await db().execute({
    sql: `UPDATE app_attest_challenges
            SET consumed_at = ?
          WHERE nonce = ?
            AND user_id = ?
            AND consumed_at IS NULL
            AND issued_at >= ?
          RETURNING nonce`,
    args: [now, input.nonce, input.userId, now - CHALLENGE_TTL_MS],
  });
  if (r.rows.length === 0) {
    return { ok: false, reason: "challenge invalid, expired, or already used" };
  }
  return { ok: true };
}

// ─── Enforcement skeleton ───────────────────────────────────────────────

/**
 * Routes where mobile traffic MUST present a valid `X-App-Attest`
 * assertion. Pulled into a single list so it is greppable from one
 * place and stays in sync with the runbook.
 */
export const APP_ATTEST_REQUIRED_PREFIXES: readonly string[] = [
  "/api/zk/sponsor-execute",
  "/api/onramp/",
  "/api/tx/record",
];

export function pathRequiresAppAttest(pathname: string): boolean {
  return APP_ATTEST_REQUIRED_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Middleware skeleton. Returns null when the request is permitted,
 * or a Response (401) when not. Full assertion verification is
 * deferred (see TODO-APPATTEST.md). Right now this enforces only
 * the structural rule: mobile traffic to a sensitive route MUST
 * present `X-App-Attest` + `X-App-Attest-KeyId`.
 *
 * Mobile detection comes from `mobile-sessions.isMobileRequest`
 * (Bearer header presence) so this enforcement layer can't
 * accidentally drift from the auth layer.
 */
export function requireAppAttestStructural(req: Request): Response | null {
  if (!isMobileRequest(req)) return null;
  const url = new URL(req.url);
  if (!pathRequiresAppAttest(url.pathname)) return null;
  // Escape hatch for simulator / staging. `DCAppAttestService.isSupported`
  // is false in the iOS Simulator, so an iOS sim build CANNOT generate the
  // assertion required by this check — turning every sponsor-execute into
  // a 401. Setting `TALISE_APP_ATTEST_REQUIRED=0` lets dev / preview
  // environments accept simulator traffic. Production should leave this
  // unset (defaults to enforcing) once we ship to App Store users.
  if (process.env.TALISE_APP_ATTEST_REQUIRED === "0") return null;
  const assertion = req.headers.get("x-app-attest");
  const keyId = req.headers.get("x-app-attest-keyid");
  if (!assertion || !keyId) {
    return new Response(
      JSON.stringify({ error: "missing App Attest headers" }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }
  // TODO(P1-5 phase 2): verify the assertion bytes against the
  // stored attestation, counter monotonicity, RPID hash, and the
  // request payload hash. See TODO-APPATTEST.md.
  return null;
}
