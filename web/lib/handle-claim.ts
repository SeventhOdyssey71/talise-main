/**
 * Waitlist handle-claim helpers.
 *
 * Strategy A (reserve in DB at claim time, mint on first sign-in):
 *  - `normalizeWaitlistHandle()` produces the canonical bare label.
 *  - `isWaitlistHandleAvailable()` checks DB + on-chain SuiNS.
 *  - `bindWaitlistHandleIfAny()` runs from the sign-in path and turns a
 *    claimed-but-unbound row into a real `<handle>.talise.sui` NFT
 *    minted directly to the user's Sui address.
 *
 * The label charset is `[a-z0-9-]` (SuiNS subname rules) which is a
 * deliberate divergence from the legacy `lib/handle.ts` USERNAME_RE that
 * also allows `_`. Underscores are reserved on the SuiNS root level so
 * we don't mint them as subnames — the waitlist handle pool is a strict
 * subset of valid SuiNS labels.
 */
import "server-only";

import { db } from "./db";
import { RESERVED_USERNAMES } from "./handle";
import { suins } from "./suins-operator";

const HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_LEN = 2;
const MAX_LEN = 32;

/** Additional squat targets beyond `lib/handle.ts`'s base reserved set. */
const EXTRA_RESERVED: ReadonlySet<string> = new Set([
  "team",
  "system",
  "null",
  "undefined",
  "me",
  "you",
  "self",
  "owner",
  "operator",
  "test",
  "demo",
  "billing",
  "security",
  "abuse",
  "noreply",
  "no-reply",
  "info",
  "contact",
  "press",
  "legal",
  "privacy",
  "terms",
  "app",
  "mobile",
  "web",
  "ios",
  "android",
  "wallet",
  "vault",
  "send",
  "claim",
  "waitlist",
  "login",
  "signin",
  "signup",
  "auth",
]);

export type NormalizeResult =
  | { ok: true; handle: string }
  | { ok: false; reason: "empty" | "too_short" | "too_long" | "charset" | "reserved" };

/**
 * Canonicalize a raw handle the user typed. Strips a leading `@`,
 * lowercases, validates charset and length, blocks reserved names.
 * Returns a discriminated result so callers can surface a precise
 * error message ("too short", "letters/numbers/hyphen only", etc.).
 */
export function normalizeWaitlistHandle(raw: unknown): NormalizeResult {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  let s = raw.trim().toLowerCase();
  if (!s) return { ok: false, reason: "empty" };
  if (s.startsWith("@")) s = s.slice(1);
  // Be forgiving about common pasted forms — strip the parent suffix
  // if the user typed "alice.talise.sui" or "alice@talise" verbatim.
  if (s.endsWith(".talise.sui")) s = s.slice(0, -".talise.sui".length);
  if (s.endsWith("@talise.sui")) s = s.slice(0, -"@talise.sui".length);
  if (s.endsWith("@talise")) s = s.slice(0, -"@talise".length);

  if (s.length === 0) return { ok: false, reason: "empty" };
  if (s.length < MIN_LEN) return { ok: false, reason: "too_short" };
  if (s.length > MAX_LEN) return { ok: false, reason: "too_long" };
  if (!HANDLE_RE.test(s)) return { ok: false, reason: "charset" };
  if (RESERVED_USERNAMES.has(s)) return { ok: false, reason: "reserved" };
  if (EXTRA_RESERVED.has(s)) return { ok: false, reason: "reserved" };
  return { ok: true, handle: s };
}

/** Human-friendly explanation for a normalize failure. */
export function normalizeReasonMessage(
  reason: Exclude<NormalizeResult, { ok: true }>["reason"]
): string {
  switch (reason) {
    case "empty":
      return "Enter a handle.";
    case "too_short":
      return `Handles need at least ${MIN_LEN} characters.`;
    case "too_long":
      return `Handles are up to ${MAX_LEN} characters.`;
    case "charset":
      return "Letters, numbers, and hyphens only. No leading or trailing hyphen.";
    case "reserved":
      return "That handle is reserved.";
  }
}

/** Internal: has this handle been reserved in our DB by anyone? */
async function isReservedInDb(handle: string): Promise<boolean> {
  const r = await db().execute({
    sql: "SELECT email FROM waitlist_signups WHERE claimed_handle = ? LIMIT 1",
    args: [handle],
  });
  return r.rows.length > 0;
}

/**
 * Internal: does `<handle>.talise.sui` already exist on chain? If the
 * SuiNS NameRecord lookup throws (object not found), the name is free.
 */
async function isMintedOnChain(handle: string): Promise<boolean> {
  try {
    const rec = await suins().getNameRecord(`${handle}.talise.sui`);
    // A record exists. Even if targetAddress is null (broken/partial
    // mint) the name slot is taken — we won't mint again.
    return !!rec;
  } catch {
    return false;
  }
}

export type AvailabilityVerdict =
  | { available: true; handle: string }
  | { available: false; reason: "taken_db" | "taken_chain"; handle: string };

/**
 * Composite availability check. Run AFTER normalization. We hit DB
 * first (sub-ms) and on-chain only if DB looks clear, because the
 * SuiNS gRPC call is the slow path.
 */
export async function isWaitlistHandleAvailable(
  handle: string
): Promise<AvailabilityVerdict> {
  if (await isReservedInDb(handle)) {
    return { available: false, reason: "taken_db", handle };
  }
  if (await isMintedOnChain(handle)) {
    return { available: false, reason: "taken_chain", handle };
  }
  return { available: true, handle };
}

/**
 * Sign-in hook. Called from the mobile exchange route right after the
 * `users` row + Sui address exist. Idempotent — re-running for the
 * same email is a no-op once `handle_bound_user_id` is set.
 *
 * Failure modes (mint races, RPC errors) are logged but never thrown:
 * sign-in MUST NOT block on this. Unbound rows can be replayed by
 * re-running sign-in.
 */
export async function bindWaitlistHandleIfAny(opts: {
  userId: string | number;
  userEmail: string;
  suiAddress: string;
}): Promise<{ bound: false } | { bound: true; handle: string; digest: string }> {
  const email = opts.userEmail.trim().toLowerCase();
  if (!email) return { bound: false };

  try {
    const c = db();
    const row = await c.execute({
      sql: `SELECT claimed_handle FROM waitlist_signups
              WHERE email = ?
                AND claimed_handle IS NOT NULL
                AND handle_bound_user_id IS NULL
              LIMIT 1`,
      args: [email],
    });
    const handle = row.rows[0]?.claimed_handle as string | undefined;
    if (!handle) return { bound: false };

    // Lazy-import the on-chain mint — keeps the sign-in path cold-start
    // small for users who never claimed a handle.
    const { mintSubname, suinsOperatorEnabled } = await import("./suins-operator");
    if (!suinsOperatorEnabled()) {
      console.warn(
        `[handle-bind] operator disabled; leaving ${email}=${handle} unbound for later replay`
      );
      return { bound: false };
    }

    // Belt-and-suspenders: if some other path already minted this handle
    // on chain (e.g. user manually claimed before sign-in), skip mint
    // and just mark bound.
    if (await isMintedOnChain(handle)) {
      console.warn(
        `[handle-bind] ${handle}.talise.sui already on chain; marking bound without mint`
      );
      await c.execute({
        sql: `UPDATE waitlist_signups
                 SET handle_bound_user_id = ?, handle_bound_at = ?
               WHERE email = ?`,
        args: [String(opts.userId), Date.now(), email],
      });
      return { bound: true, handle, digest: "" };
    }

    const { digest, subnameNftId } = await mintSubname({
      username: handle,
      userAddress: opts.suiAddress,
    });

    await c.execute({
      sql: `UPDATE waitlist_signups
               SET handle_bound_user_id = ?,
                   handle_bound_at = ?,
                   handle_object_id = COALESCE(handle_object_id, ?)
             WHERE email = ?`,
      args: [String(opts.userId), Date.now(), subnameNftId, email],
    });

    // Also write the canonical bare handle into `users.talise_username`
    // — the column the existing handle plumbing already reads from.
    try {
      await c.execute({
        sql: "UPDATE users SET talise_username = ? WHERE id = ?",
        args: [handle, Number(opts.userId)],
      });
    } catch (e) {
      // UNIQUE collision — user already has a different talise_username
      // (extremely unlikely on first sign-in). Don't roll back the on-
      // chain mint; just log.
      console.warn(
        `[handle-bind] could not set users.talise_username for ${email}: ${(e as Error).message}`
      );
    }

    console.log(
      `[handle-bind] email=${email} handle=${handle} digest=${digest} nft=${subnameNftId ?? "?"}`
    );
    return { bound: true, handle, digest };
  } catch (err) {
    // Sign-in MUST NOT block. Log and walk away — the row is still
    // claimed in DB and will be replayed next sign-in.
    console.warn(
      `[handle-bind] failed for ${email}: ${(err as Error).message}`
    );
    return { bound: false };
  }
}
