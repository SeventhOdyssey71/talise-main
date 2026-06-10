import { readSessionEntryId } from "@/lib/session";
import { userById, isAppAccessAllowed } from "@/lib/db";
import { readBalanceSnapshot } from "@/lib/snapshots";
import { AppShell } from "@/components/app/AppShell";
import type { Me, Balances } from "@/components/app/data";

export const dynamic = "force-dynamic";

/**
 * /app shell + ACCESS GATE (private beta, open sign-in).
 *
 *   • Not signed in           → AppShell renders its Continue-with-Google
 *                               screen. Anyone may sign in.
 *   • Signed in, NOT allowed  → the waiting-room screen below. Access is
 *                               granted per-email via the app_allowlist table
 *                               (admin API /api/admin/app-access) or the
 *                               APP_ALLOWED_EMAILS env bootstrap.
 *   • Signed in + allowed     → the app.
 *
 * The PUBLIC surfaces (/c claim, /i invoice, /pay links, /u profiles) are
 * intentionally NOT gated — they're how non-members receive money.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let me: Me | null = null;
  let initialBalances: Balances | null = null;

  const id = await readSessionEntryId();
  if (id != null) {
    const u = await userById(id).catch(() => null);
    if (u) {
      // ── The gate ────────────────────────────────────────────────────
      if (!(await isAppAccessAllowed(u.email))) {
        return <WaitingRoom email={u.email} name={u.name} />;
      }
      me = {
        id: String(u.id),
        email: u.email,
        name: u.name,
        picture: u.picture,
        country: u.country,
        suiAddress: u.sui_address,
        taliseHandle: u.talise_username,
        accountType: u.account_type ?? "personal",
      };
      // Seed the balance from the display snapshot so the dashboard paints the
      // real number on first byte — no client round-trip, no skeleton flash.
      // (Display-only; the client still revalidates fresh against chain.)
      const snap = await readBalanceSnapshot(id).catch(() => null);
      if (snap) {
        initialBalances = {
          address: snap.suiAddress,
          usdsui: snap.usdsui,
          sui: snap.sui,
          suiPriceUsd: snap.suiPriceUsd,
          totalUsd: snap.totalUsd,
          refreshedAt: snap.refreshedAt,
          stale: true,
        };
      }
    }
  }

  return (
    <AppShell me={me} initialBalances={initialBalances}>
      {children}
    </AppShell>
  );
}

/**
 * Signed-in-but-not-yet-allowed screen. Calm, on-brand, honest: account
 * created, spot held, access opens in waves.
 */
function WaitingRoom({ email, name }: { email: string; name: string | null }) {
  const first = (name ?? "").split(/\s+/)[0] || null;
  return (
    <div className="app-clean relative min-h-screen overflow-hidden text-fg">
      <div className="talise-top-glow" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
        <div className="talise-glass w-full max-w-sm rounded-xl px-7 py-9 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-soft">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="var(--color-accent)" strokeWidth="1.8" />
              <path d="M12 7.5V12l3 2" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <h1 className="mt-5 text-[20px] font-medium tracking-[-0.02em] text-fg">
            {first ? `You're in line, ${first}` : "You're in line"}
          </h1>
          <p className="mx-auto mt-3 max-w-[17rem] text-[14px] leading-relaxed text-fg-muted">
            Talise is opening in waves. Your account is created and your spot is
            held — we&rsquo;ll email <span className="font-medium text-fg">{email}</span>{" "}
            the moment your access unlocks.
          </p>
          <a
            href="/waitlist"
            className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-accent-deep px-5 py-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.98]"
          >
            Claim your @handle while you wait
          </a>
          <a
            href="/auth/logout"
            className="mt-3 inline-block text-[12.5px] text-fg-dim underline-offset-2 hover:underline"
          >
            Sign out
          </a>
        </div>
        <p className="mt-6 text-center text-[12px] text-fg-dim">Invite-only beta · by Talise</p>
      </div>
    </div>
  );
}
