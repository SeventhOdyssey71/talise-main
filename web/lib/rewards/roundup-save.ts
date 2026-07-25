import "server-only";

import { randomUUID } from "node:crypto";
import { db, schemaVersionGate } from "@/lib/db";
import { awardForTx } from "@/lib/rewards/earn";
import { verifyDigestForUser } from "@/lib/rewards/verify";
import { SAVE_TREASURY_FEE_BPS } from "@/lib/navi-supply";

/**
 * Spend + Save, the LEDGER that makes the round-up real.
 *
 * ── What was broken ─────────────────────────────────────────────────
 *
 * Round-up was display-only. `/api/send/sponsor-prepare` computed the
 * round-up amount and stopped there (the 2026-06-22 decoupling: the
 * combined send+supply PTB blew the sponsor window, a standalone NAVI
 * supply sponsors cleanly). No client ever fired the standalone supply,
 * so no money moved. Meanwhile `/api/zk/sponsor-execute` bumped
 * `users.roundup_saved_usd` straight from `meta.roundupUsd` off the
 * request body, so the tally climbed on every send while the user's
 * savings stayed at zero. A wallet must never claim money it did not
 * move.
 *
 * ── The shape now ───────────────────────────────────────────────────
 *
 * One row per round-up, created by the SERVER at send-prepare time and
 * walked through a state machine that only ends in `settled` after the
 * supply transaction is found on chain:
 *
 *   intent    send-prepare computed a round-up for a send it is about
 *             to hand out signable bytes for. Amount is SERVER-authored
 *             (`amount = sendAmount × pct/100`), never client-supplied.
 *   prepared  `/api/send/roundup/prepare` built + sponsored the NAVI
 *             supply PTB for that intent and recorded `save_digest`, the
 *             digest the signed TransactionData bytes WILL have.
 *   settled   the digest was read back off chain, status success, sender
 *             = the user, USD stablecoin actually left their address.
 *             This is the ONLY transition that credits a tally.
 *   failed    terminal: the build failed (no balance), the tx aborted,
 *             or the digest verified as something it must not be.
 *   abandoned aged out without ever landing (usually: the user closed
 *             the app between the send and the save).
 *
 * ── Why `save_digest` is written BEFORE the broadcast ────────────────
 *
 * A Sui transaction digest is a hash of the TransactionData bytes, so we
 * know it the moment we finish building. Recording it up front buys two
 * properties that matter on a money path:
 *
 *   • Nothing can be credited off a digest we did not build. Settlement
 *     refuses any digest that isn't the one on the row, so a client
 *     cannot point the tally at some unrelated transaction of its own.
 *   • A save that broadcast but whose response was lost (Onara timeout,
 *     app killed, lambda frozen) still settles: the drain in
 *     `/api/cron/process-roundup-queue` looks the expected digest up on
 *     chain and credits it there. The tally converges on chain state
 *     without the client ever coming back.
 *
 * ── What gets credited, and from what ───────────────────────────────
 *
 *   • `users.roundup_saved_usd` += `min(net, chain-verified outflow)`,
 *     written here, once, gated on the `prepared → settled` UPDATE
 *     winning. `net` is the round-up minus the 1% save treasury fee,
 *     i.e. what actually reached NAVI, not what left the wallet.
 *   • points + `users.lifetime_saved_usd` via `awardForTx`, which
 *     re-verifies the same digest itself and owns the UNIQUE claim key
 *     (`tx:<user>:<saveDigest>:invest`) in `rewards_award_ledger`.
 *
 * The trigger is `invest`, not `roundup`, and that is deliberate. A
 * round-up is now literally a NAVI supply, and `lib/rewards/earn.ts`
 * clamps the `roundup` trigger to `MAX_ROUNDUP_FRACTION` (10%) of the
 * digest it rides on, which was correct while the save was a leg inside
 * the send PTB and is wrong for a standalone save digest: it would
 * credit a tenth of the money that moved. `invest` credits
 * `min(asserted, verified)`, so the ledger figure equals the chain
 * figure. (Cost: 3 pt/$ instead of 5 pt/$. Both are floored at 1 pt, and
 * round-ups are cents, so in practice it is the same 1 pt.)
 */

// ─── Schema ──────────────────────────────────────────────────────────

/** Bump when the DDL below changes. */
const SCHEMA_VERSION = "2026-07-25.1";

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS roundup_saves (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL,
     token TEXT NOT NULL UNIQUE,
     send_digest TEXT,
     save_digest TEXT,
     send_amount_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
     amount_usd DOUBLE PRECISION NOT NULL,
     net_usd DOUBLE PRECISION NOT NULL,
     credited_usd DOUBLE PRECISION,
     status TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     reason TEXT,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL
   )`,
  // ONE save per send. Partial so `intent` rows (no digest yet) don't
  // collide with each other. This index IS the idempotency guarantee for
  // "one send must produce at most one save".
  `CREATE UNIQUE INDEX IF NOT EXISTS roundup_saves_send_digest_uq
     ON roundup_saves(user_id, send_digest) WHERE send_digest IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS roundup_saves_status_idx
     ON roundup_saves(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS roundup_saves_user_idx
     ON roundup_saves(user_id, created_at DESC)`,
];

let _ready: Promise<void> | null = null;

async function doEnsureSchema(): Promise<void> {
  const gate = await schemaVersionGate(
    "roundup_saves_schema_version",
    SCHEMA_VERSION + DDL.join("|")
  );
  if (gate.upToDate) return;
  const c = db();
  for (const stmt of DDL) {
    await c.execute(stmt);
  }
  await gate.stamp();
}

export async function ensureRoundupSaveSchema(): Promise<void> {
  if (!_ready) {
    _ready = doEnsureSchema().catch((e) => {
      _ready = null; // retry on the next call rather than caching the failure
      throw e;
    });
  }
  return _ready;
}

// ─── Policy ──────────────────────────────────────────────────────────

/**
 * Smallest round-up worth supplying, in USD reaching NAVI.
 *
 * Below a cent there is nothing to save: the rewards engine's own
 * `MIN_CREDITED_USD` is $0.01, and a sub-cent NAVI supply is dust that
 * costs Talise a sponsored transaction to move. Sends whose round-up
 * lands under this floor produce NO intent, NO claim in the UI, and no
 * tally movement, rather than a promise we then can't keep.
 */
export const ROUNDUP_MIN_SAVE_USD = 0.01;

/** Log prefix for every line this feature writes. Grep this. */
export const LOG = "[spend-save]";

/** A `prepared` row older than this never landed. Stop waiting. */
const PREPARED_TTL_MS = 30 * 60 * 1000;
/** An `intent` never handed to /roundup/prepare. Usually an abandoned send. */
const INTENT_TTL_MS = 15 * 60 * 1000;
/** Cap on verification retries before a `prepared` row is written off. */
const MAX_ATTEMPTS = 12;

/** Round-up net of the save treasury fee: what actually reaches NAVI. */
export function netSavedUsd(grossUsd: number): number {
  const net = grossUsd * (1 - SAVE_TREASURY_FEE_BPS / 10_000);
  // 6dp is USDsui's on-chain precision; anything finer is not a number
  // the chain can express.
  return Math.floor(net * 1e6) / 1e6;
}

// ─── Rows ────────────────────────────────────────────────────────────

export type RoundupSaveStatus =
  | "intent"
  | "prepared"
  | "settled"
  | "failed"
  | "abandoned";

export type RoundupSaveRow = {
  id: number;
  userId: number;
  token: string;
  sendDigest: string | null;
  saveDigest: string | null;
  sendAmountUsd: number;
  amountUsd: number;
  netUsd: number;
  creditedUsd: number | null;
  status: RoundupSaveStatus;
  attempts: number;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
};

function toRow(r: Record<string, unknown>): RoundupSaveRow {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    token: String(r.token),
    sendDigest: (r.send_digest as string | null) ?? null,
    saveDigest: (r.save_digest as string | null) ?? null,
    sendAmountUsd: Number(r.send_amount_usd ?? 0) || 0,
    amountUsd: Number(r.amount_usd ?? 0) || 0,
    netUsd: Number(r.net_usd ?? 0) || 0,
    creditedUsd: r.credited_usd == null ? null : Number(r.credited_usd),
    status: String(r.status) as RoundupSaveStatus,
    attempts: Number(r.attempts ?? 0) || 0,
    reason: (r.reason as string | null) ?? null,
    createdAt: Number(r.created_at ?? 0) || 0,
    updatedAt: Number(r.updated_at ?? 0) || 0,
  };
}

/**
 * Book the server's intent to round up this send.
 *
 * Called from `/api/send/sponsor-prepare` while it still holds the
 * server-computed round-up amount. Returns the opaque token the client
 * hands back to `/api/send/roundup/prepare`; the client never gets to
 * state an amount anywhere in the flow.
 *
 * Returns null when the round-up is under {@link ROUNDUP_MIN_SAVE_USD}
 * or the write fails, and the caller must then report `roundupUsd: 0`,
 * a round-up we cannot book is a round-up that isn't happening.
 */
export async function createRoundupIntent(opts: {
  userId: number;
  sendAmountUsd: number;
  amountUsd: number;
}): Promise<{ token: string; amountUsd: number; netUsd: number } | null> {
  const gross = Math.floor(opts.amountUsd * 1e6) / 1e6;
  const net = netSavedUsd(gross);
  if (!(net >= ROUNDUP_MIN_SAVE_USD)) return null;

  try {
    await ensureRoundupSaveSchema();
    const token = randomUUID();
    const now = Date.now();
    await db().execute({
      sql: `INSERT INTO roundup_saves
              (user_id, token, send_amount_usd, amount_usd, net_usd,
               status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'intent', ?, ?)`,
      args: [opts.userId, token, opts.sendAmountUsd, gross, net, now, now],
    });
    return { token, amountUsd: gross, netUsd: net };
  } catch (e) {
    console.warn(
      `${LOG} intent write failed user=${opts.userId} amount=${gross}: ${(e as Error).message}`
    );
    return null;
  }
}

export async function roundupSaveByToken(
  userId: number,
  token: string
): Promise<RoundupSaveRow | null> {
  await ensureRoundupSaveSchema();
  const r = await db().execute({
    sql: `SELECT * FROM roundup_saves WHERE token = ? AND user_id = ? LIMIT 1`,
    args: [token, userId],
  });
  const row = r.rows[0];
  return row ? toRow(row) : null;
}

export type ClaimSendResult =
  | { ok: true; row: RoundupSaveRow }
  /** This send already has a save row (any status). Never save twice. */
  | { ok: false; reason: "send-already-saved" }
  | { ok: false; reason: "not-intent" | "not-found" };

/**
 * Bind an `intent` row to the send digest it belongs to.
 *
 * The UNIQUE `(user_id, send_digest)` index is what enforces
 * one-save-per-send: a second intent presenting the same send digest
 * loses the insert and gets `send-already-saved`, whether the first
 * attempt settled, failed, or is still in flight. Retrying the SAME
 * token is fine (the row already carries the digest).
 */
export async function claimSendDigest(opts: {
  userId: number;
  token: string;
  sendDigest: string;
}): Promise<ClaimSendResult> {
  await ensureRoundupSaveSchema();
  const existing = await roundupSaveByToken(opts.userId, opts.token);
  if (!existing) return { ok: false, reason: "not-found" };
  // Anything past `intent` has already had a save built for it (and
  // possibly broadcast). A second prepare on the same token must NOT
  // build a second supply: that is how one send turns into two saves.
  if (existing.status !== "intent") return { ok: false, reason: "not-intent" };

  const now = Date.now();
  try {
    const r = await db().execute({
      sql: `UPDATE roundup_saves
            SET send_digest = ?, updated_at = ?
            WHERE id = ? AND status = 'intent'
            RETURNING *`,
      args: [opts.sendDigest, now, existing.id],
    });
    const row = r.rows[0];
    if (!row) return { ok: false, reason: "not-intent" };
    return { ok: true, row: toRow(row) };
  } catch (e) {
    // Unique-index violation: some other intent already owns this send.
    const msg = (e as Error).message ?? "";
    if (/unique|duplicate/i.test(msg)) {
      console.warn(
        `${LOG} duplicate save refused user=${opts.userId} send=${opts.sendDigest}`
      );
      return { ok: false, reason: "send-already-saved" };
    }
    throw e;
  }
}

/** Record the digest the built-and-sponsored save tx will have. */
export async function markPrepared(opts: {
  id: number;
  saveDigest: string;
}): Promise<void> {
  await db().execute({
    sql: `UPDATE roundup_saves
          SET status = 'prepared', save_digest = ?, updated_at = ?
          WHERE id = ? AND status IN ('intent', 'prepared')`,
    args: [opts.saveDigest, Date.now(), opts.id],
  });
}

/** Terminal failure. Leaves every tally exactly where it was. */
export async function markSaveFailed(
  id: number,
  reason: string,
  status: Extract<RoundupSaveStatus, "failed" | "abandoned"> = "failed"
): Promise<void> {
  await db().execute({
    sql: `UPDATE roundup_saves
          SET status = ?, reason = ?, updated_at = ?
          WHERE id = ? AND status IN ('intent', 'prepared')`,
    args: [status, reason.slice(0, 300), Date.now(), id],
  });
}

// ─── Settlement ──────────────────────────────────────────────────────

export type SettleOutcome =
  /** Chain-confirmed. `creditedUsd` hit `users.roundup_saved_usd`. */
  | { status: "settled"; creditedUsd: number; saveDigest: string }
  /** Not on chain YET. Nothing credited. The cron drain retries. */
  | { status: "pending"; reason: string }
  /** Terminal. Nothing credited, ever. */
  | { status: "failed"; reason: string }
  /** Nothing to do (already settled, unknown row). */
  | { status: "skipped"; reason: string };

/**
 * Turn one `prepared` row into a credited save, or leave it alone.
 *
 * Fails closed at every step: the ONLY path that moves a tally is a
 * digest that (a) is the digest we built, (b) the fullnode has,
 * (c) succeeded, (d) was sent by this user, and (e) shows USD
 * stablecoin actually leaving their address.
 *
 * `verifyRetries` lets the request-time caller wait out fullnode
 * indexing lag (the send rails broadcast optimistically) without
 * turning a normal lag into a failure. The cron drain passes 0 and just
 * comes back later.
 */
export async function settleRoundupSave(opts: {
  userId: number;
  senderAddress: string;
  /** The digest actually broadcast, when the caller has one. */
  digest?: string | null;
  row?: RoundupSaveRow;
  token?: string;
  verifyRetries?: number;
}): Promise<SettleOutcome> {
  await ensureRoundupSaveSchema();

  const row =
    opts.row ??
    (opts.token ? await roundupSaveByToken(opts.userId, opts.token) : null);
  if (!row) return { status: "skipped", reason: "no-row" };
  if (row.status === "settled") {
    return { status: "skipped", reason: "already-settled" };
  }
  if (row.status !== "prepared") {
    return { status: "skipped", reason: `status=${row.status}` };
  }

  const expected = row.saveDigest;
  if (!expected) return { status: "skipped", reason: "no-expected-digest" };
  if (opts.digest && opts.digest !== expected) {
    // The client executed something other than the transaction we built
    // for this round-up. Never credit off it.
    const reason = `digest mismatch: broadcast ${opts.digest} != prepared ${expected}`;
    console.error(`${LOG} REFUSED user=${opts.userId} row=${row.id} ${reason}`);
    await markSaveFailed(row.id, reason);
    return { status: "failed", reason };
  }

  const retries = Math.max(0, Math.min(opts.verifyRetries ?? 0, 3));
  let last: Awaited<ReturnType<typeof verifyDigestForUser>> | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1_200);
    last = await verifyDigestForUser({
      digest: expected,
      senderAddress: opts.senderAddress,
      direction: "out",
    });
    if (last.ok || !last.retryable) break;
  }
  if (!last) return { status: "pending", reason: "not-verified" };

  if (!last.ok) {
    if (last.retryable) {
      const attempts = await bumpAttempts(row.id);
      const aged = Date.now() - row.createdAt > PREPARED_TTL_MS;
      if (aged || attempts >= MAX_ATTEMPTS) {
        const reason = `never landed on chain (${last.reason}: ${last.detail})`;
        console.warn(
          `${LOG} ABANDONED user=${opts.userId} row=${row.id} digest=${expected} ${reason}`
        );
        await markSaveFailed(row.id, reason, "abandoned");
        return { status: "failed", reason };
      }
      return { status: "pending", reason: `${last.reason}: ${last.detail}` };
    }
    const reason = `${last.reason}: ${last.detail}`;
    console.error(
      `${LOG} SAVE_FAILED user=${opts.userId} row=${row.id} digest=${expected} ${reason}`
    );
    await markSaveFailed(row.id, reason);
    return { status: "failed", reason };
  }

  // Chain-verified. Credit no more than what actually moved.
  const creditedUsd = Math.min(row.netUsd, last.tx.amountUsd);
  if (!(creditedUsd > 0)) {
    const reason = `verified outflow ${last.tx.amountUsd} is not creditable`;
    await markSaveFailed(row.id, reason);
    return { status: "failed", reason };
  }

  // The race gate. Only the caller that flips `prepared → settled` may
  // touch a tally; a cron drain and a client confirm landing together is
  // normal and must not credit twice.
  const won = await db().execute({
    sql: `UPDATE roundup_saves
          SET status = 'settled', credited_usd = ?, updated_at = ?
          WHERE id = ? AND status = 'prepared'
          RETURNING id`,
    args: [creditedUsd, Date.now(), row.id],
  });
  if (won.rows.length === 0) {
    return { status: "skipped", reason: "settled-concurrently" };
  }

  await db().execute({
    sql: `UPDATE users
          SET roundup_saved_usd = COALESCE(roundup_saved_usd, 0) + ?
          WHERE id = ?`,
    args: [creditedUsd, row.userId],
  });

  // Points + `lifetime_saved_usd`. `awardForTx` re-reads the same digest
  // from chain and owns its own UNIQUE claim key, so this is safe to
  // reach twice and can never pay twice. It is deliberately NOT awaited
  // into the caller's error path: the money moved and the tally is
  // already right, a points hiccup must not look like a failed save.
  awardForTx({
    userId: row.userId,
    trigger: "invest",
    amountUsd: creditedUsd,
    digest: expected,
    venue: "navi",
  }).catch((e) =>
    console.warn(`${LOG} award failed row=${row.id}: ${(e as Error).message}`)
  );

  console.log(
    `${LOG} SETTLED user=${row.userId} row=${row.id} save=${expected} ` +
      `send=${row.sendDigest ?? "?"} gross=${row.amountUsd} credited=${creditedUsd}`
  );
  return { status: "settled", creditedUsd, saveDigest: expected };
}

async function bumpAttempts(id: number): Promise<number> {
  const r = await db().execute({
    sql: `UPDATE roundup_saves
          SET attempts = attempts + 1, updated_at = ?
          WHERE id = ?
          RETURNING attempts`,
    args: [Date.now(), id],
  });
  return Number(r.rows[0]?.attempts ?? 0) || 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Drain (cron) ────────────────────────────────────────────────────

export type DrainSummary = {
  scanned: number;
  settled: number;
  failed: number;
  stillPending: number;
  abandonedIntents: number;
  creditedUsd: number;
};

/**
 * Settle every `prepared` save that has landed on chain since the last
 * pass, and write off the ones that never will.
 *
 * This is the whole reason the queue exists. A save is signed by the
 * USER's in-session ephemeral key, so the server can never re-broadcast
 * one; what it CAN do (and what the old `roundup_queue` stub could not,
 * having no digest to look for) is reconcile: the row already knows the
 * digest the signed bytes carry, so this pass turns "the save landed but
 * nobody told us" into a credited tally, and "the save never landed"
 * into an honest `abandoned`.
 */
export async function drainRoundupSaves(limit = 25): Promise<DrainSummary> {
  await ensureRoundupSaveSchema();
  const c = db();
  const now = Date.now();

  const summary: DrainSummary = {
    scanned: 0,
    settled: 0,
    failed: 0,
    stillPending: 0,
    abandonedIntents: 0,
    creditedUsd: 0,
  };

  // Intents that never reached /roundup/prepare: the send was abandoned
  // mid-flow, or the client never asked for the save leg. Nothing was
  // ever built or signed, so there is nothing to reconcile.
  const staleIntents = await c.execute({
    sql: `UPDATE roundup_saves
          SET status = 'abandoned', reason = 'intent expired before prepare',
              updated_at = ?
          WHERE status = 'intent' AND created_at < ?
          RETURNING id`,
    args: [now, now - INTENT_TTL_MS],
  });
  summary.abandonedIntents = staleIntents.rows.length;

  // Give a fresh row a few seconds of grace: the client-side confirm is
  // usually faster than this cron and we'd rather not double-read the
  // fullnode for the same digest.
  const rows = await c.execute({
    sql: `SELECT * FROM roundup_saves
          WHERE status = 'prepared' AND save_digest IS NOT NULL
            AND updated_at < ?
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [now - 5_000, limit],
  });

  for (const raw of rows.rows) {
    const row = toRow(raw);
    summary.scanned++;
    const u = await c.execute({
      sql: `SELECT sui_address FROM users WHERE id = ? LIMIT 1`,
      args: [row.userId],
    });
    const addr = (u.rows[0]?.sui_address as string | undefined) ?? "";
    if (!addr) {
      await markSaveFailed(row.id, "user has no sui_address");
      summary.failed++;
      continue;
    }
    try {
      const out = await settleRoundupSave({
        userId: row.userId,
        senderAddress: addr,
        row,
      });
      if (out.status === "settled") {
        summary.settled++;
        summary.creditedUsd += out.creditedUsd;
      } else if (out.status === "failed") {
        summary.failed++;
      } else if (out.status === "pending") {
        summary.stillPending++;
      }
    } catch (e) {
      // A read fault must not stop the pass; the row stays `prepared`
      // and the next run picks it up.
      summary.stillPending++;
      console.warn(
        `${LOG} drain row=${row.id} threw: ${(e as Error).message}`
      );
    }
  }

  return summary;
}
