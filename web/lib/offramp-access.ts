import "server-only";
import { isPrivateRelayEmail } from "@/lib/email-address";

/**
 * USD withdrawal (Bridge USD cash-out over ACH) access gate.
 *
 * OPEN to every account. It was previously locked to a maintainer allowlist
 * while the US flow was being proven; that pilot is over.
 *
 * ── Why the switch is named `USD_WITHDRAWAL_CLOSED`, not the old
 *    `USD_WITHDRAWAL_OPEN` ──────────────────────────────────────────────────
 * The old variable was opt-IN: cash-out opened only on an explicit "true", so
 * an unset, misspelled or migration-lost value silently CLOSED the rail for
 * everyone. Inverting the default without renaming would have been worse: the
 * same variable would mean the opposite thing depending on which deploy read
 * it, and a stale "false" left in an environment would keep the rail shut while
 * the code claimed to be open. A new name has no legacy values anywhere, so the
 * default is unambiguous and the kill switch is explicit.
 *
 * To shut the rail off in an emergency: set `USD_WITHDRAWAL_CLOSED=true` and
 * redeploy. Nothing else re-closes it.
 *
 * This gate is only about ACCESS. Cash-out independently requires approved
 * Bridge KYC (`NO_BRIDGE_CUSTOMER`), a usable ACH route (`NO_ROUTE`), a
 * balance, and it stays inside the daily off-ramp cap — none of which this
 * function relaxes. Server-authoritative; iOS surfaces the 403 as "coming soon".
 */

export const USD_WITHDRAWAL_CLOSED_MESSAGE =
  "USD withdrawal isn't open for your account yet, it's rolling out soon.";

/** Emergency kill switch. Absent (the normal state) means the rail is open. */
function killSwitchOn(): boolean {
  return process.env.USD_WITHDRAWAL_CLOSED?.trim().toLowerCase() === "true";
}

export function usdWithdrawalAllowed(user: {
  email?: string | null;
  talise_username?: string | null;
}): boolean {
  if (killSwitchOn()) return false;
  // Apple "Hide My Email" relay addresses cannot complete Bridge KYC, so a
  // cash-out would fail downstream with a far more confusing error than this
  // one. Denied until the user sets a real address (via KYC start). This is a
  // provider constraint, not a pilot restriction, so it outlives the allowlist.
  if (isPrivateRelayEmail(user.email)) return false;
  return true;
}
