import "server-only";

import { db, ensureSchema, deviceTokensForUser } from "@/lib/db";
import { sendApnsPush } from "@/lib/apns";

/**
 * Reward grants — a gift the user opens.
 *
 * A grant is issued UNCLAIMED and holds no money. The USDsui moves only when
 * the beneficiary taps claim, at which point the treasury pays them and the row
 * records the settling digest.
 *
 * WHY CLAIM-ON-DEMAND RATHER THAN PRE-FUNDED ESCROW. A real `Cheque<USDSUI>`
 * object would put the funds on chain up front, but that means paying to create
 * and fund one object per beneficiary, and anything unclaimed sits stranded
 * until someone reclaims it. Claim-on-demand gives the user the identical
 * experience — a sealed gift that becomes theirs on a tap — while unclaimed
 * rewards cost nothing and nothing can strand. The claim is not theatre: the
 * transfer genuinely happens at that moment.
 *
 * DOUBLE-CLAIM is locked by an atomic
 * `UPDATE ... WHERE status='unclaimed' RETURNING`, the same guard the cheque
 * escrow rail uses. Two taps race; exactly one wins the row and only that one
 * is allowed to move money.
 *
 * Postgres DDL only, memoized once per process, reset on failure so a transient
 * error retries — mirroring lib/invoices.ts:ensureWorkSchema.
 */

let _grantsSchemaP: Promise<void> | null = null;

export function ensureGrantsSchema(): Promise<void> {
  if (_grantsSchemaP) return _grantsSchemaP;
  _grantsSchemaP = (async () => {
    await ensureSchema();
    const c = db();

    await c.execute({
      sql: `CREATE TABLE IF NOT EXISTS reward_grants (
              id          TEXT PRIMARY KEY,
              user_id     INTEGER NOT NULL,
              amount_usd  DOUBLE PRECISION NOT NULL,
              reason      TEXT NOT NULL,
              status      TEXT NOT NULL DEFAULT 'unclaimed',
              created_at  BIGINT NOT NULL,
              claimed_at  BIGINT,
              digest      TEXT
            )`,
      args: [],
    });

    // The hot read is "does this user have a gift waiting", on every app open.
    await c
      .execute({
        sql: `CREATE INDEX IF NOT EXISTS reward_grants_unclaimed_idx
                ON reward_grants (user_id) WHERE status = 'unclaimed'`,
        args: [],
      })
      .catch(() => {});

    // One unclaimed grant per user per batch. `batch_key` lets a distribution
    // be replayed safely: re-running the same batch cannot mint a second gift
    // for someone who already has one from it.
    await c
      .execute({ sql: `ALTER TABLE reward_grants ADD COLUMN IF NOT EXISTS batch_key TEXT`, args: [] })
      .catch(() => {});
    await c
      .execute({
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS reward_grants_batch_idx
                ON reward_grants (user_id, batch_key) WHERE batch_key IS NOT NULL`,
        args: [],
      })
      .catch(() => {});
  })().catch((e) => {
    _grantsSchemaP = null;
    throw e;
  });
  return _grantsSchemaP;
}

export type RewardGrant = {
  id: string;
  userId: number;
  amountUsd: number;
  reason: string;
  status: "unclaimed" | "claimed";
  createdAt: number;
  claimedAt: number | null;
  digest: string | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toGrant(row: Record<string, unknown>): RewardGrant {
  return {
    id: String(row.id ?? ""),
    userId: num(row.user_id),
    amountUsd: num(row.amount_usd),
    reason: String(row.reason ?? ""),
    status: String(row.status ?? "unclaimed") === "claimed" ? "claimed" : "unclaimed",
    createdAt: num(row.created_at),
    claimedAt: row.claimed_at == null ? null : num(row.claimed_at),
    digest: row.digest == null ? null : String(row.digest),
  };
}

/**
 * Issue an unclaimed gift. Moves no money. `batchKey` makes a distribution run
 * replayable: the unique index drops a duplicate rather than gifting twice.
 */
export async function issueGrant(opts: {
  id: string;
  userId: number;
  amountUsd: number;
  reason: string;
  batchKey: string;
}): Promise<void> {
  if (!(opts.amountUsd > 0)) throw new Error("issueGrant: amount must be positive");
  if (!opts.batchKey) throw new Error("issueGrant: batchKey is required");
  await ensureGrantsSchema();
  const r = await db().execute({
    // The unique index is PARTIAL (`WHERE batch_key IS NOT NULL`), and Postgres
    // will not infer a partial index for ON CONFLICT unless the statement
    // repeats the same predicate. Without it every insert fails with "no unique
    // or exclusion constraint matching the ON CONFLICT specification".
    sql: `INSERT INTO reward_grants (id, user_id, amount_usd, reason, status, created_at, batch_key)
          VALUES ($1, $2, $3, $4, 'unclaimed', $5, $6)
          ON CONFLICT (user_id, batch_key) WHERE batch_key IS NOT NULL DO NOTHING
      RETURNING id`,
    args: [opts.id, opts.userId, opts.amountUsd, opts.reason, Date.now(), opts.batchKey],
  });
  // Only notify when a row was actually inserted. A replayed batch hits the
  // conflict, returns nothing, and must not push a second time.
  if (r.rows.length > 0) {
    await notifyGranted(opts.userId, opts.amountUsd);
  }
}

/**
 * Tell ONE beneficiary their gift is waiting.
 *
 * Targeted by construction: tokens are looked up for that user id, so nobody
 * outside the grant list can receive this. Best effort — a push that fails must
 * never fail the issue, the banner is the real delivery mechanism and the push
 * is only what brings them back to see it.
 */
async function notifyGranted(userId: number, amountUsd: number): Promise<void> {
  try {
    const tokens = await deviceTokensForUser(userId);
    if (tokens.length === 0) return;
    await Promise.all(
      tokens.map((t) =>
        sendApnsPush(t, {
          title: "You've received a Talise reward",
          // The amount is NOT in the push. The gift is sealed until it is
          // opened in-app, and spoiling it on the lock screen removes the only
          // reason to tap through.
          body: "Open the app to claim it.",
          threadId: "talise-rewards",
          interruptionLevel: "active",
          relevanceScore: 1,
          data: { kind: "reward_grant" },
        })
      )
    );
  } catch (e) {
    console.warn(`[rewards] push failed for user=${userId}: ${(e as Error).message}`);
  }
}

/**
 * The user's oldest unopened gift, or null. Fails CLOSED to null: a gift is a
 * delight, never a reason to fail an app open.
 */
export async function pendingGrantFor(userId: number): Promise<RewardGrant | null> {
  try {
    await ensureGrantsSchema();
    const r = await db().execute({
      sql: `SELECT * FROM reward_grants
             WHERE user_id = $1 AND status = 'unclaimed'
             ORDER BY created_at ASC
             LIMIT 1`,
      args: [userId],
    });
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? toGrant(row) : null;
  } catch {
    return null;
  }
}

/**
 * Atomically take ownership of a claim. Returns the grant only to the caller
 * that flipped it out of `unclaimed`; every other racing tap gets null and MUST
 * NOT pay. Scoped to `user_id` so no one can claim another user's gift.
 *
 * Claimed BEFORE the money moves, deliberately. If the transfer then fails we
 * release it with `releaseClaim`; the alternative ordering (pay, then mark)
 * risks paying twice on a crash, and paying twice is worse than a gift that
 * needs one more tap.
 */
export async function lockGrantForClaim(
  userId: number,
  grantId: string
): Promise<RewardGrant | null> {
  await ensureGrantsSchema();
  const r = await db().execute({
    sql: `UPDATE reward_grants
             SET status = 'claimed', claimed_at = $1
           WHERE id = $2 AND user_id = $3 AND status = 'unclaimed'
       RETURNING *`,
    args: [Date.now(), grantId, userId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? toGrant(row) : null;
}

/** Record the settling digest once the payout lands. */
export async function attachDigest(grantId: string, digest: string): Promise<void> {
  await db().execute({
    sql: `UPDATE reward_grants SET digest = $1 WHERE id = $2`,
    args: [digest, grantId],
  });
}

/** Put a locked grant back on the shelf after a failed payout. */
export async function releaseClaim(grantId: string): Promise<void> {
  await db()
    .execute({
      sql: `UPDATE reward_grants
               SET status = 'unclaimed', claimed_at = NULL
             WHERE id = $1 AND digest IS NULL`,
      args: [grantId],
    })
    .catch(() => {});
}
