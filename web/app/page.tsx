import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import PremiumHero from "./_premium/PremiumHero";
import SmoothScroll from "./_premium/SmoothScroll";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SentIcon,
  Leaf01Icon,
  DollarCircleIcon,
  AppleIcon,
} from "@hugeicons/core-free-icons";
// LandingMotion removed — page is short enough now (Hero + FeatureGrid
// + FinalCta) that the GSAP scroll-trigger layer is more distraction
// than affordance.
// Web dashboard archived — sign-in/bootstrap redirect removed. Every
// CTA now routes to /waitlist; the only live web surface is landing +
// waitlist + litepaper.

export const dynamic = "force-dynamic";

/**
 * Talise marketing landing — dark, mobile-app-feel.
 *
 * Mirrors the iOS app's design system (DesignSystem/Tokens.swift): near-
 * black background with a soft green TopGlow wash, accent-green green
 * highlights, and the same Liquid-Glass card recipe (`.talise-glass`).
 * The page is intentionally short — one strong hero, three feature
 * tiles, two persona stories, and a closing CTA.
 */

export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="landing-mint relative min-h-screen overflow-hidden text-[var(--color-fg)]">
      <div className="talise-top-glow" aria-hidden />

      <SmoothScroll />
      <TopBar />

      <main className="relative z-10 mx-auto w-full max-w-[1440px] px-6 pb-32 md:px-12 lg:px-16">
        <PremiumHero err={params.err} />
        <HeroCollage />
        <HowItComposes />
        <FeatureGrid />
        <WhoItsFor />
        <SecuritySection />
        <ByTheNumbers />
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
    <header className="motion-topbar relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-5 md:px-12 lg:px-16">
      <Link
        href="/"
        className="flex items-center gap-2.5 text-[17px] tracking-tight text-[var(--color-fg)]"
      >
        <Diamond />
        <span>talise</span>
      </Link>
      {/* Nav links removed — the page is short enough that #how / #who
          anchor scrolls add noise rather than helping. The hero CTA is
          the only thing we want users to do. */}
      {/* Sign-in is gated until launch — render as a non-interactive
          placeholder (same language as the "iOS · Coming soon" pill). */}
      <span
        role="img"
        aria-label="Sign in coming soon"
        className="cursor-not-allowed select-none rounded-full border border-dashed border-[color-mix(in_srgb,var(--color-accent-deep)_38%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent-deep)_5%,transparent)] px-5 py-2 text-[14px] font-medium text-[var(--color-fg-dim)]"
      >
        Sign in
      </span>
    </header>
  );
}

// The app-screens collage + stat row, shown under the premium hero. (The old
// headline/CTA block moved into PremiumHero — see app/_premium/PremiumHero.tsx.)
function HeroCollage() {
  return (
    <section className="pb-4 pt-4 text-center md:pt-8">
      <PhoneCollage />
      <StatRow />
    </section>
  );
}

/**
 * Apple / iOS download button. The native beta is LIVE on TestFlight, so this
 * links straight to the public TestFlight invite. Styled as a white pill with
 * the Apple glyph (the conventional "get it on iOS" look) so it pairs with the
 * forest-green Join-waitlist CTA as a clear "web vs native" choice.
 */
const TESTFLIGHT_URL = "https://testflight.apple.com/join/BFNEPYtM";

function AppStoreButton() {
  return (
    <a
      href={TESTFLIGHT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Get the Talise iOS beta on TestFlight"
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-7 text-[14px] font-semibold text-black shadow-[0_6px_18px_-6px_rgba(0,0,0,0.45)] transition-colors hover:bg-white/90 sm:w-auto"
    >
      <AppleGlyph />
      <span>iOS · TestFlight</span>
    </a>
  );
}

function AppleGlyph() {
  return (
    <HugeiconsIcon icon={AppleIcon} size={17} color="currentColor" strokeWidth={1.8} aria-hidden />
  );
}

function PhoneCollage() {
  // Two-stage entrance:
  //   - The green radial wash fades + scales in first (slow, soft) so the
  //     stage is set before the artwork lands.
  //   - The collage itself drops in with a small upward translate + 6%
  //     scale-from-down — gentle, no hover noise, no shake.
  // `talise-collage-*` keyframes are defined in `globals.css`; they
  // respect prefers-reduced-motion by collapsing to identity transforms.
  return (
    <div className="motion-collage relative left-1/2 mt-12 w-screen max-w-none -translate-x-1/2 md:left-auto md:mx-auto md:mt-20 md:w-full md:max-w-[1280px] md:translate-x-0">
      <div
        aria-hidden
        className="talise-collage-glow pointer-events-none absolute inset-x-0 top-1/4 -z-10 mx-auto h-[80%] max-w-[1040px] blur-3xl"
        style={{
          background:
            "radial-gradient(58% 52% at 50% 42%, color-mix(in srgb, var(--color-accent-deep) 50%, transparent), transparent 68%), radial-gradient(46% 42% at 50% 58%, color-mix(in srgb, var(--color-accent) 30%, transparent), transparent 72%)",
        }}
      />
      <div className="talise-collage-art">
        <Image
          src="/talise-app-collage.png"
          alt="Talise iOS app: reviewing a cross-border send, an auto-save, and a completed transfer"
          width={6606}
          height={3516}
          priority
          sizes="(max-width: 768px) 100vw, 1280px"
          className="mx-auto h-auto w-full"
        />
      </div>
    </div>
  );
}

/**
 * Section: How it composes. The differentiator beat — shows the atomic
 * flow (Pay → Round-up → Earn → Receipt) as one signed transaction on
 * Sui. Reuses the talise-glass card recipe + mono-eyebrow rhythm of the
 * rest of the page. Steps render as a connected row on md+, stacking on
 * mobile, so the "one transaction" idea reads visually.
 */
function HowItComposes() {
  const steps: Array<{ step: string; title: string; body: string }> = [
    {
      step: "pay",
      title: "Send",
      body: "Pay a handle, a phone, or a wallet. One amount, one tap.",
    },
    {
      step: "round-up",
      title: "Round up",
      body: "A slice of the send sweeps into savings — you set 1% to 10%.",
    },
    {
      step: "earn",
      title: "Earn",
      body: "That slice moves into NAVI lending on Sui and starts compounding.",
    },
    {
      step: "receipt",
      title: "Receipt",
      body: "An on-chain receipt object is minted to your wallet as proof.",
    },
  ];

  return (
    <section
      id="composes"
      className="mt-28 border-t border-[var(--color-line)] pt-20"
    >
      <Reveal>
        <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)]">
          <span aria-hidden className="inline-block h-px w-8 bg-[var(--color-accent)]" />
          how it composes
        </div>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className="mt-3 max-w-[860px] text-[clamp(28px,4.5vw,46px)] font-medium leading-[1.08] tracking-[-0.01em]">
          Pay, round-up, earn, receipt —{" "}
          <span className="text-[var(--color-accent)]">
            one atomic transaction.
          </span>
        </h2>
      </Reveal>
      <Reveal delay={0.12}>
        <p className="mt-4 max-w-[620px] text-[14px] leading-[1.6] text-[var(--color-fg-muted)]">
          Other apps make you tap four times across four screens. Talise
          composes the whole flow into a single signed transaction on Sui:
          either every step lands together, or none of it does. One signature.
          Money as something you can program.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <Reveal key={s.step} delay={0.18 + i * 0.06}>
            <article className="talise-glass relative h-full rounded-2xl p-6">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
                  {`0${i + 1} / ${s.step}`}
                </div>
                {i < steps.length - 1 && (
                  <span
                    aria-hidden
                    className="font-mono text-[14px] text-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]"
                  >
                    →
                  </span>
                )}
              </div>
              <h3 className="mt-7 text-[18px] font-medium leading-[1.2] tracking-[-0.005em]">
                {s.title}
              </h3>
              <p className="mt-3 text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
                {s.body}
              </p>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.44}>
        <p className="mt-6 font-mono text-[11px] leading-[1.6] tracking-[0.04em] text-[var(--color-fg-dim)]">
          One PTB on Sui · signed once · gasless on USDsui transfers
        </p>
      </Reveal>
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
        "Send to a handle, a phone, or a wallet. We move dollars on Sui and pay out in the receiver's own currency, whether naira, cedis, yen, or dollars, faster than any traditional rail.",
      glyph: "send",
    },
    {
      eyebrow: "02 / earn",
      title: "Idle money should compound.",
      body:
        "Move USDsui into NAVI lending in one tap. Watch real-time yield. Withdraw anytime. No lockups, no jargon. Just a balance that quietly grows.",
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
      <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)]">
        <span aria-hidden className="inline-block h-px w-8 bg-[var(--color-accent)]" />
        how it works
      </div>
      <h2 className="mt-3 max-w-[720px] text-[clamp(28px,4.5vw,46px)] font-medium leading-[1.08] tracking-[-0.01em]">
        One app. Every corridor.{" "}
        <span
          className="text-[var(--color-fg-muted)]"
        >
          Arrives in seconds.
        </span>
      </h2>

      <div className="motion-feature-row mt-12 grid gap-4 md:grid-cols-3">
        {items.map((it) => (
          <article
            key={it.eyebrow}
            className="motion-feature-card talise-glass rounded-2xl p-6 transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
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

/**
 * Section: Who it's for. Three short paragraphs aimed at the diaspora
 * audience that the rest of the page already speaks to. Eyebrow + serif
 * accent on the headline mirrors the FeatureGrid rhythm directly above.
 * Each paragraph is wrapped in <Reveal> so they cascade in on scroll
 * (60ms stagger via the delay prop).
 */
function WhoItsFor() {
  return (
    <section id="who" className="mt-28 border-t border-[var(--color-line)] pt-20">
      <Reveal>
        <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)]">
          <span aria-hidden className="inline-block h-px w-8 bg-[var(--color-accent)]" />
          who it&apos;s for
        </div>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className="mt-3 max-w-[820px] text-[clamp(28px,4.5vw,46px)] font-medium leading-[1.08] tracking-[-0.01em]">
          Made for the people moving money{" "}
          <span
            className="text-[var(--color-accent)]"
          >
            across the world.
          </span>
        </h2>
      </Reveal>

      <div className="mt-10 grid max-w-[1100px] gap-8 md:grid-cols-3 md:gap-10">
        <Reveal delay={0.12}>
          <p className="text-[14px] leading-[1.65] text-[var(--color-fg-muted)]">
            For the diaspora sending part of every paycheck to family in Lagos,
            Manila, or Accra. The corridor is the whole product. We optimize
            for the receiver getting cash in their hand on the same day, not
            three business days later.
          </p>
        </Reveal>
        <Reveal delay={0.18}>
          <p className="text-[14px] leading-[1.65] text-[var(--color-fg-muted)]">
            For anyone tired of SWIFT taking days and eating five or six
            percent on the way. Talise rides Sui&apos;s settlement, not a chain
            of correspondent banks — the stablecoin leg costs nothing, and the
            bank payout settles in seconds.
          </p>
        </Reveal>
        <Reveal delay={0.24}>
          <p className="text-[14px] leading-[1.65] text-[var(--color-fg-muted)]">
            For anyone who wants idle savings to actually compound. The dollar
            sitting in your checking account earns nothing. The same dollar on
            Talise earns a live lending yield, in real time, with no lockup and
            no minimum.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * Section: Security. Three short cards explaining zkLogin, sponsored gas,
 * and App Attest in plain language. No "military-grade" claims; the
 * point is just to tell a curious user how the thing works.
 */
function SecuritySection() {
  const items: Array<{ eyebrow: string; title: string; body: string }> = [
    {
      eyebrow: "zklogin",
      title: "Sign in with Google. No seed phrase.",
      body:
        "Your wallet is derived from your Google account through a zero-knowledge proof. There's nothing to write down, nothing to lose. If you switch phones, you sign in again and the same wallet comes back.",
    },
    {
      eyebrow: "gasless on sui",
      title: "USDsui transfers are gasless.",
      body:
        "USDsui sends ride Sui's native gasless rail, so there's no gas token to hold and no fee to pay. For anything else, Talise sponsors the chain fee from its own gas pool. You only ever see one number when you send: the amount that lands.",
    },
    {
      eyebrow: "app attest",
      title: "Only a real Talise app can call us.",
      body:
        "The wallet only talks to the Talise backend from a genuine, unmodified Talise iOS app on a real iPhone, verified by Apple App Attest. Replicas, sideloaded clones, and scripts get rejected at the door.",
    },
  ];

  return (
    <section id="security" className="mt-28 border-t border-[var(--color-line)] pt-20">
      <Reveal>
        <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)]">
          <span aria-hidden className="inline-block h-px w-8 bg-[var(--color-accent)]" />
          security
        </div>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className="mt-3 max-w-[820px] text-[clamp(28px,4.5vw,46px)] font-medium leading-[1.08] tracking-[-0.01em]">
          No seed phrases.{" "}
          <span
            className="text-[var(--color-fg-muted)]"
          >
            No keys to lose.
          </span>
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {items.map((it, i) => (
          <Reveal key={it.eyebrow} delay={0.12 + i * 0.06}>
            <article className="talise-glass h-full rounded-2xl p-6 transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
                {it.eyebrow}
              </div>
              <h3 className="mt-7 text-[18px] font-medium leading-[1.2] tracking-[-0.005em]">
                {it.title}
              </h3>
              <p className="mt-3 text-[13px] leading-[1.6] text-[var(--color-fg-muted)]">
                {it.body}
              </p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/**
 * Section: By the numbers. Three single-stat cards. The first and last
 * are phrase-led (Fast transactions, Onchain finance reach); the middle
 * one keeps a hard number (0% gas) so the row reads as evidence rather
 * than slogans alone.
 */
function ByTheNumbers() {
  // Four selling points. Tightened headlines + shorter captions so the
  // copy fits a 4-card row without truncation on lg viewports.
  const stats: Array<{ value: string; caption: string }> = [
    {
      value: "1,100+",
      caption:
        "Accounts created on-chain — gasless, no wallet connect, just a Google sign-in.",
    },
    {
      value: "Network fee $0.00",
      caption: "Stablecoin transactions on Sui cost nothing. No gas token to hold.",
    },
    {
      value: "Onchain reach",
      caption: "Stablecoins, blue chips, and DeFi yield, all in one app.",
    },
    {
      value: "Multiple corridors",
      caption: "Naira, cedis, yen, dollars. Local rails in, local cash out.",
    },
  ];

  return (
    <section id="numbers" className="mt-28 border-t border-[var(--color-line)] pt-20">
      <Reveal>
        <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)]">
          <span aria-hidden className="inline-block h-px w-8 bg-[var(--color-accent)]" />
          the proof
        </div>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className="mt-3 max-w-[720px] text-[clamp(28px,4.5vw,46px)] font-medium leading-[1.08] tracking-[-0.01em]">
          Real users, already{" "}
          <span
            className="text-[var(--color-accent)]"
          >
            on-chain.
          </span>
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.value} delay={0.12 + i * 0.06}>
            <div className="talise-glass h-full rounded-2xl px-5 py-6">
              <div
                className="text-[clamp(22px,2.4vw,30px)] font-medium leading-[1.05] tracking-[-0.015em] text-[var(--color-fg)]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {s.value}
              </div>
              <div className="mt-3 text-[12px] leading-[1.55] text-[var(--color-fg-muted)]">
                {s.caption}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/**
 * Deep feature explainers — five focused sections after the 3-card
 * overview. Each section follows the same rhythm (mono eyebrow → serif
 * headline → 1–2 paragraph copy → either a 3-up "what you get" row OR a
 * visual sidecar mock) so the page feels like a single narrative
 * instead of a collection of disconnected blocks.
 */
function DeepFeatures() {
  return (
    <section className="mt-32 border-t border-[var(--color-line)] pt-24">
      <div className="motion-deep-section">
        <SectionLabel value="01 / sign-in" />
        <SignInDeep />
      </div>

      <Divider />

      <div className="motion-deep-section">
        <SectionLabel value="02 / round-up & save" />
        <RoundupDeep />
      </div>

      <Divider />

      <div className="motion-deep-section">
        <SectionLabel value="03 / earn" />
        <EarnDeep />
      </div>

      <Divider />

      <div className="motion-deep-section">
        <SectionLabel value="04 / username" />
        <UsernameDeep />
      </div>

      <Divider />

      <div className="motion-deep-section">
        <SectionLabel value="05 / no-fee transfers" />
        <GaslessDeep />
      </div>
    </section>
  );
}

function SectionLabel({ value }: { value: string }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)]">
      {value}
    </div>
  );
}

function Divider() {
  return <div className="mx-auto my-28 h-px max-w-[1200px] bg-[var(--color-line)]" />;
}

/** 01 — zkLogin sign-in. Text left, fake "Continue with Google" card right. */
function SignInDeep() {
  return (
    <div className="mt-3 grid items-center gap-12 md:grid-cols-[1.1fr_1fr] md:gap-16">
      <div className="motion-deep-item">
        <h2 className="max-w-[600px] text-[clamp(30px,4.5vw,52px)] font-medium leading-[1.08] tracking-[-0.015em]">
          Sign in.{" "}
          <span
            className="text-[var(--color-fg-muted)]"
          >
            Don't sign up.
          </span>
        </h2>
        <p className="mt-5 max-w-[560px] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
          Your Google account becomes a Sui wallet. There's no seed phrase to
          write down, no twelve-word backup to lose, no recovery process to
          fail at midnight. Talise uses Sui's zkLogin so the wallet is
          derived directly from your identity, verified by a zero-knowledge
          proof, and signed by an ephemeral key that lives only on your
          phone.
        </p>
        <FeatureBullets
          items={[
            ["One Google account", "One Sui address, deterministic, on-chain"],
            ["No seed phrase", "Recovery is automatic, just sign in again"],
            ["Ephemeral keys", "Session keys never persist, never leak"],
          ]}
        />
      </div>
      <div className="motion-deep-item">
        <FauxSignInCard />
      </div>
    </div>
  );
}

/** 02 — Round-up & Save. Centered with a stat row + how-it-works strip. */
function RoundupDeep() {
  return (
    <div className="mt-3 text-center">
      <h2 className="motion-deep-item mx-auto max-w-[820px] text-[clamp(30px,4.5vw,52px)] font-medium leading-[1.08] tracking-[-0.015em]">
        Round up. Save up.{" "}
        <span
          className="text-[var(--color-accent)]"
        >
          Earn up.
        </span>
      </h2>
      <p className="motion-deep-item mx-auto mt-5 max-w-[620px] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
        Every time you send money, Talise quietly sweeps a small slice into
        a yield-bearing position. You pick the percentage (1% to 10%). The
        savings live on chain in your own wallet, earn lending yield in the
        background, and you can pull them out any time.
      </p>

      <div className="motion-deep-item mx-auto mt-12 grid max-w-[900px] gap-3 sm:grid-cols-3">
        <BigStat
          label="set once"
          value="1–10%"
          sub="auto-save on every send"
        />
        <BigStat
          label="points back"
          value="5 pts / $1"
          sub="redeem for ₦500 airtime"
        />
        <BigStat
          label="liquid"
          value="anytime"
          sub="no lockups, no waiting"
        />
      </div>

      <p className="motion-deep-item mx-auto mt-10 max-w-[640px] text-[13px] leading-[1.6] text-[var(--color-fg-dim)]">
        Send ₦50, save ₦2. Send ₦5,000, save ₦200. Same swipe, same signed
        transaction. By the end of the month, your "lazy money" pile has
        grown without you doing anything.
      </p>
    </div>
  );
}

/** 03 — Earn yield via NAVI. Visual sidecar on the LEFT this time. */
function EarnDeep() {
  return (
    <div className="mt-3 grid items-center gap-12 md:grid-cols-[1fr_1.1fr] md:gap-16">
      <div className="motion-deep-item">
        <FauxEarnCard />
      </div>
      <div className="motion-deep-item">
        <h2 className="max-w-[600px] text-[clamp(30px,4.5vw,52px)] font-medium leading-[1.08] tracking-[-0.015em]">
          Idle money should{" "}
          <span
            className="text-[var(--color-accent)]"
          >
            compound.
          </span>
        </h2>
        <p className="mt-5 max-w-[560px] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
          Tap Supply. Your USDsui flows into NAVI lending on Sui mainnet and
          starts earning the live supply APY. You see your position grow in
          real time, denominated in whatever local currency you prefer
          (naira, cedis, shillings, rand, pounds, dollars).
        </p>
        <p className="mt-3 max-w-[560px] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
          Withdraw anytime in one tap. No lockup, no cooldown, no early-exit
          penalty. The money was always yours, sitting in your wallet.
        </p>
        <FeatureBullets
          items={[
            ["Live APY", "Pulled directly from the NAVI pool every load"],
            ["Daily earning", "Visible in your local currency, not USD"],
            ["No lockup", "Supply, withdraw, supply again, no friction"],
          ]}
        />
      </div>
    </div>
  );
}

/** 04 — SuiNS @username receive. Centered, with a "you@talise" card. */
function UsernameDeep() {
  return (
    <div className="mt-3 text-center">
      <h2 className="motion-deep-item mx-auto max-w-[820px] text-[clamp(30px,4.5vw,52px)] font-medium leading-[1.08] tracking-[-0.015em]">
        A username,{" "}
        <span
          className="text-[var(--color-fg-muted)]"
        >
          not a wallet address.
        </span>
      </h2>
      <p className="motion-deep-item mx-auto mt-5 max-w-[620px] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
        Claim a Talise handle and people can pay you at{" "}
        <span className="font-mono text-[var(--color-fg)]">name@talise</span>.
        It's a real on-chain SuiNS subname, anyone can look it up, and it
        resolves to your wallet without you ever sharing 32 hex characters.
      </p>

      <div className="motion-deep-item mx-auto mt-12 max-w-[520px]">
        <FauxUsernameCard />
      </div>

      <div className="motion-deep-item mx-auto mt-10 grid max-w-[900px] gap-3 sm:grid-cols-3">
        <SmallNote
          eyebrow="receivers"
          body="Share `name@talise` instead of an address. People remember it."
        />
        <SmallNote
          eyebrow="senders"
          body="Type a handle, a phone number, or a wallet. We resolve it."
        />
        <SmallNote
          eyebrow="trustless"
          body="It's a SuiNS NFT in your wallet. Move it. Sell it. Burn it."
        />
      </div>
    </div>
  );
}

/** 05 — Gas-free transfers. Big "$0.00" hero stat + explanation. */
function GaslessDeep() {
  return (
    <div className="mt-3 grid items-center gap-12 md:grid-cols-[1fr_1.1fr] md:gap-16">
      <div className="motion-deep-item">
        <h2 className="max-w-[640px] text-[clamp(30px,4.5vw,52px)] font-medium leading-[1.08] tracking-[-0.015em]">
          No SUI required.{" "}
          <span
            className="text-[var(--color-accent)]"
          >
            Ever.
          </span>
        </h2>
        <p className="mt-5 max-w-[560px] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
          Most crypto apps ask you to buy a separate "gas token" before you
          can do anything. Talise hides that completely. We sponsor the gas
          on every transaction, and pure USDsui transfers ride Sui's
          protocol-native gasless flow, so even the sponsor doesn't pay.
        </p>
        <p className="mt-3 max-w-[560px] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
          You see a single number when you send: the amount that lands on
          the other side. No "gas fee," no "network surcharge," no surprise
          line item.
        </p>
        <FeatureBullets
          items={[
            ["Sponsored gas", "Talise pays the network fee on every tx"],
            ["Protocol gasless", "USDsui transfers use Sui's allowlisted path"],
            ["One number", "What you send is what they receive"],
          ]}
        />
      </div>
      <div className="motion-deep-item">
        <FauxFeeCard />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Small visual mocks used by the deep-feature sections

function FauxSignInCard() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 35%, color-mix(in srgb, var(--color-accent) 28%, transparent), transparent 70%)",
        }}
      />
      <div className="talise-glass rounded-3xl p-8">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          welcome to talise
        </div>
        <h3 className="mt-5 text-[26px] font-medium leading-[1.15] tracking-tight">
          One Google account.
          <br />
          One Sui address.
        </h3>
        <p className="mt-3 text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
          No seed phrase, no setup.
        </p>
        <div className="mt-7 grid h-12 place-items-center rounded-xl bg-[var(--color-fg)] text-[14px] font-medium text-[var(--color-bg)]">
          <span className="inline-flex items-center gap-3">
            <SmallGoogleMark />
            Continue with Google
          </span>
        </div>
        <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
          backed by zklogin · ephemeral keys
        </p>
      </div>
    </div>
  );
}

function FauxEarnCard() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 50%, color-mix(in srgb, var(--color-accent) 28%, transparent), transparent 70%)",
        }}
      />
      <div className="talise-glass rounded-3xl p-7">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
          Position
        </div>
        <h3 className="mt-1 text-[24px] font-medium tracking-tight">Navi</h3>

        <div className="mt-5 rounded-2xl bg-[var(--color-surface)] py-2">
          <KeyRow label="Supplied" value="₦57.39" />
          <KeyRow label="APY" value="4.93%" accent />
          <KeyRow label="Earning / day" value="₦0.078" />
        </div>

        <div className="mt-5 rounded-2xl bg-[var(--color-surface)] px-4 py-3 text-left">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
            Supply more
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span
              className="text-[20px] tracking-tight text-[var(--color-fg-muted)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              ₦ 0.00
            </span>
            <span className="rounded-full bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              MAX
            </span>
          </div>
        </div>

        <div className="mt-4 grid h-11 place-items-center rounded-full bg-[var(--color-accent)] text-[14px] font-medium text-[var(--color-bg)]">
          Supply to Navi
        </div>
      </div>
    </div>
  );
}

function FauxUsernameCard() {
  return (
    <div className="talise-glass relative rounded-3xl px-7 py-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        receive at
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-[clamp(28px,4vw,42px)] font-medium tracking-[-0.01em]">
        <span style={{ fontFamily: "var(--font-mono)" }}>chiamaka</span>
        <span className="text-[var(--color-fg-dim)]">@</span>
        <span
          className="text-[var(--color-accent)]"
        >
          talise
        </span>
      </div>
      <p className="mt-3 text-[12px] leading-[1.55] text-[var(--color-fg-muted)]">
        Resolves on-chain via SuiNS. Anyone can verify, no one can forge.
      </p>
    </div>
  );
}

function FauxFeeCard() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 50%, color-mix(in srgb, var(--color-accent) 32%, transparent), transparent 70%)",
        }}
      />
      <div className="talise-glass rounded-3xl p-8 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
          you send
        </div>
        <div
          className="mt-2 text-[44px] font-medium tracking-tight"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          ₦50,000
        </div>

        <div className="my-6 h-px bg-[var(--color-line)]" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-left">
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            Network gas
          </span>
          <span
            className="text-right font-mono text-[12px] text-[var(--color-accent)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            $0.00
          </span>
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            Talise fee
          </span>
          <span
            className="text-right font-mono text-[12px] text-[var(--color-accent)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            $0.00
          </span>
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            FX markup
          </span>
          <span
            className="text-right font-mono text-[12px] text-[var(--color-accent)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            $0.00
          </span>
        </div>

        <div className="mt-7 rounded-2xl bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
            they receive
          </div>
          <div
            className="mt-1 text-[28px] font-medium tracking-tight text-[var(--color-fg)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            ₦50,000
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-5 py-3 text-left">
        <span className="text-[13px] text-[var(--color-fg-muted)]">{label}</span>
        <span
          className={
            accent
              ? "text-[15px] text-[var(--color-accent)]"
              : "text-[15px] text-[var(--color-fg)]"
          }
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </span>
      </div>
      <div className="mx-5 h-px bg-[var(--color-line)] last:hidden" />
    </>
  );
}

function FeatureBullets({ items }: { items: Array<[string, string]> }) {
  return (
    <ul className="mt-7 space-y-3">
      {items.map(([title, body]) => (
        <li key={title} className="flex gap-3 text-left">
          <span
            aria-hidden
            className="mt-[7px] block h-1.5 w-1.5 flex-none rounded-full bg-[var(--color-accent)]"
          />
          <div>
            <div className="text-[14px] font-medium text-[var(--color-fg)]">
              {title}
            </div>
            <div className="text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
              {body}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BigStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="talise-glass rounded-2xl px-6 py-7 text-left">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        {label}
      </div>
      <div
        className="mt-2 text-[36px] font-medium leading-none tracking-tight text-[var(--color-accent)]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] leading-[1.55] text-[var(--color-fg-muted)]">
        {sub}
      </div>
    </div>
  );
}

function SmallNote({ eyebrow, body }: { eyebrow: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-5 text-left shadow-[0_8px_24px_-10px_rgba(35,78,20,0.14),0_1px_3px_rgba(35,78,20,0.05)]">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        {eyebrow}
      </div>
      <div className="mt-2 text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
        {body}
      </div>
    </div>
  );
}

function SmallGoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
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
        >
          diaspora.
        </span>
      </h2>
      <p className="mt-4 max-w-[560px] text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">
        Every month, millions of Africans abroad send a piece of their salary
        home. Talise is for the person sending it, and the family waiting on
        it.
      </p>

      <div className="motion-persona-row mt-12 grid gap-4 md:grid-cols-2">
        <PersonaCard
          name="Chiamaka"
          eyebrow="London → Lagos · NHS Nurse, sending home"
          chip="£500 → ₦1,050,000"
          before="Sends £500 home every month. Western Union takes around £32 in fees plus a poor exchange rate, roughly £45 lost per transfer."
          after="With Talise, the fee on £500 is near zero. She saves about £40 a month, £480 a year, and her mum gets the cash in under 5 seconds."
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
    <section className="motion-final mt-32 text-center">
      <h2 className="mx-auto max-w-[900px] text-[clamp(32px,4.5vw,52px)] font-medium leading-[1.05] tracking-[-0.02em]">
        Send. Save. Earn.{" "}
        <span
          className="text-[var(--color-accent)]"
        >
          In one signature.
        </span>
      </h2>
      <p className="mx-auto mt-5 max-w-[560px] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
        Stablecoin transactions on Sui cost nothing — network fee $0.00. We
        earn a small spread only when money changes currency or cashes out,
        the way Wise and Revolut do, only smaller.
      </p>
      <div className="mx-auto mt-9 flex w-full max-w-[280px] flex-col items-stretch gap-2 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
        {/* Talise is in private beta — every Get started/Sign up CTA
            routes to the waitlist, not Google sign-in. When we
            flip the doors open this swaps back to SignInButton. */}
        <Link
          href="/waitlist"
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--color-accent-deep)] px-7 text-[14px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(35,78,20,0.45)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_88%,white)] sm:w-auto"
        >
          Join waitlist
        </Link>
        <AppStoreButton />
      </div>
      <p className="mx-auto mt-6 max-w-[520px] text-[12px] leading-[1.55] text-[var(--color-fg-muted)]/70">
        Want the full picture?{" "}
        <Link
          href="/litepaper"
          className="text-[var(--color-fg-muted)] underline decoration-[var(--color-fg-muted)]/40 underline-offset-[3px] transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
        >
          Read the litepaper
        </Link>
        .
      </p>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="motion-footer relative z-10 border-t border-[var(--color-line)] bg-[var(--color-bg)]">
      <div className="mx-auto w-full max-w-[1440px] px-6 py-12 md:px-12 lg:px-16">
        {/* Pre-launch shape — no product columns, no corridor list,
            no careers/blog. On mobile, the brand row, the "Built on"
            row, and the nav stack vertically with even spacing; on
            sm+ the brand + nav sit on one line. */}
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Link href="/" className="flex items-center gap-2 text-[15px] tracking-tight text-[var(--color-fg)]">
              <Diamond />
              <span>talise</span>
            </Link>
            <span aria-hidden className="hidden text-[var(--color-fg-dim)] sm:inline">·</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-fg-muted)]">
              Built on
              <SuiDrop />
            </span>
          </div>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[var(--color-fg-muted)]">
            <a href="/litepaper" className="transition hover:text-[var(--color-fg)]">Litepaper</a>
            <a
              href="mailto:team@talise.io"
              className="transition hover:text-[var(--color-fg)]"
            >
              team@talise.io
            </a>
          </nav>
        </div>

        {/* Tiny social row + copyright. Stacks on mobile with the
            copyright above the social icons; sits side-by-side on sm+. */}
        <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
            © {new Date().getFullYear()} Talise, Inc.
          </div>
          <SocialRow />
        </div>

        {/* Oversized wordmark — visual grounding so the footer doesn't
            fade out into nothing. */}
        <div
          aria-hidden
          className="mt-10 select-none overflow-hidden whitespace-nowrap text-[clamp(80px,18vw,260px)] font-medium leading-[0.85] tracking-[-0.04em] text-[var(--color-fg)] opacity-[0.04]"
        >
          talise.
        </div>
      </div>
    </footer>
  );
}

/** Compact social row in the footer's branding block. */
function SocialRow() {
  const socials: Array<{ href: string; label: string; icon: ReactNode }> = [
    {
      href: "https://x.com/taliseio",
      label: "Talise on X",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
    },
  ];
  return (
    <div className="mt-6 flex items-center gap-2">
      {socials.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={s.label}
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]"
        >
          {s.icon}
        </a>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Small primitives

// Map an auth error CODE to a fixed, friendly message. We NEVER render the raw
// `?err=` value — it's attacker-controllable (a `/?err=<text>` link is an
// apex-domain phishing / text-injection vector), so only known copy is shown.
function friendlyAuthError(code: string): string {
  const map: Record<string, string> = {
    access_denied: "Sign-in was cancelled.",
    unverified_email:
      "Your Google email isn't verified — verify it and try again.",
    bad_state: "Your sign-in session expired. Please try again.",
    bad_audience: "Sign-in configuration error. Please contact support.",
    missing_code: "Sign-in didn't complete. Please try again.",
    oauth_error: "Google sign-in failed. Please try again.",
    signin_failed: "Something went wrong signing in. Please try again.",
  };
  return map[code] ?? "Something went wrong signing in. Please try again.";
}

function ErrorBanner({ err }: { err: string }) {
  return (
    <div
      role="status"
      className="mx-auto mt-6 max-w-[460px] rounded-xl border border-[#c95a4a4d] bg-[#c95a4a14] px-4 py-3 text-[12px] text-[#f0a99e]"
    >
      <span className="font-mono uppercase tracking-[0.18em] opacity-70">
        sign-in error ·{" "}
      </span>
      {friendlyAuthError(err)}
    </div>
  );
}

function StatRow() {
  const stats: Array<[string, string, string]> = [
    ["one signature", "1 tap", "send, save, earn, receipt"],
    ["finality", "<1s", "sub-second on Sui"],
    ["network fee", "$0.00", "stablecoin tx on Sui"],
  ];
  return (
    <div className="motion-stat-row mx-auto mt-20 grid max-w-[860px] grid-cols-1 gap-3 md:grid-cols-3">
      {stats.map(([label, value, sub]) => (
        <div
          key={label}
          className="motion-stat rounded-2xl border border-[#d6e8c6] bg-[#f6fbef] px-5 py-4 text-left shadow-[0_8px_24px_-10px_rgba(35,78,20,0.14),0_1px_3px_rgba(35,78,20,0.05)]"
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
    <article className="motion-persona talise-glass rounded-2xl p-6">
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

// ───────────────────────────────────────────────────────────────────
// Glyphs

/**
 * Brand mark — the actual Talise symbol from `public/symbol.svg`.
 * Path data is inlined here so we can fill it with the live
 * `--color-accent` CSS var (the source SVG ships with `fill="black"`,
 * which would render invisible on the dark page bg). The viewBox /
 * sizing is preserved so the visual scale matches the original asset.
 */
function SuiDrop() {
  // Sui brand droplet, lifted verbatim from the iOS app asset
  // (ios/Talise/Resources/Assets.xcassets/sui-drop.imageset/sui-drop.svg).
  // currentColor so it inherits the parent text color cleanly.
  return (
    <svg
      width="11"
      height="14"
      viewBox="0 0 13.764 17.9995"
      fill="currentColor"
      aria-hidden
      style={{ display: "inline-block", verticalAlign: "-2px" }}
    >
      <path d="M11.012 7.50751C11.7589 8.46651 12.163 9.64801 12.16 10.8635C12.1612 12.0972 11.7454 13.295 10.98 14.2625L10.916 14.3415L10.901 14.2355C10.8857 14.1484 10.868 14.0617 10.848 13.9755C10.478 12.3195 9.28102 10.8955 7.30102 9.74151C5.96702 8.96851 5.19902 8.03651 4.99802 6.97851C4.88958 6.3187 4.94417 5.64239 5.15702 5.00851C5.30702 4.51451 5.54202 4.04851 5.85102 3.63251L6.62402 2.66951C6.65523 2.63088 6.69469 2.59973 6.73951 2.57833C6.78432 2.55692 6.83335 2.54581 6.88302 2.54581C6.93268 2.54581 6.98171 2.55692 7.02653 2.57833C7.07134 2.59973 7.1108 2.63088 7.14202 2.66951L11.012 7.50751ZM12.229 6.54451L7.07302 0.0915108C7.05025 0.0629638 7.02135 0.0399125 6.98846 0.0240698C6.95557 0.00822703 6.91953 0 6.88302 0C6.84651 0 6.81046 0.00822703 6.77757 0.0240698C6.74468 0.0399125 6.71578 0.0629638 6.69302 0.0915108L1.53502 6.54951L1.51902 6.56551C0.531779 7.82089 -0.00337607 9.37245 1.60268e-05 10.9695C0.00101603 14.8495 3.08302 17.9995 6.88302 17.9995C10.683 17.9995 13.764 14.8495 13.764 10.9695C13.7674 9.37245 13.2323 7.82089 12.245 6.56551L12.229 6.54451ZM2.76902 7.48651L3.23002 6.90951L3.24602 7.01551L3.28302 7.26951C3.58502 8.87351 4.64902 10.2075 6.43302 11.2395C7.98302 12.1445 8.88302 13.1825 9.14302 14.3205C9.24902 14.7965 9.27002 15.2625 9.22302 15.6705V15.6965L9.20102 15.7065C8.48102 16.0665 7.68802 16.2535 6.88302 16.2525C3.97102 16.2525 1.60502 13.8385 1.60502 10.8635C1.60502 9.58851 2.03802 8.41351 2.76902 7.48651Z" />
    </svg>
  );
}

function Diamond() {
  return (
    <svg width="24" height="22" viewBox="0 0 583 533" aria-hidden>
      <path
        d="M375.231 85.2803C375.232 120.604 403.867 149.24 439.191 149.24H582.036V195.141C582.036 275.133 517.696 340.098 437.943 341.108L435.271 341.125C402.04 341.546 375.232 368.614 375.231 401.944V533H345.384C260.606 533 191.88 464.274 191.88 379.496V341.12H0V303.18C8.18875e-05 219.067 67.6907 150.62 151.798 149.686L191.875 149.24V341.119H427.871C396.135 332.728 367.039 316.441 343.293 293.774L191.876 149.24H191.88V63.96C191.88 28.6358 220.516 0 255.84 0H375.231V85.2803Z"
        fill="var(--color-accent)"
      />
    </svg>
  );
}

function FeatureGlyph({ kind }: { kind: "send" | "leaf" | "sui" }) {
  // HugeIcons glyph on a pale-mint disc — reads cleanly on the white
  // feature cards of the light-mint landing.
  const icon =
    kind === "send" ? SentIcon : kind === "leaf" ? Leaf01Icon : DollarCircleIcon;
  const fill = "color-mix(in srgb, var(--color-accent-deep) 14%, #ffffff)";
  return (
    <span
      className="grid h-9 w-9 place-items-center rounded-full"
      style={{ background: fill }}
    >
      <HugeiconsIcon
        icon={icon}
        size={17}
        color="var(--color-accent-deep)"
        strokeWidth={1.8}
      />
    </span>
  );
}
