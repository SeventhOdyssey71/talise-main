import "server-only";

/**
 * USD withdrawal (Bridge USD-wire cash-out) access gate.
 *
 * USD withdrawal is now OPEN to everyone — note that cash-out independently
 * requires the user to have completed Bridge identity verification (the
 * `KYC_NOT_APPROVED` guard in the cashout route), so "open" means "anyone who
 * has verified can cash out", not "no checks".
 *
 * Kill-switch: set `USD_WITHDRAWAL_OPEN=false` in the environment to re-close
 * (e.g. a payout-partner incident) with no code change. Even when closed, the
 * maintainer allowlist (`USD_WITHDRAWAL_ALLOWED_EMAILS` / `_HANDLES`, defaulting
 * to `rolandojude18`) still gets through so testing keeps working.
 * Server-authoritative — the iOS app surfaces the 403 as "coming soon".
 */
const DEFAULT_EMAILS = "rolandojude18@gmail.com";
const DEFAULT_HANDLES = "rolandojude18";

export const USD_WITHDRAWAL_CLOSED_MESSAGE =
  "USD withdrawal isn't open for your account yet — it's rolling out soon.";

function list(envVal: string | undefined, fallback: string): string[] {
  return (envVal ?? fallback)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function usdWithdrawalAllowed(user: {
  email?: string | null;
  talise_username?: string | null;
}): boolean {
  // Kill-switch: only an explicit `false` re-closes; default is open.
  if (process.env.USD_WITHDRAWAL_OPEN?.trim().toLowerCase() === "false") {
    // Closed — but keep the maintainer allowlist working for testing.
    const email = user.email?.trim().toLowerCase();
    if (email && list(process.env.USD_WITHDRAWAL_ALLOWED_EMAILS, DEFAULT_EMAILS).includes(email)) {
      return true;
    }
    const handle = user.talise_username?.trim().toLowerCase();
    if (handle && list(process.env.USD_WITHDRAWAL_ALLOWED_HANDLES, DEFAULT_HANDLES).includes(handle)) {
      return true;
    }
    return false;
  }
  // Default: open to everyone (cash-out still requires approved Bridge KYC).
  return true;
}
