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
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await client.execute(
    `CREATE INDEX IF NOT EXISTS mobile_sessions_user_idx ON mobile_sessions(user_id)`
  );
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueMobileBearer(userId: number, deviceId?: string): Promise<string> {
  await ensureMobileSessionsSchema();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await db().execute({
    sql: `INSERT INTO mobile_sessions
            (token_hash, user_id, device_id, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [hash(token), userId, deviceId ?? null, now, now + MOBILE_SESSION_TTL_MS],
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
