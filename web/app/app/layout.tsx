export const dynamic = "force-dynamic";

/**
 * The Talise web app is RETIRED — Talise is mobile-only now.
 *
 * Every route under /app (and the app.talise.io subdomain, which the
 * middleware rewrites onto this tree) renders the mobile-only notice below;
 * we deliberately do NOT render `children`, so the old web wallet shell,
 * sign-in, and waiting-room never mount.
 *
 * The PUBLIC money surfaces are SEPARATE routes (/c claim, /i invoice,
 * /pay links, /u profiles) and are unaffected — non-members can still
 * receive money via those links.
 *
 * To bring the web app back, restore the previous AppShell layout from git
 * history (commit before this change).
 */
export default function AppLayout(_props: { children: React.ReactNode }) {
  return <MobileOnly />;
}

function MobileOnly() {
  return (
    <div className="app-clean relative min-h-screen overflow-hidden text-fg">
      <div className="talise-top-glow" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
        <div className="talise-glass w-full max-w-sm rounded-xl px-7 py-9 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-soft">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" stroke="var(--color-accent)" strokeWidth="1.8" />
              <path d="M10.5 18.5h3" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <h1 className="mt-5 text-[20px] font-medium tracking-[-0.02em] text-fg">
            Talise lives on your phone
          </h1>
          <p className="mx-auto mt-3 max-w-[18rem] text-[14px] leading-relaxed text-fg-muted">
            The Talise app is mobile-only. Download it on your iPhone to hold
            dollars, send to a <span className="font-medium text-fg">name@talise</span>,
            and cash out in seconds.
          </p>
          <a
            href="https://www.talise.io"
            className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-accent-deep px-5 py-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.98]"
          >
            Get the app
          </a>
        </div>
        <p className="mt-6 text-center text-[12px] text-fg-dim">Talise · built on Sui</p>
      </div>
    </div>
  );
}
