import "server-only";

import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { db, ensureSchema, schemaVersionGate } from "@/lib/db";
import { sui, getUsdsuiBalance } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { getChainIdentifier, getCurrentEpoch } from "@/lib/sui-epoch";

/**
 * Programmable money / rules — money that runs itself.
 *
 * A rule pairs a TRIGGER (schedule | on-inflow | threshold) with an ACTION. For
 * launch the only escrow-signed action is `send` (pay a fixed amount to an
 * address on a schedule — "pay rent on the 1st"). `sweep-earn` is OUT for v1
 * (it needs a custom Move call and must therefore be user-signed/sponsored, not
 * gasless server-signed) — it is accepted as a stored value but rejected at
 * create time. `on-inflow` is a stored trigger type whose evaluation is stubbed
 * pending the Phase-3 activity poller.
 *
 * Reuses the proven server-custodied escrow model (mirrors lib/team-streams.ts):
 *   • The user pre-funds a Talise-controlled "Rules Pocket" escrow over the
 *     normal gasless send rail (a `0x2::balance::send_funds<USDSUI>` that credits
 *     the escrow's Address Balance accumulator).
 *   • A Vercel cron (`/api/cron/process-money-rules`) evaluates every due rule
 *     and, when it fires, pays out by signing escrow→recipient `send_funds`
 *     transfers with the server escrow key (`MONEY_RULES_ESCROW_SK`). Gasless:
 *     zero gas price/budget, no gas payment, epoch-bounded expiration — identical
 *     to the team-stream / cheque escrow release recipe.
 *
 * The escrow holds money commingled across rules; the DB is the ledger that
 * bounds each rule's behavior. Gated by MONEY_RULES_ESCROW_SK (unset → feature
 * off, nothing in prod changes).
 */

// ── Escrow key (server-custodied) ───────────────────────────────────────────
let _escrow: Ed25519Keypair | null = null;

export function moneyRulesEnabled(): boolean {
  return !!process.env.MONEY_RULES_ESCROW_SK;
}

function escrowKeypair(): Ed25519Keypair {
  if (_escrow) return _escrow;
  const k = process.env.MONEY_RULES_ESCROW_SK;
  if (!k) throw new Error("MONEY_RULES_ESCROW_SK missing — the money-rules escrow key");
  _escrow = Ed25519Keypair.fromSecretKey(k);
  return _escrow;
}

export function moneyRulesEscrowAddress(): string {
  return escrowKeypair().getPublicKey().toSuiAddress();
}

// ── Constants ────────────────────────────────────────────────────────────────
export const MIN_SEND_MICROS = 10_000n; // 0.01 USDsui — the gasless minimum per leg
export const MAX_SEND_MICROS = 10_000_000_000n; // 10,000 USDsui — per-execution ceiling
const MIN_INTERVAL_MINUTES = 1;
const THRESHOLD_RECHECK_MS = 3_600_000; // re-evaluate threshold/on-inflow rules hourly
const ADDRESS_RE = /^0x[a-f0-9]{64}$/i;

export type TriggerType = "schedule" | "on-inflow" | "threshold";
export type ActionType = "send" | "sweep-earn";
export type RuleState = "active" | "paused" | "deleted";

// ── Schema ─────────────────────────────────────────────────────────────────
let _schemaReady: Promise<void> | null = null;
const SCHEMA_VERSION = "2026-06-28.1";

export function ensureMoneyRulesSchema(): Promise<void> {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    await ensureSchema();
    const c = db();
    const gate = await schemaVersionGate("money_rules_schema_version", SCHEMA_VERSION);
    if (gate.upToDate) return;

    await c.execute(`
      CREATE TABLE IF NOT EXISTS money_rules (
        id                        TEXT PRIMARY KEY,
        user_id                   INTEGER NOT NULL,
        owner_address             TEXT NOT NULL,
        name                      TEXT NOT NULL,
        trigger_type              TEXT NOT NULL,
        schedule_cron             TEXT,
        schedule_interval_minutes BIGINT,
        schedule_day_of_month     INTEGER,
        inflow_min_usd            BIGINT,
        balance_threshold_usd     BIGINT,
        condition_type            TEXT,
        condition_value_micros    BIGINT,
        action_type               TEXT NOT NULL,
        action_config             TEXT NOT NULL DEFAULT '{}',
        state                     TEXT NOT NULL DEFAULT 'active',
        next_due_at               BIGINT,
        execution_count           INTEGER NOT NULL DEFAULT 0,
        last_run_at               BIGINT,
        last_status               TEXT,
        last_error                TEXT,
        created_at                BIGINT NOT NULL,
        updated_at                BIGINT NOT NULL,
        deleted_at                BIGINT
      )
    `);
    await c.execute(`CREATE INDEX IF NOT EXISTS idx_money_rules_user ON money_rules(user_id, created_at DESC)`);
    // Cron read: active rules ordered by their next due time.
    await c.execute(`CREATE INDEX IF NOT EXISTS idx_money_rules_due ON money_rules(state, next_due_at)`);

    // Append-only execution ledger; the unique index is the double-fire guard.
    await c.execute(`
      CREATE TABLE IF NOT EXISTS money_rule_executions (
        id            SERIAL PRIMARY KEY,
        rule_id       TEXT NOT NULL,
        triggered_at  BIGINT NOT NULL,
        action_type   TEXT,
        amount_micros BIGINT,
        recipient     TEXT,
        digests       TEXT,
        status        TEXT NOT NULL,
        error         TEXT,
        created_at    BIGINT NOT NULL
      )
    `);
    await c.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_money_rule_execution ON money_rule_executions(rule_id, triggered_at)`);

    await gate.stamp();
  })().catch((err) => {
    _schemaReady = null;
    throw err;
  });
  return _schemaReady;
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface SendActionConfig {
  toAddress: string;
  toHandle?: string | null;
  amountMicros: string; // BigInt micros as string
}

interface Row {
  id: string;
  user_id: number;
  owner_address: string;
  name: string;
  trigger_type: string;
  schedule_cron: string | null;
  schedule_interval_minutes: number | string | null;
  schedule_day_of_month: number | null;
  inflow_min_usd: number | string | null;
  balance_threshold_usd: number | string | null;
  condition_type: string | null;
  condition_value_micros: number | string | null;
  action_type: string;
  action_config: string;
  state: string;
  next_due_at: number | string | null;
  execution_count: number;
  last_run_at: number | string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: number | string;
  updated_at: number | string;
  deleted_at: number | string | null;
}

export interface MoneyRule {
  id: string;
  userId: number;
  ownerAddress: string;
  name: string;
  triggerType: TriggerType;
  scheduleCron: string | null;
  intervalMinutes: number | null;
  dayOfMonth: number | null;
  inflowMinUsd: number | null;
  balanceThresholdUsd: number | null;
  conditionType: string | null;
  conditionValueUsd: number | null;
  actionType: ActionType;
  actionConfig: Record<string, unknown>;
  state: string;
  nextDueAt: number | null;
  executionCount: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

const usd = (micros: number | string | null) => (micros == null ? null : Number(BigInt(micros)) / 1e6);
const num = (v: number | string | null) => (v == null ? null : Number(v));

function project(row: Row): MoneyRule {
  let actionConfig: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.action_config || "{}");
    if (parsed && typeof parsed === "object") actionConfig = parsed as Record<string, unknown>;
  } catch { /* tolerate */ }
  return {
    id: row.id,
    userId: Number(row.user_id),
    ownerAddress: row.owner_address,
    name: row.name,
    triggerType: row.trigger_type as TriggerType,
    scheduleCron: row.schedule_cron,
    intervalMinutes: num(row.schedule_interval_minutes),
    dayOfMonth: row.schedule_day_of_month == null ? null : Number(row.schedule_day_of_month),
    inflowMinUsd: usd(row.inflow_min_usd),
    balanceThresholdUsd: usd(row.balance_threshold_usd),
    conditionType: row.condition_type,
    conditionValueUsd: usd(row.condition_value_micros),
    actionType: row.action_type as ActionType,
    actionConfig,
    state: row.state,
    nextDueAt: num(row.next_due_at),
    executionCount: Number(row.execution_count),
    lastRunAt: num(row.last_run_at),
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

// ── Schedule math ─────────────────────────────────────────────────────────────

/**
 * Compute the next due timestamp for a rule, measured from `fromMs`.
 *  • schedule + interval     → fromMs + interval
 *  • schedule + day-of-month → the next calendar occurrence of that day (12:00 UTC)
 *  • threshold / on-inflow   → fromMs + hourly recheck
 * Returns null only when a schedule rule has neither an interval nor a DOM (invalid).
 */
export function computeNextDue(rule: {
  triggerType: TriggerType;
  intervalMinutes: number | null;
  dayOfMonth: number | null;
}, fromMs: number): number | null {
  if (rule.triggerType === "schedule") {
    if (rule.intervalMinutes && rule.intervalMinutes >= MIN_INTERVAL_MINUTES) {
      return fromMs + rule.intervalMinutes * 60_000;
    }
    if (rule.dayOfMonth && rule.dayOfMonth >= 1 && rule.dayOfMonth <= 31) {
      return nextDayOfMonth(rule.dayOfMonth, fromMs);
    }
    return null;
  }
  // threshold + on-inflow are polled on a fixed recheck cadence.
  return fromMs + THRESHOLD_RECHECK_MS;
}

/** Next 12:00-UTC timestamp landing on the given day-of-month, strictly after `fromMs`. */
function nextDayOfMonth(dom: number, fromMs: number): number {
  const from = new Date(fromMs);
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth(); // 0-based
  for (let i = 0; i < 14; i++) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(dom, daysInMonth); // clamp 31→28/30 etc.
    const candidate = Date.UTC(year, month, day, 12, 0, 0, 0);
    if (candidate > fromMs) return candidate;
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  // Unreachable in practice; fall back to ~30 days out.
  return fromMs + 30 * 24 * 3_600_000;
}

// ── Create / read / mutate ────────────────────────────────────────────────────
export function newRuleId(): string {
  return `rule_${randomBytes(12).toString("hex")}`;
}

export interface CreateRuleInput {
  userId: number;
  ownerAddress: string;
  name: string;
  triggerType: TriggerType;
  // schedule
  intervalMinutes?: number | null;
  dayOfMonth?: number | null;
  // on-inflow
  inflowMinMicros?: bigint | null;
  // threshold
  balanceThresholdMicros?: bigint | null;
  // action
  actionType: ActionType;
  send?: { toAddress: string; toHandle?: string | null; amountMicros: bigint };
}

/**
 * Insert an ACTIVE rule. The route resolves + screens the recipient before
 * calling this. For launch only `send` is executable; `sweep-earn` is rejected.
 */
export async function createRule(input: CreateRuleInput): Promise<MoneyRule> {
  await ensureMoneyRulesSchema();

  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Give this rule a name.");
  if (name.length > 80) throw new Error("That name is too long.");

  if (input.triggerType !== "schedule" && input.triggerType !== "on-inflow" && input.triggerType !== "threshold") {
    throw new Error("Unknown trigger type.");
  }
  if (input.actionType !== "send" && input.actionType !== "sweep-earn") {
    throw new Error("Unknown action type.");
  }
  if (input.actionType === "sweep-earn") {
    // OUT for v1 — needs a custom Move call (user-signed/sponsored), not gasless server-signed.
    throw new Error("Sweep-to-earn rules aren't available yet.");
  }

  // Validate the schedule (interval OR day-of-month).
  let intervalMinutes: number | null = null;
  let dayOfMonth: number | null = null;
  if (input.triggerType === "schedule") {
    const iv = input.intervalMinutes == null ? null : Number(input.intervalMinutes);
    const dom = input.dayOfMonth == null ? null : Number(input.dayOfMonth);
    if (iv != null && Number.isFinite(iv) && iv >= MIN_INTERVAL_MINUTES) {
      intervalMinutes = Math.floor(iv);
    } else if (dom != null && Number.isInteger(dom) && dom >= 1 && dom <= 31) {
      dayOfMonth = dom;
    } else {
      throw new Error("Choose how often this runs (an interval or a day of the month).");
    }
  }

  // Validate the threshold trigger.
  let balanceThresholdMicros: bigint | null = null;
  if (input.triggerType === "threshold") {
    balanceThresholdMicros = input.balanceThresholdMicros ?? null;
    if (balanceThresholdMicros == null || balanceThresholdMicros <= 0n) {
      throw new Error("Set the balance threshold for this rule.");
    }
  }

  // on-inflow optional minimum.
  const inflowMinMicros = input.triggerType === "on-inflow" ? (input.inflowMinMicros ?? 0n) : null;

  // Validate + serialize the send action.
  if (!input.send) throw new Error("This rule has no payout configured.");
  const to = (input.send.toAddress ?? "").trim().toLowerCase();
  if (!ADDRESS_RE.test(to)) throw new Error("The payout address looks invalid.");
  const amountMicros = input.send.amountMicros;
  if (amountMicros < MIN_SEND_MICROS) throw new Error("The payout amount must be at least 0.01 USDsui.");
  if (amountMicros > MAX_SEND_MICROS) throw new Error("That payout amount is too large.");
  const actionConfig: SendActionConfig = {
    toAddress: to,
    toHandle: input.send.toHandle ?? null,
    amountMicros: amountMicros.toString(),
  };

  const now = Date.now();
  const id = newRuleId();
  const nextDueAt = computeNextDue({ triggerType: input.triggerType, intervalMinutes, dayOfMonth }, now);

  await db().execute({
    sql: `INSERT INTO money_rules
            (id, user_id, owner_address, name, trigger_type,
             schedule_interval_minutes, schedule_day_of_month,
             inflow_min_usd, balance_threshold_usd,
             action_type, action_config, state, next_due_at,
             execution_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
    args: [
      id, input.userId, input.ownerAddress, name, input.triggerType,
      intervalMinutes == null ? null : intervalMinutes,
      dayOfMonth == null ? null : dayOfMonth,
      inflowMinMicros == null ? null : inflowMinMicros.toString(),
      balanceThresholdMicros == null ? null : balanceThresholdMicros.toString(),
      input.actionType, JSON.stringify(actionConfig), nextDueAt, now, now,
    ],
  });
  return getRule(id, input.userId) as Promise<MoneyRule>;
}

export async function getRule(id: string, userId: number): Promise<MoneyRule | null> {
  await ensureMoneyRulesSchema();
  const r = await db().execute({
    sql: "SELECT * FROM money_rules WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1",
    args: [id, userId],
  });
  const row = r.rows[0] as unknown as Row | undefined;
  return row ? project(row) : null;
}

export async function listRules(userId: number): Promise<MoneyRule[]> {
  await ensureMoneyRulesSchema();
  const r = await db().execute({
    sql: "SELECT * FROM money_rules WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",
    args: [userId],
  });
  return (r.rows as unknown as Row[]).map(project);
}

export async function pauseRule(id: string, userId: number): Promise<MoneyRule | null> {
  await ensureMoneyRulesSchema();
  await db().execute({
    sql: `UPDATE money_rules SET state = 'paused', updated_at = ?
           WHERE id = ? AND user_id = ? AND state = 'active' AND deleted_at IS NULL`,
    args: [Date.now(), id, userId],
  });
  return getRule(id, userId);
}

export async function resumeRule(id: string, userId: number): Promise<MoneyRule | null> {
  await ensureMoneyRulesSchema();
  // Re-arm next_due_at from now so a long-paused rule doesn't fire a backlog at once.
  const rule = await getRule(id, userId);
  if (!rule) return null;
  if (rule.state !== "paused") return rule;
  const nextDueAt = computeNextDue(rule, Date.now());
  await db().execute({
    sql: `UPDATE money_rules SET state = 'active', next_due_at = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND state = 'paused' AND deleted_at IS NULL`,
    args: [nextDueAt, Date.now(), id, userId],
  });
  return getRule(id, userId);
}

/** Soft-delete: the cron only ever reads state='active' AND deleted_at IS NULL. */
export async function deleteRule(id: string, userId: number): Promise<boolean> {
  await ensureMoneyRulesSchema();
  const now = Date.now();
  const r = await db().execute({
    sql: `UPDATE money_rules SET state = 'deleted', deleted_at = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    args: [now, now, id, userId],
  });
  return (r.rowsAffected ?? 0) > 0;
}

// ── Evaluation engine (cron) ──────────────────────────────────────────────────

/**
 * Evaluate every due active rule. Each rule is claimed atomically (advance
 * `next_due_at` via a guarded UPDATE keyed on the OLD due time) before any
 * payout, so a concurrent/duplicate cron can never double-fire. Returns a
 * summary for the cron.
 */
export async function evaluateDueRules(nowMs: number = Date.now()): Promise<{ processed: number; fired: number; errors: number }> {
  await ensureMoneyRulesSchema();
  const due = await db().execute({
    sql: `SELECT * FROM money_rules
           WHERE state = 'active' AND deleted_at IS NULL
             AND next_due_at IS NOT NULL AND next_due_at <= ?
           ORDER BY next_due_at ASC LIMIT 50`,
    args: [nowMs],
  });
  let processed = 0, fired = 0, errors = 0;
  for (const raw of due.rows as unknown as Row[]) {
    processed++;
    try {
      if (await evaluateOneRule(project(raw))) fired++;
    } catch (err) {
      errors++;
      console.warn(`[money-rules] evaluation failed for ${raw.id}: ${(err as Error).message}`);
    }
  }
  return { processed, fired, errors };
}

async function evaluateOneRule(rule: MoneyRule): Promise<boolean> {
  const oldDue = rule.nextDueAt;
  if (oldDue == null) return false;
  const now = Date.now();
  const newDue = computeNextDue(rule, now);

  // CLAIM: only the worker that flips next_due_at off the value it read proceeds.
  const claim = await db().execute({
    sql: `UPDATE money_rules
             SET next_due_at = ?, last_run_at = ?, updated_at = ?
           WHERE id = ? AND state = 'active' AND deleted_at IS NULL AND next_due_at = ?`,
    args: [newDue, now, now, rule.id, oldDue],
  });
  if ((claim.rowsAffected ?? 0) === 0) return false; // someone else claimed it

  // ── Trigger gating ──────────────────────────────────────────────────────────
  if (rule.triggerType === "on-inflow") {
    // TODO(P3): the activity poller fires on-inflow rules. Until then this is a
    // no-op — the claim above already advanced next_due_at for the next recheck.
    await recordExecution(rule, oldDue, "skipped", null, null, "on-inflow poller not yet wired");
    return false;
  }

  if (rule.triggerType === "threshold") {
    const thresholdMicros = rule.balanceThresholdUsd == null ? null : BigInt(Math.round(rule.balanceThresholdUsd * 1e6));
    if (thresholdMicros == null) {
      await recordExecution(rule, oldDue, "skipped", null, null, "no threshold set");
      return false;
    }
    let balRaw = "0";
    try { balRaw = (await getUsdsuiBalance(rule.ownerAddress)).raw; } catch { balRaw = "0"; }
    if (BigInt(balRaw) < thresholdMicros) {
      await recordExecution(rule, oldDue, "skipped", null, null, "below threshold");
      return false;
    }
  }

  // ── Action ────────────────────────────────────────────────────────────────
  if (rule.actionType !== "send") {
    await recordExecution(rule, oldDue, "skipped", null, null, `unsupported action: ${rule.actionType}`);
    return false;
  }

  const cfg = rule.actionConfig as Partial<SendActionConfig>;
  const to = (cfg.toAddress ?? "").trim().toLowerCase();
  const amountMicros = cfg.amountMicros ? BigInt(cfg.amountMicros) : 0n;
  if (!ADDRESS_RE.test(to) || amountMicros < MIN_SEND_MICROS) {
    await recordExecution(rule, oldDue, "skipped", to || null, amountMicros, "invalid payout config");
    return false;
  }

  try {
    const digests = await escrowSendFunds(rule.id, `rule:${rule.executionCount}`, [{ address: to, micros: amountMicros }]);
    await recordExecution(rule, oldDue, "ok", to, amountMicros, null, digests);
    await db().execute({
      sql: `UPDATE money_rules
               SET execution_count = execution_count + 1, last_status = 'ok', last_error = NULL, updated_at = ?
             WHERE id = ?`,
      args: [Date.now(), rule.id],
    });
    return true;
  } catch (err) {
    const msg = (err as Error).message ?? "payout failed";
    await recordExecution(rule, oldDue, "error", to, amountMicros, msg);
    await db().execute({
      sql: `UPDATE money_rules SET last_status = 'error', last_error = ?, updated_at = ? WHERE id = ?`,
      args: [msg.slice(0, 500), Date.now(), rule.id],
    });
    return false;
  }
}

/** Append-only ledger write; idempotent on (rule_id, triggered_at). */
async function recordExecution(
  rule: MoneyRule,
  triggeredAt: number,
  status: "ok" | "error" | "skipped",
  recipient: string | null,
  amountMicros: bigint | null,
  error: string | null,
  digests?: string[],
): Promise<void> {
  await db().execute({
    sql: `INSERT INTO money_rule_executions
            (rule_id, triggered_at, action_type, amount_micros, recipient, digests, status, error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (rule_id, triggered_at) DO NOTHING`,
    args: [
      rule.id, triggeredAt, rule.actionType,
      amountMicros == null ? null : amountMicros.toString(),
      recipient, digests ? JSON.stringify(digests) : null,
      status, error ? error.slice(0, 500) : null, Date.now(),
    ],
  });
}

export async function listRuleExecutions(ruleId: string, userId: number, limit = 50): Promise<Array<{
  triggeredAt: number;
  actionType: string | null;
  amountUsd: number | null;
  recipient: string | null;
  status: string;
  error: string | null;
  digests: string[];
  createdAt: number;
}>> {
  await ensureMoneyRulesSchema();
  // Ownership gate: only return executions for a rule the caller owns.
  const owns = await getRule(ruleId, userId);
  if (!owns) return [];
  const r = await db().execute({
    sql: `SELECT triggered_at, action_type, amount_micros, recipient, digests, status, error, created_at
            FROM money_rule_executions WHERE rule_id = ? ORDER BY triggered_at DESC LIMIT ?`,
    args: [ruleId, Math.min(Math.max(limit, 1), 200)],
  });
  return (r.rows as unknown as Array<{
    triggered_at: number | string;
    action_type: string | null;
    amount_micros: number | string | null;
    recipient: string | null;
    digests: string | null;
    status: string;
    error: string | null;
    created_at: number | string;
  }>).map((row) => {
    let digests: string[] = [];
    try { const p = JSON.parse(row.digests || "[]"); if (Array.isArray(p)) digests = p as string[]; } catch { /* tolerate */ }
    return {
      triggeredAt: Number(row.triggered_at),
      actionType: row.action_type,
      amountUsd: row.amount_micros == null ? null : Number(BigInt(row.amount_micros)) / 1e6,
      recipient: row.recipient,
      status: row.status,
      error: row.error,
      digests,
      createdAt: Number(row.created_at),
    };
  });
}

// ── Gasless escrow payout ─────────────────────────────────────────────────────

/**
 * Sign + submit one gasless escrow `send_funds` per leg with the server escrow key.
 * Mirrors lib/team-streams.ts::escrowSendFunds exactly (zero gas, epoch-bounded
 * expiration, empty gas payment). One tx per leg — the gasless rail permits a
 * single send_funds.
 */
async function escrowSendFunds(
  ruleId: string,
  ref: string,
  legs: Array<{ address: string; micros: bigint }>,
): Promise<string[]> {
  const kp = escrowKeypair();
  const sender = kp.getPublicKey().toSuiAddress();
  const client = sui();
  const [chainId, currentEpoch] = await Promise.all([getChainIdentifier(), getCurrentEpoch()]);
  const epoch = BigInt(currentEpoch);
  const digests: string[] = [];

  for (const leg of legs) {
    if (leg.micros < MIN_SEND_MICROS) continue;
    const tx = new Transaction();
    tx.setSender(sender);
    tx.moveCall({
      target: "0x2::balance::send_funds",
      typeArguments: [USDSUI_TYPE],
      arguments: [tx.balance({ type: USDSUI_TYPE, balance: leg.micros }), tx.pure.address(leg.address)],
    });
    tx.setGasPrice(0n);
    tx.setGasBudget(0n);
    tx.setExpiration({
      ValidDuring: {
        minEpoch: String(epoch),
        maxEpoch: String(epoch + 1n),
        minTimestamp: null,
        maxTimestamp: null,
        chain: chainId,
        nonce: randomBytes(4).readUInt32BE(0),
      },
    });
    tx.setGasPayment([]);
    const bytes = await tx.build({ client: client as never });
    const { signature } = await kp.signTransaction(bytes);
    const result = (await client.executeTransaction({
      transaction: fromBase64(Buffer.from(bytes).toString("base64")),
      signatures: [signature],
    })) as Record<string, unknown>;
    const inner =
      (result.Transaction as { digest?: string } | undefined) ??
      (result.FailedTransaction as { digest?: string } | undefined);
    const digest = (result.digest as string | undefined) ?? inner?.digest;
    if (!digest || (result.$kind as string | undefined) === "FailedTransaction") {
      throw new Error(`money-rule payout failed (${ref}) → ${leg.address}`);
    }
    digests.push(digest);
  }
  return digests;
}
