import { redirect } from "next/navigation";
import Link from "next/link";
import { SignInButton } from "@/components/SignInButton";
import { userById } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Talise marketing landing — dark, mobile-app-feel.
 *
 * Mirrors the iOS app's design system (DesignSystem/Tokens.swift): near-
 * black background with a soft green TopGlow wash, accent-green green
 * highlights, and the same Liquid-Glass card recipe (`.talise-glass`).
 * The page is intentionally short — one strong hero, three feature
 * tiles, two persona stories, and a closing CTA. Anyone signed in is
 * bounced straight to their app surface before we render anything.
 */
async function bootstrap() {
  const id = await readSessionEntryId();
  if (id) {
    const u = await userById(id);
    if (u) {
      const dest =
        u.account_type === "business"
          ? "/business"
          : u.account_type === "personal"
            ? "/home"
            : "/onboarding";
      return { signedIn: true as const, dest };
    }
  }
  return { signedIn: false as const };
}

export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const params = await searchParams;
  const state = await bootstrap();
  if (state.signedIn) redirect(state.dest);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-fg)]">
      <div className="talise-top-glow" aria-hidden />

      <TopBar />

      <main className="relative z-10 mx-auto w-full max-w-[1100px] px-6 pb-32">
        <Hero err={params.err} />
        <FeatureGrid />
        <PersonaStories />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Sections

function TopBar() {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-[1100px] items-center justify-between px-6 py-5">
      <Link
        href="/"
        className="flex items-center gap-2 text-[15px] tracking-tight text-[var(--color-fg)]"
      >
        <Diamond />
        <span>talise</span>
      </Link>
      <nav className="hidden items-center gap-7 text-[13px] text-[var(--color-fg-muted)] md:flex">
        <a href="#how" className="transition hover:text-[var(--color-fg)]">
          How it works
        </a>
        <a href="#who" className="transition hover:text-[var(--color-fg)]">
          Who it's for
        </a>
      </nav>
      <Link
        href="#cta"
        className="rounded-full bg-[var(--color-surface-2)] px-4 py-2 text-[13px] text-[var(--color-fg)] transition hover:bg-[var(--color-surface)]"
      >
        Sign in
      </Link>
    </header>
  );
}

function Hero({ err }: { err?: string }) {
  return (
    <section className="pt-20 pb-24 text-center md:pt-28">
      <div className="mx-auto flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)]">
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
        new — live on Sui mainnet
      </div>

      <h1 className="mx-auto mt-6 max-w-[820px] text-[clamp(40px,7vw,72px)] font-medium leading-[1.04] tracking-[-0.02em] text-[var(--color-fg)]">
        Send money across the globe.{" "}
        <span
          className="text-[var(--color-accent)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          For free.
        </span>
      </h1>

      <p className="mx-auto mt-6 max-w-[560px] text-[15px] leading-[1.55] text-[var(--color-fg-muted)]">
        Talise moves naira, shillings, cedis, and rand across borders in
        seconds — at a fraction of what Wise, Western Union, or Remitly
        charge. Sign in with Google. No app, no agent, no queue.
      </p>

      <div id="cta" className="mx-auto mt-9 max-w-[340px]">
        <SignInButton variant="primary" label="Continue with Google" />
        <div className="mt-3 flex items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
          <span>no app to install</span>
          <span>·</span>
          <span>arrives in seconds</span>
        </div>
      </div>

      {err && <ErrorBanner err={err} />}

      <div className="mx-auto mt-16 max-w-[860px]">
        <PhonePreview />
      </div>

      <StatRow />
    </section>
  );
}

function FeatureGrid() {
  const items: Array<{
    eyebrow: string;
    title: string;
    body: string;
    glyph: "send" | "leaf" | "sui";
  }> = [
    {
      eyebrow: "01 / send",
      title: "Across borders, in seconds.",
      body:
        "Send to a phone, a username, or a wallet. Naira, cedis, shillings, rand — we settle in USDsui and land in the receiver's local currency, faster than any traditional rail.",
      glyph: "send",
    },
    {
      eyebrow: "02 / earn",
      title: "Idle money should compound.",
      body:
        "Move USDsui into NAVI lending in one tap. Watch real-time yield. Withdraw anytime. No lockups, no jargon — just a balance that quietly grows.",
      glyph: "leaf",
    },
    {
      eyebrow: "03 / stable",
      title: "Built on the Sui Dollar.",
      body:
        "USDsui is the canonical Sui-native dollar. No bridge risk, no wrapped tokens, no off-chain custody. The same dollar your savings, payments, and yield all share.",
      glyph: "sui",
    },
  ];

  return (
    <section id="how" className="border-t border-[var(--color-line)] pt-20">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)]">
        how it works
      </div>
      <h2 className="mt-3 max-w-[720px] text-[clamp(28px,4.5vw,46px)] font-medium leading-[1.08] tracking-[-0.01em]">
        One app. Every corridor.{" "}
        <span
          className="text-[var(--color-fg-muted)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          Arrives in seconds.
        </span>
      </h2>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {items.map((it) => (
          <article
            key={it.eyebrow}
            className="talise-glass rounded-2xl p-6"
          >
            <div className="flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
                {it.eyebrow}
              </div>
              <FeatureGlyph kind={it.glyph} />
            </div>
            <h3 className="mt-7 text-[20px] font-medium leading-[1.18] tracking-[-0.005em]">
              {it.title}
            </h3>
            <p className="mt-3 text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
              {it.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PersonaStories() {
  return (
    <section id="who" className="mt-28">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)]">
        who it's for
      </div>
      <h2 className="mt-3 max-w-[720px] text-[clamp(28px,4.5vw,46px)] font-medium leading-[1.08] tracking-[-0.01em]">
        Built for the{" "}
        <span
          className="text-[var(--color-accent)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          diaspora.
        </span>
      </h2>
      <p className="mt-4 max-w-[560px] text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">
        Every month, millions of Africans abroad send a piece of their salary
        home. Talise is for the person sending it — and the family waiting on
        it.
      </p>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <PersonaCard
          name="Chiamaka"
          eyebrow="London → Lagos · NHS Nurse, sending home"
          chip="£500 → ₦1,050,000"
          before="Sends £500 home every month. Western Union takes around £32 in fees plus a poor exchange rate — roughly £45 lost per transfer."
          after="With Talise, the fee on £500 is near zero. She saves about £40 a month — £480 a year — and her mum gets the cash in under 5 seconds."
        />
        <PersonaCard
          name="Mama Adaeze"
          eyebrow="Lagos · Receives · The family back home"
          chip="₦1,050,000 received"
          before="Used to spend a half-day on the bus to collect cash from an agent. Sometimes the agent was out of naira and she'd come back the next day."
          after="Now the naira lands in her mobile money in seconds. She buys yams from the market on the same phone. No queue, no agent, no come-back-tomorrow."
        />
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mt-32 text-center">
      <h2 className="mx-auto max-w-[640px] text-[clamp(32px,5vw,52px)] font-medium leading-[1.08] tracking-[-0.015em]">
        Send your first £100 home.{" "}
        <span
          className="text-[var(--color-accent)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          We'll cover the fee.
        </span>
      </h2>
      <p className="mx-auto mt-5 max-w-[480px] text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">
        Sign in with Google. Pick who you're sending to. We'll handle the rest
        — including the cost of the first transfer.
      </p>
      <div className="mx-auto mt-8 max-w-[340px]">
        <SignInButton variant="primary" label="Continue with Google" />
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-[var(--color-line)] bg-[var(--color-bg)]">
      <div className="mx-auto grid w-full max-w-[1100px] gap-10 px-6 py-14 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 text-[15px] tracking-tight">
            <Diamond />
            <span>talise</span>
          </div>
          <p className="mt-3 max-w-[220px] text-[12px] leading-[1.55] text-[var(--color-fg-muted)]">
            Talise — money home, in seconds.
          </p>
        </div>
        <FooterCol
          title="Product"
          links={[
            ["How it works", "#how"],
            ["Who it's for", "#who"],
            ["Sign in", "#cta"],
          ]}
        />
        <FooterCol
          title="Corridors"
          links={[
            ["UK → Nigeria", "#"],
            ["UK → Kenya", "#"],
            ["UK → Ghana", "#"],
            ["UK → South Africa", "#"],
          ]}
        />
        <FooterCol
          title="Trust"
          links={[
            ["Privacy policy", "#"],
            ["Terms of use", "#"],
            ["hello@talise.io", "mailto:hello@talise.io"],
          ]}
        />
      </div>
      <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] px-6 py-5 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        <div>© {new Date().getFullYear()} talise</div>
        <div>built on sui · usdsui native · zklogin</div>
      </div>
    </footer>
  );
}

// ───────────────────────────────────────────────────────────────────
// Small primitives

function ErrorBanner({ err }: { err: string }) {
  return (
    <div
      role="status"
      className="mx-auto mt-6 max-w-[460px] rounded-xl border border-[#c95a4a4d] bg-[#c95a4a14] px-4 py-3 text-[12px] text-[#f0a99e]"
    >
      <span className="font-mono uppercase tracking-[0.18em] opacity-70">
        sign-in error ·{" "}
      </span>
      {err}
    </div>
  );
}

function PhonePreview() {
  return (
    <div className="relative mx-auto w-full max-w-[360px]">
      <div className="talise-glass rounded-[36px] px-5 py-7">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
              Balance
            </div>
            <div
              className="mt-1 text-[40px] font-medium tracking-tight"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              ₦332,580
            </div>
            <div className="mt-1 flex items-center gap-2 font-mono text-[11px]">
              <span className="text-[var(--color-fg-muted)]">205.30 USDsui</span>
              <span className="text-[var(--color-fg-dim)]">·</span>
              <span className="text-[var(--color-accent)]">Earn up to 11%</span>
            </div>
          </div>
          <div className="flex gap-2">
            <ActionButton glyph="plus" />
            <ActionButton glyph="send" />
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <ActivityPill
            tint="#c95a4a"
            label="Sent + saved"
            time="just now"
            amount="− ₦52"
            sub="+ ₦2 saved"
          />
          <ActivityPill
            tint="#4fb35e"
            label="Received from chiamaka@talise"
            time="2 hr ago"
            amount="+ ₦1,050,000"
          />
          <ActivityPill
            tint="#79d96c"
            label="Invested in Navi"
            time="yesterday"
            amount="− $40.00"
          />
        </div>
      </div>
    </div>
  );
}

function ActivityPill({
  tint,
  label,
  time,
  amount,
  sub,
}: {
  tint: string;
  label: string;
  time: string;
  amount: string;
  sub?: string;
}) {
  return (
    <div className="talise-glass flex items-center gap-3 rounded-2xl px-4 py-3 text-left">
      <span
        aria-hidden
        className="block h-7 w-7 rounded-full"
        style={{ background: `color-mix(in srgb, ${tint} 32%, transparent)` }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-[var(--color-fg)] truncate">{label}</div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--color-fg-dim)]">
          {time}
        </div>
      </div>
      <div className="text-right">
        <div
          className="text-[13px]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {amount}
        </div>
        {sub && (
          <div
            className="mt-0.5 font-mono text-[9px] text-[var(--color-accent)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ glyph }: { glyph: "plus" | "send" }) {
  return (
    <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--color-surface-2)] text-[var(--color-fg)]">
      {glyph === "plus" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22l-4-9-9-4z" />
        </svg>
      )}
    </div>
  );
}

function StatRow() {
  const stats: Array<[string, string, string]> = [
    ["avg send fee", "0%", "vs ~5% Wise"],
    ["settlement", "~1 sec", "any corridor"],
    ["fee at $100", "$0.00", "no markup"],
  ];
  return (
    <div className="mx-auto mt-20 grid max-w-[860px] grid-cols-1 gap-3 md:grid-cols-3">
      {stats.map(([label, value, sub]) => (
        <div
          key={label}
          className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-4 text-left"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
            {label}
          </div>
          <div
            className="mt-1 text-[28px] font-medium tracking-tight"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {value}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]">
            {sub}
          </div>
        </div>
      ))}
    </div>
  );
}

function PersonaCard({
  name,
  eyebrow,
  chip,
  before,
  after,
}: {
  name: string;
  eyebrow: string;
  chip: string;
  before: string;
  after: string;
}) {
  return (
    <article className="talise-glass rounded-2xl p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[18px] font-medium tracking-tight">{name}</h3>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
            {eyebrow}
          </div>
        </div>
        <div
          className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1 font-mono text-[11px] text-[var(--color-accent)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {chip}
        </div>
      </div>
      <div className="mt-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
          before
        </div>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
          {before}
        </p>
      </div>
      <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
          with talise
        </div>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-[var(--color-fg)]">
          {after}
        </p>
      </div>
    </article>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: Array<[string, string]>;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        {title}
      </div>
      <ul className="mt-3 space-y-2 text-[13px]">
        {links.map(([label, href]) => (
          <li key={label}>
            <a
              href={href}
              className="text-[var(--color-fg-muted)] transition hover:text-[var(--color-fg)]"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Glyphs

function Diamond() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2 22 12 12 22 2 12z"
        fill="var(--color-accent)"
        opacity="0.95"
      />
      <path d="M12 2 22 12 12 22 2 12z" stroke="var(--color-bg)" strokeWidth="0.8" fill="none" />
    </svg>
  );
}

function FeatureGlyph({ kind }: { kind: "send" | "leaf" | "sui" }) {
  const stroke = "var(--color-accent)";
  const fill = "color-mix(in srgb, var(--color-accent) 18%, transparent)";
  return (
    <span
      className="grid h-9 w-9 place-items-center rounded-full"
      style={{ background: fill }}
    >
      {kind === "send" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22l-4-9-9-4z" />
        </svg>
      )}
      {kind === "leaf" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill={stroke} stroke={stroke} strokeWidth="1.3">
          <path d="M20 4c-7 0-14 4-14 12 0 2 1 4 3 4 8 0 12-7 12-14a4 4 0 0 0-1-2z" />
        </svg>
      )}
      {kind === "sui" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8" />
          <path d="M9 9c3 3 6 0 6 6" />
        </svg>
      )}
    </span>
  );
}
