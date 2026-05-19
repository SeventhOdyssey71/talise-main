import "server-only";

import {
  recordRewardsEvent,
  userById,
  type RewardsEventKind,
} from "./db";

/**
 * Talise rewards policy.
 *
 * Numbers are intentionally exported as named constants so they're easy to
 * tune from one place without grepping the codebase. Every event kind that
 * we can fire has an entry here, and each helper enforces idempotency
 * where it matters (no double-counting first-send / first-claim bonuses).
 */

export const POINTS = {
  /** Inviter earns this when a new user signs in with their code. */
  REFERRAL_SIGNUP_REFERRER: 500,
  /** Referee earns this on signup attribution (so the welcome screen has a win). */
  REFERRAL_SIGNUP_REFEREE: 0,
  /** Both sides earn this once when the referee makes their first send. */
  REFERRAL_FIRST_SEND_REFERRER: 1000,
  REFERRAL_FIRST_SEND_REFEREE: 1000,
  /** Personal first send (any user, no referrer required). */
  FIRST_SEND: 500,
  /** Personal first `name@talise` claim. */
  FIRST_CLAIM: 250,
  /** Per $100 USDsui sent — fired by the volume hook below. */
  VOLUME_PER_100_USDSUI: 100,
  /** Daily activity streak — placeholder, not yet wired. */
  STREAK_DAILY: 50,
} as const;

/**
 * Human-readable labels for the activity strip on `/rewards`.
 */
export const EVENT_LABELS: Record<RewardsEventKind, string> = {
  referral_signup: "Friend signed up with your code",
  referral_first_send: "Friend sent their first payment",
  volume_milestone: "Volume milestone reached",
  first_send: "Your first send",
  first_claim: "Claimed your @talise name",
  streak: "Daily streak",
};

/**
 * Fire-and-forget volume hook. Call this from `/api/tx/record` once we know
 * the send's USDsui amount. Awards `POINTS.VOLUME_PER_100_USDSUI` for every
 * full $100 in the transaction.
 *
 * Currently NOT wired to the route — left as a helper so the trigger
 * site can opt in once we settle on accounting (per-tx vs cumulative).
 */
export async function awardVolumePoints(
  userId: number,
  amountUsdsui: number,
  txDigest: string
): Promise<void> {
  if (!Number.isFinite(amountUsdsui) || amountUsdsui < 100) return;
  const hundreds = Math.floor(amountUsdsui / 100);
  const points = hundreds * POINTS.VOLUME_PER_100_USDSUI;
  if (points <= 0) return;
  await recordRewardsEvent(userId, "volume_milestone", points, {
    txDigest,
    amountUsdsui,
    milestone: hundreds * 100,
  });
}

/**
 * Award the one-time "first send" bonus. Caller should ensure this is the
 * user's actual first send (e.g. by checking `tx_history` count == 1) before
 * invoking — we don't re-query that here to keep the helper composable.
 *
 * If the referee was referred, fires `referral_first_send` for both sides.
 */
export async function awardFirstSendBonus(
  userId: number,
  txDigest: string
): Promise<void> {
  const me = await userById(userId);
  if (!me) return;
  await recordRewardsEvent(userId, "first_send", POINTS.FIRST_SEND, {
    txDigest,
  });
  if (me.referred_by_user_id) {
    await recordRewardsEvent(
      userId,
      "referral_first_send",
      POINTS.REFERRAL_FIRST_SEND_REFEREE,
      { txDigest, inviterUserId: me.referred_by_user_id }
    );
    await recordRewardsEvent(
      me.referred_by_user_id,
      "referral_first_send",
      POINTS.REFERRAL_FIRST_SEND_REFERRER,
      { txDigest, referredUserId: userId }
    );
  }
}

/** Award the one-time "first claim" bonus. */
export async function awardFirstClaimBonus(
  userId: number,
  username: string
): Promise<void> {
  await recordRewardsEvent(userId, "first_claim", POINTS.FIRST_CLAIM, {
    username,
  });
}

/** Format a points delta with a leading `+`. */
export function formatPointsDelta(n: number): string {
  if (n <= 0) return `${n}`;
  return `+${n.toLocaleString()}`;
}
