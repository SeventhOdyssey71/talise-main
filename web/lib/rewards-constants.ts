/**
 * Talise rewards policy, pure constants + presentation helpers.
 *
 * No DB, no fetch, no `server-only` directive. Safe to import from client
 * components (RewardsPanel, OnboardingFlow). The server-side helpers live
 * in `lib/rewards/*` (earn / referral / integrity / verify) which DO carry
 * the `server-only` pragma because they talk to Postgres and the chain.
 *
 * ── Read this before changing a number ──────────────────────────────
 *
 * Points are a liability. The moment a SKU exists in
 * `lib/rewards/catalogue.ts` (currently intentionally EMPTY, see the
 * comment there) every point is a claim on real value, so the numbers
 * below are an issuance budget and not decoration. The rules that keep
 * them honest:
 *
 *   1. Nothing here may be paid on a CLIENT-ASSERTED amount. Money awards
 *      are paid on a chain-verified amount only (lib/rewards/verify.ts).
 *   2. Nothing may be paid for an action that is free to repeat. Signing
 *      up is free (zkLogin over Google), so signup pays ZERO.
 *   3. Every payout is idempotent and reversible (lib/rewards/integrity.ts).
 */

import type { RewardsEventKind } from "./db";

export const POINTS = {
  /**
   * Inviter's reward for a signup. ZERO, on purpose.
   *
   * This used to be 500 with no gate of any kind: `attributeReferral`
   * (lib/db.ts) credited the inviter the moment a new account presented
   * their code. Creating an account costs an attacker nothing but a
   * Google identity, so 500 pts/signup was a sybil bounty priced at the
   * cost of a browser profile. There were no per-inviter caps, no KYC,
   * no activity requirement and no clawback path.
   *
   * The referral value did not go away, it MOVED to activation
   * (`REFERRAL_FIRST_SEND_*`), which only pays once the referee has
   * moved real money on chain. Attribution itself still writes a
   * 0-point `referral_signup` event so the referral edge stays visible
   * in the feed and in /admin/ledger.
   */
  REFERRAL_SIGNUP_REFERRER: 0,
  /** Referee's reward for a signup. ZERO, same reasoning. */
  REFERRAL_SIGNUP_REFEREE: 0,

  /**
   * ACTIVATION award: paid to BOTH sides, once, when the referee's first
   * server-verified money movement clears (lib/rewards/referral.ts).
   *
   * Why symmetric (500/500) rather than the old 1000/1000 or the
   * referrer-only 500/0:
   *
   *   • The old split was asymmetric in the WRONG direction. The referee
   *     does the work (they're the one who moves money) and got nothing
   *     at signup, so the invite had nothing to offer them, while the
   *     inviter got paid for an action that cost nobody anything.
   *   • A symmetric split does NOT make farming worse. A farmer who owns
   *     both sides collects the whole 1000 either way; what bounds them
   *     is the activation gate + the per-inviter caps below, not how the
   *     payout is sliced. Given that, the split is a product decision,
   *     and "you and your friend each get 500" is the legible one.
   *   • The total per activated referral came DOWN from 2000 (1000+1000)
   *     to 1000, because the payout now happens at the point of proven
   *     value and we'd rather spend the budget on more activations than
   *     on a bigger single bounty.
   */
  REFERRAL_FIRST_SEND_REFERRER: 500,
  REFERRAL_FIRST_SEND_REFEREE: 500,

  /**
   * Personal first-send bonus (no referrer required). Paid once, on the
   * first CHAIN-VERIFIED money movement, never on a self-report.
   */
  FIRST_SEND: 500,
  /** Personal first `name@talise` claim. Server-verified by definition. */
  FIRST_CLAIM: 250,
  /** Daily activity streak, placeholder, not yet wired. */
  STREAK_DAILY: 50,
} as const;

/**
 * Anti-farming limits for the referral programme.
 *
 * Every number here is a deliberate trade between organic word-of-mouth
 * (which we want) and an attacker minting accounts (which we don't).
 * They are constants rather than env vars so a change is reviewable in
 * git history alongside its rationale.
 */
export const REFERRAL_LIMITS = {
  /**
   * Chain-verified USD the REFEREE must have moved (cumulatively, across
   * all their settled awards) before either side is paid.
   *
   * $1.00. The earn engine documents typical corridor sends as
   * ~$0.04-$5, so this is a couple of real sends, not a wall, and it's
   * cumulative so a string of tiny sends qualifies. But it does mean a
   * fake account costs a dollar of real, on-chain, KYC-adjacent money to
   * activate instead of costing nothing. At the lifetime cap below that
   * puts a floor of $50 + 50 Google identities on a maxed-out farm.
   */
  MIN_REFEREE_VERIFIED_USD: 1.0,

  /**
   * Activated referrals one inviter can be paid for per UTC day.
   *
   * 5. Genuine word-of-mouth is a handful of friends a day; nobody
   * organically activates a sixth person before midnight. Caps a burst
   * farm at 5 x 500 = 2,500 pts/day for the inviter side.
   */
  MAX_ACTIVATIONS_PER_DAY: 5,

  /**
   * Activated referrals one inviter can EVER be paid for.
   *
   * 50 (= 25,000 pts, i.e. the whole Platinum tier). Past this, growth is
   * an ambassador conversation with a human, not an automatic faucet.
   * Attribution keeps counting (`users.referral_count`, leaderboard rank)
   * after the cap; only the points stop.
   */
  MAX_ACTIVATIONS_LIFETIME: 50,

  /**
   * Activations an inviter may be paid for before KYC is required.
   *
   * 10 (= 5,000 pts). Rationale: KYC is the only control that ties a
   * payout to a legal identity, and it is the correct friction point for
   * someone earning at scale, but demanding it from a user who invited
   * two friends would kill the loop. Above the threshold the INVITER
   * must have `users.kyc_tier >= MIN_KYC_TIER`; unverified inviters keep
   * accruing attribution and can back-claim nothing (the payout is
   * skipped, not queued, so KYC-then-farm doesn't work either).
   */
  KYC_FREE_ACTIVATIONS: 10,
  MIN_KYC_TIER: 1,
} as const;

/**
 * Per-user daily ceiling on points from MONEY actions (send / invest /
 * roundup / swap).
 *
 * 25,000 pts/day. Every one of those points is backed by verified
 * on-chain movement, so this is not an anti-forgery control, it's an
 * anti-wash-trading one: on a gasless rail a user can bounce funds
 * between two of their own wallets all day at zero marginal cost, and
 * each leg is a genuine outflow. The cap makes that unprofitable while
 * sitting far above any real corridor user (25,000 pts = $25,000 sent, or
 * $8,333 supplied to yield, in one day).
 */
export const DAILY_EARN_POINTS_CAP = 25_000;

/**
 * How long a pending (unverified) award stays claimable.
 *
 * 24h. The send rails broadcast with `waitForExecution: false`, so an
 * award almost always races ahead of the fullnode indexing the tx; the
 * award is booked as `pending` and settled by a later pass. A day is
 * generous for chain finality (seconds) plus a user not re-opening the
 * app. After that the row expires unpaid: an award we could never verify
 * is an award we must not pay.
 */
export const PENDING_AWARD_TTL_MS = 24 * 60 * 60 * 1000;

/** Human-readable labels for the activity strip on `/rewards`. */
export const EVENT_LABELS: Record<RewardsEventKind, string> &
  Record<string, string> = {
  referral_signup: "Friend signed up with your code",
  referral_first_send: "Friend sent their first payment",
  volume_milestone: "Volume milestone reached",
  first_send: "Your first send",
  first_claim: "Claimed your @talise name",
  streak: "Daily streak",
  // Phase 1 earn-engine kinds.
  send_earn: "Earned from a send",
  save_earn: "Earned from saving to yield",
  roundup_save: "Round-up saved",
  withdraw_earn: "Withdrew from yield",
  goal_deposit: "Added to a savings goal",
  swap_earn: "Converted to USDsui",
  redeemed: "Redeemed points",
  // Integrity kind, written by lib/rewards/integrity.ts → clawbackUser.
  // Not a member of `RewardsEventKind` (that union lives in lib/db.ts);
  // the intersection type above lets us label it anyway so a reversal
  // never renders as a blank row.
  clawback: "Points reversed",
};

/** Format a points delta with a leading `+`. */
export function formatPointsDelta(n: number): string {
  if (n <= 0) return `${n}`;
  return `+${n.toLocaleString()}`;
}
