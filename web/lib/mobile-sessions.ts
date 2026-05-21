import { randomBytes, createHash } from "node:crypto";
import { sign, verify } from "./auth";
import { db, ensureSchema } from "./db";

/**
 * Bearer tokens for the iOS app. The Talise web flow continues to use
 * httpOnly cookies; mobile bearers exist alongside them and carry the
 * same user id payload.
 *
 * Storage: a `mobile_sessions` table keyed by SHA-256(token). We never
 * store the token plaintext on the server. Tokens have a 24h TTL and are
 * rotated automatically on every cold start of the mobile app.
 *
 * Each session also stores the Google id_token (JWT) and Shinami salt
 * that the user signed in with. These two are what the zkLogin signer
 * needs to assemble a SerializedSignature on every sponsor-execute call
 * — the web flow stores them in a signing cookie; mobile stores them
 * here. JWT outlives a single bearer (Google JWTs are 1h, our bearers
 * are 24h) but Shinami's prover still accepts an expired JWT as long
 * as the proof was minted while it was fresh — so for signing purposes
 * we keep the JWT until the bearer rotates.
 */
const MOBILE_SESSION_TTL_MS = 1000 * 60 * 60 * 24;

export async function ensureMobileSessionsSchema() {
  await ensureSchema();
  const client = db();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS mobile_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      device_id TEXT,
      app_attest_key_id TEXT,
      jwt TEXT,
      salt TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await client.execute(
    `CREATE INDEX IF NOT EXISTS mobile_sessions_user_idx ON mobile_sessions(user_id)`
  );
  // Defensive ALTER for installs that pre-date the jwt/salt columns.
  // Idempotent: errors when columns already exist are swallowed.
  try {
    await client.execute(`ALTER TABLE mobile_sessions ADD COLUMN jwt TEXT`);
  } catch {}
  try {
    await client.execute(`ALTER TABLE mobile_sessions ADD COLUMN salt TEXT`);
  } catch {}
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueMobileBearer(
  userId: number,
  opts: { deviceId?: string; jwt?: string; salt?: string } = {}
): Promise<string> {
  await ensureMobileSessionsSchema();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await db().execute({
    sql: `INSERT INTO mobile_sessions
            (token_hash, user_id, device_id, jwt, salt, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      hash(token),
      userId,
      opts.deviceId ?? null,
      opts.jwt ?? null,
      opts.salt ?? null,
      now,
      now + MOBILE_SESSION_TTL_MS,
    ],
  });
  // Return token signed so we can fast-validate at the edge before hitting DB.
  return sign(token);
}

export async function verifyMobileBearer(signedToken: string): Promise<number | null> {
  const token = verify(signedToken);
  if (!token) return null;
  await ensureMobileSessionsSchema();
  const row = await db().execute({
    sql: `SELECT user_id, expires_at, revoked FROM mobile_sessions WHERE token_hash = ?`,
    args: [hash(token)],
  });
  const r = row.rows[0] as unknown as { user_id: number; expires_at: number; revoked: number } | undefined;
  if (!r) return null;
  if (r.revoked) return null;
  if (r.expires_at < Date.now()) return null;
  return r.user_id;
}

export async function revokeAllMobileSessions(userId: number) {
  await ensureMobileSessionsSchema();
  await db().execute({
    sql: `UPDATE mobile_sessions SET revoked = 1 WHERE user_id = ?`,
    args: [userId],
  });
}

/**
 * Look up the (jwt, salt) pair stored on the most recent live bearer for
 * a given user. Used by the zkLogin signer to assemble SerializedSignature
 * on mobile-originated requests (replacing the web flow's signing cookie).
 *
 * Returns null if no live mobile session exists, or if the stored row
 * doesn't carry signing material (legacy rows before this column existed).
 */
export async function mobileSigningContext(
  userId: number
): Promise<{ jwt: string; salt: string } | null> {
  await ensureMobileSessionsSchema();
  const row = await db().execute({
    sql: `SELECT jwt, salt FROM mobile_sessions
          WHERE user_id = ? AND revoked = 0 AND expires_at > ?
            AND jwt IS NOT NULL AND salt IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
    args: [userId, Date.now()],
  });
  const r = row.rows[0] as unknown as { jwt: string; salt: string } | undefined;
  if (!r) return null;
  return { jwt: r.jwt, salt: r.salt };
}

/**
 * Pull the user id from either a session cookie OR a Bearer header.
 * Used by mobile-aware API routes to accept both clients without
 * duplicating logic.
 */
export async function readEntryIdFromRequest(req: Request): Promise<number | null> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    return verifyMobileBearer(token);
  }
  // Fall back to cookie-based session — leaves existing web flows intact.
  const { readSessionEntryId } = await import("./session");
  return readSessionEntryId();
}

/**
 * True when the request authenticates via a Bearer header (i.e. the
 * iOS app). False for cookie-based web sessions. Lets routes decide
 * which signing-context source to use.
 */
export function isMobileRequest(req: Request): boolean {
  return req.headers.get("authorization")?.startsWith("Bearer ") ?? false;
}
