import { Eyebrow, Headline, SectionShell } from "./primitives";

/**
 * Deep feature explainers — five focused sections that mirror the
 * original DeepFeatures block. Each section follows the same rhythm
 * (mono eyebrow → headline → 1–2 paragraph copy → either a 3-up "what
 * you get" row OR a visual sidecar mock).
 *
 * Light-mode restyle preserves every word of copy verbatim; only the
 * surfaces, type colors, and the accent-on-text usage have changed. The
 * iOS-feel cards (FauxSignInCard, FauxEarnCard, FauxFeeCard) STAY dark
 * since they are mockups OF the dark in-app surface, dropped into the
 * light page like inline screenshots.
 */
export function HowItWorks() {
  return (
    <SectionShell className="border-t border-[var(--landing-border)] py-24 md:py-32">
      <Eyebrow>built for everyday life</Eyebrow>
      <Headline size="md" className="mt-4 max-w-[820px]">
        Three screens.{" "}
        <span
          className="text-[var(--landing-fg-muted)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          That's the whole product.
        </span>
      </Headline>

      <div className="mt-16">
        <SectionLabel value="01 / sign-in" />
        <SignInDeep />
      </div>

      <Divider />

      <div>
        <SectionLabel value="02 / round-up & save" />
        <RoundupDeep />
      </div>

      <Divider />

      <div>
        <SectionLabel value="03 / earn" />
        <EarnDeep />
      </div>

      <Divider />

      <div>
        <SectionLabel value="04 / username" />
        <UsernameDeep />
      </div>

      <Divider />

      <div>
        <SectionLabel value="05 / no-fee transfers" />
        <GaslessDeep />
      </div>
    </SectionShell>
  );
}

function SectionLabel({ value }: { value: string }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--landing-fg-muted)]">
      {value}
    </div>
  );
}

function Divider() {
  return <div className="mx-auto my-24 h-px max-w-[1200px] bg-[var(--landing-border)]" />;
}

/** 01 — zkLogin sign-in. Text left, fake "Continue with Google" card right. */
function SignInDeep() {
  return (
    <div className="mt-3 grid items-center gap-12 md:grid-cols-[1.1fr_1fr] md:gap-16">
      <div>
        <h2 className="max-w-[600px] text-[clamp(30px,4.5vw,52px)] font-semibold leading-[1.08] tracking-tight text-[var(--landing-fg)]">
          Sign in.{" "}
          <span
            className="text-[var(--landing-fg-muted)]"
            style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
          >
            Don't sign up.
          </span>
        </h2>
        <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-[var(--landing-fg-dim)]">
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
      <div>
        <FauxSignInCard />
      </div>
    </div>
  );
}

/** 02 — Round-up & Save. Centered with a stat row + how-it-works strip. */
function RoundupDeep() {
  return (
    <div className="mt-3 text-center">
      <h2 className="mx-auto max-w-[820px] text-[clamp(30px,4.5vw,52px)] font-semibold leading-[1.08] tracking-tight text-[var(--landing-fg)]">
        Round up. Save up.{" "}
        <span
          className="text-[var(--landing-accent)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          Earn up.
        </span>
      </h2>
      <p className="mx-auto mt-5 max-w-[620px] text-[16px] leading-relaxed text-[var(--landing-fg-dim)]">
        Every time you send money, Talise quietly sweeps a small slice into
        a yield-bearing position. You pick the percentage (1% to 10%). The
        savings live on chain in your own wallet, earn lending yield in the
        background, and you can pull them out any time.
      </p>

      <div className="mx-auto mt-12 grid max-w-[900px] gap-3 sm:grid-cols-3">
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

      <p className="mx-auto mt-10 max-w-[640px] text-[14px] leading-relaxed text-[var(--landing-fg-muted)]">
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
      <div>
        <FauxEarnCard />
      </div>
      <div>
        <h2 className="max-w-[600px] text-[clamp(30px,4.5vw,52px)] font-semibold leading-[1.08] tracking-tight text-[var(--landing-fg)]">
          Idle money should{" "}
          <span
            className="text-[var(--landing-accent)]"
            style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
          >
            compound.
          </span>
        </h2>
        <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-[var(--landing-fg-dim)]">
          Tap Supply. Your USDsui flows into NAVI lending on Sui mainnet and
          starts earning the live supply APY. You see your position grow in
          real time, denominated in whatever local currency you prefer
          (naira, cedis, shillings, rand, pounds, dollars).
        </p>
        <p className="mt-3 max-w-[560px] text-[16px] leading-relaxed text-[var(--landing-fg-dim)]">
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
      <h2 className="mx-auto max-w-[820px] text-[clamp(30px,4.5vw,52px)] font-semibold leading-[1.08] tracking-tight text-[var(--landing-fg)]">
        A username,{" "}
        <span
          className="text-[var(--landing-fg-muted)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          not a wallet address.
        </span>
      </h2>
      <p className="mx-auto mt-5 max-w-[620px] text-[16px] leading-relaxed text-[var(--landing-fg-dim)]">
        Claim a Talise handle and people can pay you at{" "}
        <span className="font-mono text-[var(--landing-fg)]">name@talise</span>.
        It's a real on-chain SuiNS subname, anyone can look it up, and it
        resolves to your wallet without you ever sharing 32 hex characters.
      </p>

      <div className="mx-auto mt-12 max-w-[520px]">
        <FauxUsernameCard />
      </div>

      <div className="mx-auto mt-10 grid max-w-[900px] gap-3 sm:grid-cols-3">
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
      <div>
        <h2 className="max-w-[640px] text-[clamp(30px,4.5vw,52px)] font-semibold leading-[1.08] tracking-tight text-[var(--landing-fg)]">
          No SUI required.{" "}
          <span
            className="text-[var(--landing-accent)]"
            style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
          >
            Ever.
          </span>
        </h2>
        <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-[var(--landing-fg-dim)]">
          Most crypto apps ask you to buy a separate "gas token" before you
          can do anything. Talise hides that completely. We sponsor the gas
          on every transaction, and pure USDsui transfers ride Sui's
          protocol-native gasless flow, so even the sponsor doesn't pay.
        </p>
        <p className="mt-3 max-w-[560px] text-[16px] leading-relaxed text-[var(--landing-fg-dim)]">
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
      <div>
        <FauxFeeCard />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Dark mockup cards — these stay DARK because they ARE iOS app
// screenshots dropped into the light page like inline phone art.

function FauxSignInCard() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div className="rounded-3xl border border-[var(--landing-border)] bg-[#0a0e0b] p-8 text-white shadow-[0_22px_60px_-10px_rgba(0,0,0,0.25)]">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-white/45">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#79d96c]" />
          welcome to talise
        </div>
        <h3 className="mt-5 text-[26px] font-semibold leading-[1.15] tracking-tight">
          One Google account.
          <br />
          One Sui address.
        </h3>
        <p className="mt-3 text-[13px] leading-[1.55] text-white/65">
          No seed phrase, no setup.
        </p>
        <div className="mt-7 grid h-12 place-items-center rounded-xl bg-white text-[14px] font-medium text-[#0a0e0b]">
          <span className="inline-flex items-center gap-3">
            <SmallGoogleMark />
            Continue with Google
          </span>
        </div>
        <p className="mt-5 text-center text-[10px] uppercase tracking-[0.22em] text-white/45">
          backed by zklogin · ephemeral keys
        </p>
      </div>
    </div>
  );
}

function FauxEarnCard() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div className="rounded-3xl border border-[var(--landing-border)] bg-[#0a0e0b] p-7 text-white shadow-[0_22px_60px_-10px_rgba(0,0,0,0.25)]">
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
          Position
        </div>
        <h3 className="mt-1 text-[24px] font-semibold tracking-tight">Navi</h3>

        <div className="mt-5 rounded-2xl bg-white/[0.04] py-2">
          <KeyRow label="Supplied" value="₦57.39" />
          <KeyRow label="APY" value="4.93%" accent />
          <KeyRow label="Earning / day" value="₦0.078" />
        </div>

        <div className="mt-5 rounded-2xl bg-white/[0.04] px-4 py-3 text-left">
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
            Supply more
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span
              className="text-[20px] tracking-tight text-white/55"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              ₦ 0.00
            </span>
            <span className="rounded-full bg-[#79d96c]/22 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[#79d96c]">
              MAX
            </span>
          </div>
        </div>

        <div className="mt-4 grid h-11 place-items-center rounded-full bg-[#79d96c] text-[14px] font-medium text-[#0a0e0b]">
          Supply to Navi
        </div>
      </div>
    </div>
  );
}

function FauxUsernameCard() {
  return (
    <div className="relative rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-surface)] px-7 py-8">
      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--landing-fg-muted)]">
        receive at
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-[clamp(28px,4vw,42px)] font-semibold tracking-tight text-[var(--landing-fg)]">
        <span style={{ fontFamily: "var(--font-mono)" }}>chiamaka</span>
        <span className="text-[var(--landing-fg-muted)]">@</span>
        <span
          className="text-[var(--landing-accent)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          talise
        </span>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-[var(--landing-fg-dim)]">
        Resolves on-chain via SuiNS. Anyone can verify, no one can forge.
      </p>
    </div>
  );
}

function FauxFeeCard() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div className="rounded-3xl border border-[var(--landing-border)] bg-[#0a0e0b] p-8 text-center text-white shadow-[0_22px_60px_-10px_rgba(0,0,0,0.25)]">
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
          you send
        </div>
        <div
          className="mt-2 text-[44px] font-semibold tracking-tight"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          ₦50,000
        </div>

        <div className="my-6 h-px bg-white/10" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-left">
          <span className="text-[12px] text-white/55">Network gas</span>
          <span
            className="text-right font-mono text-[12px] text-[#79d96c]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            $0.00
          </span>
          <span className="text-[12px] text-white/55">Talise fee</span>
          <span
            className="text-right font-mono text-[12px] text-[#79d96c]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            $0.00
          </span>
          <span className="text-[12px] text-white/55">FX markup</span>
          <span
            className="text-right font-mono text-[12px] text-[#79d96c]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            $0.00
          </span>
        </div>

        <div className="mt-7 rounded-2xl bg-[#79d96c]/10 py-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#79d96c]">
            they receive
          </div>
          <div
            className="mt-1 text-[28px] font-semibold tracking-tight"
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
        <span className="text-[13px] text-white/55">{label}</span>
        <span
          className={
            accent
              ? "text-[15px] text-[#79d96c]"
              : "text-[15px] text-white"
          }
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </span>
      </div>
      <div className="mx-5 h-px bg-white/10 last:hidden" />
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
            className="mt-[7px] block h-1.5 w-1.5 flex-none rounded-full bg-[var(--landing-fg)]"
          />
          <div>
            <div className="text-[14px] font-semibold text-[var(--landing-fg)]">
              {title}
            </div>
            <div className="text-[13px] leading-relaxed text-[var(--landing-fg-dim)]">
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
    <div className="rounded-[18px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-6 py-7 text-left">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--landing-fg-muted)]">
        {label}
      </div>
      <div
        className="mt-2 text-[36px] font-semibold leading-none tracking-tight text-[var(--landing-fg)]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
      <div className="mt-2 text-[13px] leading-relaxed text-[var(--landing-fg-dim)]">
        {sub}
      </div>
    </div>
  );
}

function SmallNote({ eyebrow, body }: { eyebrow: string; body: string }) {
  return (
    <div className="rounded-[18px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-5 py-5 text-left">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--landing-fg-muted)]">
        {eyebrow}
      </div>
      <div className="mt-2 text-[13px] leading-relaxed text-[var(--landing-fg-dim)]">
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
