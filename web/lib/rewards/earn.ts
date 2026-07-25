import "server-only";

import { db, ensureSchema, userById, type User } from "@/lib/db";
import {
  DAILY_EARN_POINTS_CAP,
  PENDING_AWARD_TTL_MS,
} from "@/lib/rewards-constants";
import {
  attachDigest,
  claimAward,
  digestReserved,
  digestUsage,
  ensureRewardsIntegritySchema,
  markRejected,
  markSettled,
  moneyPointsSettledSince,
  pendingAwards,
  utcDayStart,
  writeRewardsEvent,
  type LedgerRow,
} from "./integrity";
import { inviterAddress, maybeAwardActivation } from "./referral";
import {
  recentCandidateDigests,
  verifyDigestForUser,
  type MoneyDirection,
} from "./verify";

/**
 * Talise Rewards, earn engine.
 *
 * Wires up the "you spend, you earn" loop. Called from
 * `/api/zk/sponsor-execute`, `/api/send/gasless-submit` and
 * `/api/send/gasless-confirm` after the rail believes the money moved.
 *
 * ── Earn rules ─────────────────────────────────────────────────────
 *
 *   send      → 1  pt per $1 outbound  (`kind: "send_earn"`)
 *   invest    → 3  pts per $1 supplied (`kind: "save_earn"`)
 *   withdraw  → 0  pts                 (`kind: "withdraw_earn"`, logged)
 *   roundup   → 5  pts per $1 swept    (`kind: "roundup_save"`)
 *   goal      → 0  pts                 (`kind: "goal_deposit"`, logged)
 *   swap      → 1  pt  per $1 converted(`kind: "swap_earn"`)
 *
 * Rates are biased toward saving: sends are the funnel, saves are the
 * behavior we want to reinforce. `POINT_RATES` is exported so iOS can
 * render "earn 3 pts per $1 saved" without duplicating the values.
 *
 * ── ISSUANCE INTEGRITY (2026-07-25) ────────────────────────────────
 *
 * The version of this file before today computed points as
 * `Math.floor(opts.amountUsd * rate)` where `amountUsd` came from
 * `meta.amountUsd` in the REQUEST BODY, clamped only by a per-call
 * $10,000 ceiling, and its own JSDoc said "we DON'T dedupe by digest
 * here". That is a faucet with two taps:
 *
 *   • Self-report. `POST /api/send/gasless-confirm` with
 *     `{digest: <any real digest>, meta: {kind: "invest", amountUsd: 10000}}`
 *     minted 30,000 pts for nothing. It's the same shape of bug that let
 *     one account reach 1,008,671,212 pts through the `goal` trigger.
 *   • Replay. No idempotency key anywhere, so any retry (or a loop)
 *     credited again. The only guard was a 60s in-memory Map in one of
 *     the three routes.
 *
 * Both are closed here, and they are closed in THIS module rather than
 * in the routes because the routes are shared surface: fixing one leaves
 * the other two open. The contract is now:
 *
 *   1. A client-asserted amount is an upper bound on a REQUEST, never a
 *      source of value. Points are paid on
 *      `min(asserted, chain-verified, per-digest headroom)`.
 *   2. Verification (lib/rewards/verify.ts) requires a successful tx
 *      whose SENDER is the awarded user, and reads the user's own NET
 *      USD-stablecoin delta out of `balanceChanges`.
 *   3. Every award takes a UNIQUE `claim_key` in `rewards_award_ledger`
 *      before any points move, so retries and concurrent lambdas can
 *      never double-credit.
 *   4. A digest can fund at most one PRIMARY trigger (+ its round-up
 *      leg) and at most one account, so the same $100 can't be claimed
 *      as send+invest+swap for 5x the rate.
 *   5. Unverifiable is unpaid. Nothing here fails open.
 *
 * ── Deferred settlement, and why points can lag one action ─────────
 *
 * The send rails broadcast with `waitForExecution: false`, so an award
 * usually fires BEFORE the fullnode has indexed the tx, and
 * `/api/zk/sponsor-execute` passes `digest: undefined` outright (its own
 * comment says "filled below once we extract it" — it never is, and that
 * route is owned by another work stream). So `awardForTx` books the award
 * as `pending`, tries to verify once, and otherwise leaves it for a later
 * pass. Pending rows are settled:
 *
 *   • at the top of the next `awardForTx` call for that user, and
 *   • best-effort from `getRewardsExtras` (the rewards-summary read,
 *     i.e. app-open), throttled per user.
 *
 * No cron, same "clients fire due work on app-open" model the money-rules
 * engine uses. A row that never verifies inside PENDING_AWARD_TTL_MS
 * expires unpaid.
 */

/** What kind of motion triggered the earn. Maps 1:1 to the iOS TxKind. */
export type EarnTrigger = "send" | "invest" | "withdraw" | "roundup" | "goal" | "swap";

/**
 * Points-per-USD rates keyed by trigger.
 */
export const POINT_RATES: Record<EarnTrigger, number> = {
  send: 1,
  invest: 3,
  withdraw: 0,
  roundup: 5,
  // Goal deposits earn NOTHING. A goal deposit is an UNVERIFIED self-report
  // (no money moves on-chain), so awarding points for it is freely farmable -
  // one account rigged it to 1,008,671,212 pts. Tracking still works; points
  // don't. (Closes the "goal" trigger on sponsor-execute too.)
  //
  // Verification now exists (lib/rewards/verify.ts), so IF goal deposits are
  // ever moved into the on-chain GoalVault, this can be re-enabled - but only
  // keyed to the verified vault transfer, never to the self-reported number.
  goal: 0,
  // Auto-swap into USDsui (Cetus), reward the conversion that puts the
  // user into the spendable/savable stablecoin. 1 pt per $1 converted.
  swap: 1,
};

/**
 * Which way money must move on chain for a trigger to be worth points.
 * A "send" whose net USD delta is positive is not a send.
 */
const TRIGGER_DIRECTION: Record<EarnTrigger, MoneyDirection> = {
  send: "out",
  invest: "out",
  roundup: "out",
  goal: "out",
  swap: "in",
  withdraw: "in",
};

/**
 * Triggers that may be claimed at most ONCE per digest.
 *
 * `roundup` is excluded because a Spend-and-Save PTB legitimately
 * contains two legs (the send and the NAVI supply) under one digest, and
 * both are credited. Everything else is a primary claim: allowing two
 * would let a client re-submit the same $100 digest as `invest` (3 pt/$)
 * and `swap` (1 pt/$) on top of `send` (1 pt/$) and earn 5x the rate on
 * one movement of money.
 */
const PRIMARY_TRIGGER_LIST = [
  "send",
  "invest",
  "withdraw",
  "goal",
  "swap",
] as const;
const PRIMARY_TRIGGERS: ReadonlySet<string> = new Set(PRIMARY_TRIGGER_LIST);

/**
 * A round-up leg can never be more than 10% of the transaction it rides
 * on: `roundup_percentage` is clamped to 1-10 in lib/rewards/roundup.ts,
 * so the swept amount is at most 10% of the send (< 10% of the PTB's
 * total outflow).
 *
 * Without this, `meta.roundupUsd` — which the sponsor-execute route reads
 * straight off the request body, despite a comment claiming a lying
 * client "will fail Sui validation" (nothing cross-checks it against the
 * signed PTB) — could claim the WHOLE verified outflow at the round-up
 * rate of 5 pt/$1 instead of the send rate of 1 pt/$1. The headroom check
 * already bounds it to real money; this bounds the rate too.
 */
const MAX_ROUNDUP_FRACTION = 0.1;

/**
 * Smallest verified amount worth a point.
 *
 * Because a positive verified amount always earns at least 1 pt (the
 * corridor's typical send is well under $1), a DUST send would otherwise
 * be worth a point too — and on a gasless rail dust costs the user
 * nothing, so "1 pt per dust tx" is a farm bounded only by how fast they
 * can call the API. One cent is below any real Talise payment and above
 * any economically-interesting dust.
 */
const MIN_CREDITED_USD = 0.01;

/**
 * Ceiling on the client-asserted amount for a single award. The routes
 * already clamp to this; repeated here because this module must hold on
 * its own (`lib/rewards/roundup.ts` and any future caller come straight
 * in). Not a security control by itself, the chain check is.
 */
const ASSERTED_CEILING_USD = 10_000;

/**
 * How far apart a deferred award and a candidate on-chain tx may be
 * before we refuse to match them. 15 minutes: generous for a slow
 * client/RPC, tight enough that a pending row can't hoover up an
 * unrelated transaction from later in the day.
 */
const DEFERRED_MATCH_WINDOW_MS = 15 * 60 * 1000;

/** Bound on the work one settlement pass may do. */
const MAX_PENDING_PER_PASS = 5;
const MAX_CANDIDATES_PER_PASS = 8;
const MAX_VERIFY_CALLS_PER_PASS = 4;

/**
 * Mint points for a settled tx.
 *
 * Returns the points awarded RIGHT NOW. Zero is a normal, expected
 * outcome: a 0-rate trigger, an award still awaiting chain verification,
 * a duplicate claim, or a policy cap. No caller surfaces this number to
 * a client today (sponsor-execute / gasless-* all ignore it), so a
 * deferred settle is invisible to the user beyond points appearing a
 * moment later.
 */
export async function awardForTx(opts: {
  userId: number;
  trigger: EarnTrigger;
  /** Client-asserted USD. An UPPER BOUND on the request, never a value. */
  amountUsd: number;
  /** Tx digest. Required for any points-bearing trigger to ever settle. */
  digest?: string;
  /** Venue (`navi`, `deepbook`) for invest/withdraw, optional. */
  venue?: string;
}): Promise<{ points: number }> {
  await ensureSchema();
  await ensureRewardsIntegritySchema();

  // Guard: zero/negative amount → no-op (don't write a noise row).
  if (!(opts.amountUsd > 0)) return { points: 0 };

  const rate = POINT_RATES[opts.trigger] ?? 0;
  const asserted = Math.min(opts.amountUsd, ASSERTED_CEILING_USD);

  const kind = eventKindFor(opts.trigger);

  // ── Zero-rate triggers: feed row only ────────────────────────────
  // `withdraw` and `goal` mint no points, so there is nothing to inflate
  // and nothing to verify. We still write the activity row (it's the
  // Rewards feed's source of truth) but we do NOT touch the lifetime
  // tallies from it: those render as money figures in the UI and an
  // unverified number has no business being one.
  if (rate <= 0) {
    await writeRewardsEvent({
      userId: opts.userId,
      kind,
      points: 0,
      metadata: {
        amountUsd: asserted,
        ...(opts.digest ? { digest: opts.digest } : {}),
        ...(opts.venue ? { venue: opts.venue } : {}),
        verified: false,
      },
    });
    return { points: 0 };
  }

  // ── Claim the award (idempotency) ────────────────────────────────
  const claimKey = opts.digest
    ? `tx:${opts.userId}:${opts.digest}:${opts.trigger}`
    : deferredClaimKey(opts.userId, opts.trigger, asserted);
  const row = await claimAward({
    userId: opts.userId,
    triggerKind: opts.trigger,
    claimKey,
    digest: opts.digest ?? null,
    assertedUsd: asserted,
  });
  if (!row) {
    // Someone already owns this key: a route retry, a double-submit, or
    // (in the deferred case) the same award inside the same minute.
    return { points: 0 };
  }

  const user = await userById(opts.userId);
  if (!user) {
    await markRejected(row.id, "user not found");
    return { points: 0 };
  }

  // Settle anything left pending from an earlier action. Deliberately
  // AFTER the claim above: the new row has already reserved its digest,
  // so an older digest-less award can't wander off and match the
  // transaction this call is about.
  await settlePendingAwards(opts.userId, { excludeId: row.id }).catch((e) =>
    console.warn(
      `[rewards/earn] backlog settle failed (user=${opts.userId}):`,
      (e as Error).message
    )
  );

  const points = await settleOne(row, user, opts.venue);
  return { points };
}

/** `rewards_events.kind` for a trigger. */
function eventKindFor(trigger: EarnTrigger): string {
  switch (trigger) {
    case "send":
      return "send_earn";
    case "invest":
      return "save_earn";
    case "withdraw":
      return "withdraw_earn";
    case "roundup":
      return "roundup_save";
    case "swap":
      return "swap_earn";
    case "goal":
    default:
      return "goal_deposit";
  }
}

/**
 * Idempotency key for an award booked WITHOUT a digest.
 *
 * `${user}:${trigger}:${minute}:${cents}` — a route retry inside the same
 * minute collapses onto one award, which is the behavior we want. The
 * trade-off is that two genuinely distinct transactions of the identical
 * amount, same trigger, same minute also collapse and the second earns
 * nothing. That is the conservative direction to fail in, and it stops
 * being possible at all once the caller passes a digest.
 */
function deferredClaimKey(
  userId: number,
  trigger: EarnTrigger,
  amountUsd: number
): string {
  const minute = Math.floor(Date.now() / 60_000);
  const cents = Math.round(amountUsd * 100);
  return `deferred:${userId}:${trigger}:${minute}:${cents}`;
}

/**
 * Try to turn one claimed row into points. Never throws for policy
 * reasons; returns the points minted (0 when left pending or rejected).
 */
async function settleOne(
  row: LedgerRow,
  user: User,
  venue?: string
): Promise<number> {
  const trigger = row.trigger_kind as EarnTrigger;
  const direction = TRIGGER_DIRECTION[trigger] ?? "out";
  const rate = POINT_RATES[trigger] ?? 0;
  if (rate <= 0) {
    await markRejected(row.id, `trigger ${trigger} has rate 0`);
    return 0;
  }

  // ── Resolve a digest ─────────────────────────────────────────────
  let digest = row.digest;
  if (!digest) {
    const found = await findDeferredDigest(row, user, direction);
    if (!found) {
      if (Date.now() - row.created_at > PENDING_AWARD_TTL_MS) {
        await markRejected(
          row.id,
          "expired: no verifiable on-chain tx found",
          "expired"
        );
      }
      return 0;
    }
    digest = found;
    await attachDigest(row.id, digest);
  }

  // ── Verify on chain ──────────────────────────────────────────────
  const v = await verifyDigestForUser({
    digest,
    senderAddress: user.sui_address,
    direction,
  });
  if (!v.ok) {
    if (v.retryable) {
      if (Date.now() - row.created_at > PENDING_AWARD_TTL_MS) {
        await markRejected(row.id, `expired: ${v.reason} ${v.detail}`, "expired");
      }
      return 0;
    }
    await markRejected(row.id, `${v.reason}: ${v.detail}`);
    return 0;
  }

  // ── Per-digest guards ────────────────────────────────────────────
  const usage = await digestUsage(digest);
  const otherAccounts = usage.userIds.filter((id) => id !== user.id);
  if (otherAccounts.length > 0) {
    // One transaction cannot bankroll two accounts' points, even though
    // the sender check means it was this user's own tx (an address can be
    // shared across accounts via a re-created zkLogin identity).
    await markRejected(
      row.id,
      `digest already credited to user(s) ${otherAccounts.join(",")}`
    );
    return 0;
  }
  if (PRIMARY_TRIGGERS.has(trigger)) {
    const primaryTaken = usage.triggers.some((t) => PRIMARY_TRIGGERS.has(t));
    if (primaryTaken) {
      await markRejected(
        row.id,
        `digest already claimed a primary trigger (${usage.triggers.join(",")})`
      );
      return 0;
    }
  }
  const headroomUsd = Math.max(v.tx.amountUsd - usage.creditedUsd, 0);
  if (!(headroomUsd > 0)) {
    await markRejected(
      row.id,
      `no headroom: verified ${v.tx.amountUsd} already credited ${usage.creditedUsd}`
    );
    return 0;
  }

  // The credited amount is the smallest of: what the client claimed,
  // what the chain says moved, what's left unclaimed on this digest, and
  // (for a round-up leg) the 10% ceiling a round-up can structurally be.
  const bounds = [row.asserted_usd, v.tx.amountUsd, headroomUsd];
  if (trigger === "roundup") {
    bounds.push(v.tx.amountUsd * MAX_ROUNDUP_FRACTION);
  }
  const creditedUsd = Math.min(...bounds);
  if (creditedUsd < MIN_CREDITED_USD) {
    await markRejected(
      row.id,
      `below minimum: credited ${creditedUsd} < ${MIN_CREDITED_USD}`
    );
    return 0;
  }

  // ── Daily cap ────────────────────────────────────────────────────
  let points = Math.floor(creditedUsd * rate);
  // Sub-$1 actions are the realistic case for the African remittance
  // corridor (typical sends ~$0.04-$5), so a positive verified amount
  // always earns at least 1 pt rather than rounding to nothing.
  if (points < 1) points = 1;

  const paidToday = await moneyPointsSettledSince(user.id, utcDayStart());
  const remaining = Math.max(DAILY_EARN_POINTS_CAP - paidToday, 0);
  if (remaining <= 0) {
    await markRejected(
      row.id,
      `daily earn cap reached (${paidToday}/${DAILY_EARN_POINTS_CAP})`
    );
    return 0;
  }
  const capped = Math.min(points, remaining);

  // ── Qualifying volume (referral anti-circularity) ────────────────
  // Money that flows straight back to the user's own inviter does not
  // count toward referral qualification. Inviter funds referee, referee
  // "sends" it back, both collect: that's the cheapest circular farm on
  // a gasless rail, and it dies here.
  let qualifyingUsd = creditedUsd;
  if (user.referred_by_user_id) {
    const invAddr = await inviterAddress(user.id);
    if (invAddr && v.tx.recipients.includes(invAddr)) {
      qualifyingUsd = 0;
    }
  }

  // ── Pay ──────────────────────────────────────────────────────────
  // `markSettled` is the race gate: only the pass that flips the row out
  // of `pending` mints anything. Two settlement passes over one row (a
  // send and an app-open arriving together) is normal.
  const won = await markSettled({
    id: row.id,
    verifiedUsd: v.tx.amountUsd,
    creditedUsd,
    qualifyingUsd,
    points: capped,
    reason: capped < points ? `daily cap trimmed ${points}→${capped}` : null,
  });
  if (!won) return 0;
  await writeRewardsEvent({
    userId: user.id,
    kind: eventKindFor(trigger),
    points: capped,
    metadata: {
      amountUsd: creditedUsd,
      assertedUsd: row.asserted_usd,
      verifiedUsd: v.tx.amountUsd,
      digest,
      ...(venue ? { venue } : {}),
      verified: true,
    },
  });
  await bumpLifetimeTallies(user.id, trigger, creditedUsd);

  // Activation awards (personal first send + referral) hang off the
  // FIRST verified money movement, never off a signup.
  if (qualifyingUsd > 0) {
    try {
      const activation = await maybeAwardActivation({
        userId: user.id,
        digest,
      });
      if (activation.skipped.length > 0) {
        console.log(
          `[rewards/earn] activation user=${user.id} skipped: ${activation.skipped.join(", ")}`
        );
      }
    } catch (e) {
      // The money award is already booked; an activation hiccup must not
      // roll it back or throw into a fire-and-forget caller.
      console.warn(
        `[rewards/earn] activation failed (user=${user.id}):`,
        (e as Error).message
      );
    }
  }

  return capped;
}

/**
 * Find the on-chain transaction a digest-less award belongs to.
 *
 * Discovery is untrusted: candidates come from the user's own address
 * history, must sit inside DEFERRED_MATCH_WINDOW_MS of when the award was
 * booked, must not already be claimed, and must still pass full
 * verification in `settleOne`. Worst case for an attacker is that their
 * own real transaction gets matched to their own real award, once.
 */
async function findDeferredDigest(
  row: LedgerRow,
  user: User,
  direction: MoneyDirection
): Promise<string | null> {
  const { digests, complete } = await recentCandidateDigests(
    user.sui_address,
    MAX_CANDIDATES_PER_PASS * 2
  );
  if (!complete) return null; // partial history read: try again later

  let verifyCalls = 0;
  for (const cand of digests.slice(0, MAX_CANDIDATES_PER_PASS)) {
    if (
      cand.timestampMs > 0 &&
      Math.abs(cand.timestampMs - row.created_at) > DEFERRED_MATCH_WINDOW_MS
    ) {
      continue;
    }
    // A live ledger row in the same exclusivity class already owns this
    // digest → skip it. (A round-up leg and a send leg may share one
    // digest; two primary claims may not.)
    const blocking = PRIMARY_TRIGGERS.has(row.trigger_kind)
      ? PRIMARY_TRIGGER_LIST
      : [row.trigger_kind];
    if (await digestReserved(cand.digest, blocking)) continue;
    if (verifyCalls >= MAX_VERIFY_CALLS_PER_PASS) break;
    verifyCalls++;
    const v = await verifyDigestForUser({
      digest: cand.digest,
      senderAddress: user.sui_address,
      direction,
    });
    if (v.ok) return cand.digest;
  }
  return null;
}

/**
 * Lifetime tallies on `users`, bumped ONLY from a chain-verified amount.
 *
 * These render as dollar figures in the Rewards card, so they were also
 * inflatable by the self-reported `meta.amountUsd` (a client could show
 * itself a $10k lifetime-sent). Sends count as "spent", invest/roundup as
 * "saved"; withdraws move neither (the money returns to the user's own
 * wallet), and goal deposits no longer count at all because nothing
 * verifies them.
 */
async function bumpLifetimeTallies(
  userId: number,
  trigger: EarnTrigger,
  verifiedUsd: number
): Promise<void> {
  const c = db();
  if (trigger === "send") {
    await c.execute({
      sql: "UPDATE users SET lifetime_sent_usd = COALESCE(lifetime_sent_usd, 0) + ? WHERE id = ?",
      args: [verifiedUsd, userId],
    });
  } else if (trigger === "invest" || trigger === "roundup") {
    await c.execute({
      sql: "UPDATE users SET lifetime_saved_usd = COALESCE(lifetime_saved_usd, 0) + ? WHERE id = ?",
      args: [verifiedUsd, userId],
    });
  }
}

/**
 * Work through this user's pending awards.
 *
 * Bounded (MAX_PENDING_PER_PASS rows, MAX_VERIFY_CALLS_PER_PASS chain
 * reads per row) and safe to call redundantly: every row is already
 * claim-key-owned, so a concurrent pass can at worst do the same read
 * twice, never pay twice.
 */
export async function settlePendingAwards(
  userId: number,
  opts: { excludeId?: number } = {}
): Promise<{ settled: number; points: number }> {
  const all = await pendingAwards(userId, MAX_PENDING_PER_PASS + 1);
  const rows = all
    .filter((r) => r.id !== opts.excludeId)
    .slice(0, MAX_PENDING_PER_PASS);
  if (rows.length === 0) return { settled: 0, points: 0 };
  const user = await userById(userId);
  if (!user) return { settled: 0, points: 0 };

  let settled = 0;
  let points = 0;
  for (const row of rows) {
    try {
      const p = await settleOne(row, user);
      if (p > 0) {
        settled++;
        points += p;
      }
    } catch (e) {
      console.warn(
        `[rewards/earn] settle failed (row=${row.id} user=${userId}):`,
        (e as Error).message
      );
    }
  }
  if (settled > 0) {
    console.log(
      `[rewards/earn] settled ${settled} pending award(s) for user=${userId} (+${points} pts)`
    );
  }
  return { settled, points };
}

/**
 * Throttle for the app-open settlement nudge. In-memory per lambda, which
 * is all it needs to be: the point is to stop a chatty client from firing
 * a chain read on every summary refresh, not to be globally exact.
 */
const SETTLE_NUDGE_INTERVAL_MS = 60_000;
const lastNudge = new Map<number, number>();

function shouldNudge(userId: number): boolean {
  const now = Date.now();
  const prev = lastNudge.get(userId);
  if (prev && now - prev < SETTLE_NUDGE_INTERVAL_MS) return false;
  lastNudge.set(userId, now);
  if (lastNudge.size > 2048) {
    for (const [k, ts] of lastNudge) {
      if (now - ts >= SETTLE_NUDGE_INTERVAL_MS) lastNudge.delete(k);
    }
  }
  return true;
}

/** Tier thresholds. Computed from `points_total`. */
export const TIERS = [
  { id: "bronze", min: 0,     label: "Bronze" },
  { id: "silver", min: 500,   label: "Silver" },
  { id: "gold",   min: 2500,  label: "Gold" },
  { id: "plat",   min: 10000, label: "Platinum" },
] as const;

export type TierId = (typeof TIERS)[number]["id"];

export function tierForPoints(points: number): {
  id: TierId;
  label: string;
  /** Points needed to reach the next tier. Null at top tier. */
  pointsToNext: number | null;
  nextLabel: string | null;
} {
  // Find the highest threshold the user has crossed.
  let i = 0;
  for (let k = TIERS.length - 1; k >= 0; k--) {
    if (points >= TIERS[k].min) {
      i = k;
      break;
    }
  }
  const current = TIERS[i];
  const next = TIERS[i + 1];
  return {
    id: current.id,
    label: current.label,
    pointsToNext: next ? next.min - points : null,
    nextLabel: next?.label ?? null,
  };
}

/**
 * Read the lifetime tallies + tier for a user. Cheap, one query on
 * the users row. Cached in the rewards summary response.
 *
 * Side effect: nudges the pending-award settlement pass (fire-and-forget,
 * throttled per user). This is the app-open half of the no-cron
 * settlement model described at the top of the file — the read itself is
 * NOT gated on it, so the 3.5s per-leg fence in /api/referral/summary is
 * unaffected.
 */
export async function getRewardsExtras(userId: number): Promise<{
  lifetimeSentUsd: number;
  lifetimeSavedUsd: number;
  roundupEnabled: boolean;
  roundupPercentage: number;
  tier: ReturnType<typeof tierForPoints>;
}> {
  await ensureSchema();
  if (shouldNudge(userId)) {
    void settlePendingAwards(userId).catch((e) =>
      console.warn(
        `[rewards/earn] app-open settle failed (user=${userId}):`,
        (e as Error).message
      )
    );
  }
  const r = await db().execute({
    sql: `SELECT lifetime_sent_usd, lifetime_saved_usd,
                 roundup_enabled, roundup_percentage, points_total
          FROM users WHERE id = ? LIMIT 1`,
    args: [userId],
  });
  const row = r.rows[0] as unknown as Partial<User> & {
    points_total?: number | null;
  } | undefined;
  return {
    lifetimeSentUsd: Number(row?.lifetime_sent_usd ?? 0) || 0,
    lifetimeSavedUsd: Number(row?.lifetime_saved_usd ?? 0) || 0,
    roundupEnabled: Number(row?.roundup_enabled ?? 0) === 1,
    roundupPercentage: Number(row?.roundup_percentage ?? 2) || 2,
    tier: tierForPoints(Number(row?.points_total ?? 0) || 0),
  };
}
