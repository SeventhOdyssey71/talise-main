import "server-only";

import { db, ensureSchema } from "@/lib/db";

/**
 * Talise Rewards — Savings Goals (Phase 3).
 *
 * A goal is a virtual envelope on top of the user's main NAVI position.
 * The user names a bucket ("Laptop fund"), sets a target USD, and (optionally)
 * a deadline. Adding to a goal in v1 is a TRACKING entry, not an actual
 * on-chain segregation — the dollars sit alongside the rest of the user's
 * NAVI supply. We just bump `savings_goals.current_usd` + mint a
 * `goal_deposit` rewards_event so the user earns 4 pts/$1 (see earn.ts).
 *
 * TODO (post-hackathon): wire goal deposits to a real per-goal NAVI
 * sub-position, so withdrawals can be ringfenced. For v1 the envelope
 * is enough — the user sees the right numbers in the Rewards tab and
 * earns points for the saving behavior.
 *
 * All functions ensure schema on entry — `savings_goals` ships in
 * lib/db.ts (Phase 3 of the original migration) so no extra DDL here.
 */

export type SavingsGoal = {
  id: number;
  userId: number;
  name: string;
  targetUsd: number;
  currentUsd: number;
  deadlineMs: number | null;
  color: string | null;
  createdAt: number;
  archived: boolean;
};

type GoalRow = {
  id: number;
  user_id: number;
  name: string;
  target_usd: number;
  current_usd: number;
  deadline_ms: number | null;
  color: string | null;
  created_at: number;
  archived: number;
};

function rowToGoal(row: GoalRow): SavingsGoal {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: String(row.name),
    targetUsd: Number(row.target_usd) || 0,
    currentUsd: Number(row.current_usd) || 0,
    deadlineMs:
      row.deadline_ms === null || row.deadline_ms === undefined
        ? null
        : Number(row.deadline_ms),
    color: row.color ?? null,
    createdAt: Number(row.created_at),
    archived: Number(row.archived) === 1,
  };
}

/** List the user's goals, newest first. Excludes archived by default. */
export async function listGoals(
  userId: number,
  opts: { includeArchived?: boolean } = {}
): Promise<SavingsGoal[]> {
  await ensureSchema();
  const sql = opts.includeArchived
    ? "SELECT * FROM savings_goals WHERE user_id = ? ORDER BY created_at DESC"
    : "SELECT * FROM savings_goals WHERE user_id = ? AND archived = 0 ORDER BY created_at DESC";
  const r = await db().execute({ sql, args: [userId] });
  return (r.rows as unknown as GoalRow[]).map(rowToGoal);
}

export async function getGoal(
  userId: number,
  id: number
): Promise<SavingsGoal | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: "SELECT * FROM savings_goals WHERE id = ? AND user_id = ? LIMIT 1",
    args: [id, userId],
  });
  const row = (r.rows[0] as unknown as GoalRow) ?? null;
  return row ? rowToGoal(row) : null;
}

/**
 * Create a goal. Sanitises name (trim, length cap) and rejects
 * non-positive target. Returns the freshly persisted row.
 */
export async function createGoal(input: {
  userId: number;
  name: string;
  targetUsd: number;
  deadlineMs?: number | null;
  color?: string | null;
}): Promise<SavingsGoal> {
  await ensureSchema();
  const name = String(input.name ?? "").trim().slice(0, 64);
  if (!name) throw new Error("name is required");
  const targetUsd = Number(input.targetUsd);
  if (!Number.isFinite(targetUsd) || targetUsd <= 0) {
    throw new Error("targetUsd must be positive");
  }
  const c = db();
  const now = Date.now();
  await c.execute({
    sql: `INSERT INTO savings_goals
      (user_id, name, target_usd, current_usd, deadline_ms, color, created_at, archived)
      VALUES (?, ?, ?, 0, ?, ?, ?, 0)`,
    args: [
      input.userId,
      name,
      targetUsd,
      input.deadlineMs ?? null,
      input.color ?? null,
      now,
    ],
  });
  // libsql exposes lastInsertRowid on the result but in a portable way
  // we re-query by the most-recent created_at to stay driver-agnostic.
  const r = await c.execute({
    sql: `SELECT * FROM savings_goals
          WHERE user_id = ? AND created_at = ?
          ORDER BY id DESC LIMIT 1`,
    args: [input.userId, now],
  });
  const row = r.rows[0] as unknown as GoalRow;
  return rowToGoal(row);
}

/**
 * Update a goal's name / target / deadline / color. Fields not present in
 * `patch` are left untouched (COALESCE pattern). Will not flip `archived`
 * — use `archiveGoal` for that.
 */
export async function updateGoal(
  userId: number,
  id: number,
  patch: {
    name?: string;
    targetUsd?: number;
    deadlineMs?: number | null;
    color?: string | null;
  }
): Promise<SavingsGoal | null> {
  await ensureSchema();
  const existing = await getGoal(userId, id);
  if (!existing) return null;
  const name =
    patch.name !== undefined
      ? String(patch.name).trim().slice(0, 64) || existing.name
      : existing.name;
  const targetUsd =
    patch.targetUsd !== undefined &&
    Number.isFinite(Number(patch.targetUsd)) &&
    Number(patch.targetUsd) > 0
      ? Number(patch.targetUsd)
      : existing.targetUsd;
  const deadlineMs =
    patch.deadlineMs === undefined ? existing.deadlineMs : patch.deadlineMs;
  const color = patch.color === undefined ? existing.color : patch.color;
  await db().execute({
    sql: `UPDATE savings_goals
          SET name = ?, target_usd = ?, deadline_ms = ?, color = ?
          WHERE id = ? AND user_id = ?`,
    args: [name, targetUsd, deadlineMs, color, id, userId],
  });
  return getGoal(userId, id);
}

/**
 * Hard ceiling on a single tracking deposit. Mirrors the $10k per-tx earn
 * cap the send routes enforce. A goal deposit moves NO money on-chain (it's
 * a self-reported envelope), so without this an authenticated client could
 * POST any amountUsd and mint 4×amount points — which is exactly how one
 * account reached 1,008,671,212 pts. We clamp the amount itself (not just
 * the points) so `current_usd` can't be inflated to an absurd figure either.
 */
export const GOAL_DEPOSIT_MAX_USD = 10_000;

/**
 * Goal deposits earn ZERO points. The deposit is an UNVERIFIED self-report
 * (no on-chain backing), so any proportional reward is freely farmable — one
 * account rigged it to 1,008,671,212 pts. We keep the deposit as a tracking
 * entry (bumps current_usd, clamped to GOAL_DEPOSIT_MAX_USD) but mint no
 * points. If goal deposits ever move real money on-chain, re-introduce points
 * keyed to the verified transfer, not to a self-reported number.
 */
export async function depositToGoal(input: {
  userId: number;
  goalId: number;
  amountUsd: number;
}): Promise<{ goal: SavingsGoal; points: number }> {
  await ensureSchema();
  const raw = Number(input.amountUsd);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error("amountUsd must be positive");
  }
  // Clamp the tracked amount — defense in depth even against direct callers.
  const amount = Math.min(raw, GOAL_DEPOSIT_MAX_USD);
  const existing = await getGoal(input.userId, input.goalId);
  if (!existing) throw new Error("goal not found");
  if (existing.archived) throw new Error("goal is archived");

  // Goal deposits mint NO points (unverified self-report — see above), and
  // no longer bump the global `lifetime_saved_usd` stat (also farmable via a
  // self-report). The goal's own `current_usd` still tracks the envelope, and
  // a 0-point `goal_deposit` event is written so the activity feed shows the
  // deposit. Atomic batch so balance + feed commit together.
  const points = 0;
  const metaJson = JSON.stringify({
    amountUsd: amount,
    goalId: input.goalId,
  });
  await db().batch(
    [
      {
        sql: `UPDATE savings_goals
              SET current_usd = COALESCE(current_usd, 0) + ?
              WHERE id = ? AND user_id = ?`,
        args: [amount, input.goalId, input.userId],
      },
      {
        sql: `INSERT INTO rewards_events
              (user_id, kind, points, metadata, created_at)
              VALUES (?, 'goal_deposit', ?, ?, ?)`,
        args: [input.userId, points, metaJson, Date.now()],
      },
    ],
    "write"
  );

  const refreshed = (await getGoal(input.userId, input.goalId))!;
  return { goal: refreshed, points };
}

/** Soft-delete: flip `archived = 1`. Goal still readable via `includeArchived`. */
export async function archiveGoal(
  userId: number,
  id: number
): Promise<SavingsGoal | null> {
  await ensureSchema();
  await db().execute({
    sql: "UPDATE savings_goals SET archived = 1 WHERE id = ? AND user_id = ?",
    args: [id, userId],
  });
  return getGoal(userId, id);
}
