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
 * Tracking-only deposit. Bumps current_usd + mints a rewards_event via
 * the canonical earn engine (4 pts/$1, `trigger: "goal"`).
 *
 * The amount must be > 0. We DON'T cap at the goal's target — letting
 * users overshoot is fine and matches how real piggy-banks behave.
 */
export async function depositToGoal(input: {
  userId: number;
  goalId: number;
  amountUsd: number;
}): Promise<{ goal: SavingsGoal; points: number }> {
  await ensureSchema();
  const amount = Number(input.amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amountUsd must be positive");
  }
  const existing = await getGoal(input.userId, input.goalId);
  if (!existing) throw new Error("goal not found");
  if (existing.archived) throw new Error("goal is archived");

  // Atomic — earlier revision did the `UPDATE savings_goals` then
  // called `awardForTx` separately, so a server crash between them
  // could leave the goal bumped without the points event (or vice
  // versa). Now all four writes commit together: goal balance bump,
  // rewards_events row, users.points_total bump, lifetime_saved_usd
  // bump. Same statement set awardForTx + recordRewardsEvent perform
  // internally, just hoisted into one libsql batch.
  const GOAL_POINTS_PER_USD = 4;
  const points = Math.floor(amount * GOAL_POINTS_PER_USD);
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
      {
        sql: "UPDATE users SET points_total = COALESCE(points_total, 0) + ? WHERE id = ?",
        args: [points, input.userId],
      },
      {
        sql: "UPDATE users SET lifetime_saved_usd = COALESCE(lifetime_saved_usd, 0) + ? WHERE id = ?",
        args: [amount, input.userId],
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
