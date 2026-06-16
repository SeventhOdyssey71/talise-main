import { HugeiconsIcon } from "@hugeicons/react";
import {
  SquareLock02Icon,
  ShieldKeyIcon,
  Coins01Icon,
} from "@hugeicons/core-free-icons";
import { Eyebrow, StatusPill } from "@/components/app";
import { shieldConfigured, SHIELD } from "@/lib/shield/onchain";

export const dynamic = "force-dynamic";

/**
 * /app/private — shielded USDsui send (Talise's own ZK privacy layer).
 *
 * Reached from the iOS "Send private tx" tile (which opens this on the web app,
 * so the Groth16 proof is built in the user's own session; the relayer only
 * sponsors gas, never the note secrets). The shielded pool is published on
 * mainnet as a $10/tx operator-trusted pilot, but the SUBSYSTEM is gated by
 * `shieldConfigured()` (SHIELD_PKG + SHIELD_POOL_USDSUI) — which stays UNSET in
 * prod until the relayer keypair is funded + the env is set. So this page tells
 * the truth: explainer + honest pilot disclosure, and either "switching on"
 * (current) or the live send form (once flipped on).
 */
export default function PrivatePage() {
  const live = shieldConfigured();
  const capUsd = "$10";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-7 pb-10 pt-1">
      <header className="space-y-3">
        <Eyebrow>Private</Eyebrow>
        <h1 className="max-w-xl font-display text-[26px] font-medium leading-[1.15] tracking-[-0.03em] text-fg">
          Send USDsui, shielded.
        </h1>
        <p className="max-w-md text-[15px] leading-relaxed text-fg-muted">
          The amount and the link between sender and recipient stay private
          on-chain — and your money never leaves your control. The proof is built
          on your device; Talise only relays it.
        </p>
      </header>

      {/* Status */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,40,8,0.04),0_16px_40px_-20px_rgba(35,78,20,0.18)]">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent/10">
            <HugeiconsIcon icon={SquareLock02Icon} className="h-5 w-5 text-accent" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-[17px] font-medium tracking-[-0.02em] text-fg">
                Private payments
              </h2>
              <StatusPill
                label={live ? "Ready" : "Switching on"}
                tone={live ? "active" : "neutral"}
              />
            </div>
            <p className="text-[14px] leading-relaxed text-fg-muted">
              {live
                ? "Choose an amount and a recipient to send shielded. Each transaction is capped at " +
                  capUsd +
                  " during the pilot."
                : "The shielded pool is live on Sui mainnet and we're switching on private sends here shortly. Check back soon — your funds stay in your own wallet until then."}
            </p>
          </div>
        </div>
      </section>

      {/* What it does */}
      <section className="grid gap-3 sm:grid-cols-3">
        <InfoCard
          icon={SquareLock02Icon}
          title="Shielded"
          body="Sender, recipient and amount are hidden on-chain behind a zero-knowledge proof."
        />
        <InfoCard
          icon={Coins01Icon}
          title="Yours throughout"
          body="Non-custodial. Your money stays in your control the whole time — Talise only relays the proof."
        />
        <InfoCard
          icon={ShieldKeyIcon}
          title="Proof on device"
          body="The proof is generated in your own session. The relayer sponsors gas and never sees your note secrets."
        />
      </section>

      {/* Honest pilot disclosure */}
      <section className="rounded-2xl border border-border/70 bg-surface-2/40 p-5">
        <h3 className="mb-2.5 text-[13px] font-medium uppercase tracking-[0.08em] text-fg-muted">
          About this pilot
        </h3>
        <ul className="space-y-2 text-[13.5px] leading-relaxed text-fg-muted">
          <li className="flex gap-2.5">
            <Dot />
            <span>
              Early pilot — up to <span className="text-fg">{capUsd}</span> per
              transaction.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Dot />
            <span>
              The pool&apos;s keys are <span className="text-fg">operator-secured</span>{" "}
              while the fully trustless setup (a multi-party ceremony) and an
              external audit are completed. Send only what you&apos;re comfortable
              with during the pilot.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Dot />
            <span>Built on Sui — stablecoin transactions on Sui cost nothing.</span>
          </li>
        </ul>
      </section>

      {!live && (
        <p className="px-1 text-center text-[12.5px] text-fg-muted/80">
          Pool published on Sui mainnet
          {SHIELD.poolUsdsui ? "" : " · activation pending"}.
        </p>
      )}
    </div>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: typeof SquareLock02Icon;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <HugeiconsIcon icon={icon} className="mb-2.5 h-5 w-5 text-accent" />
      <h3 className="mb-1 text-[14px] font-medium text-fg">{title}</h3>
      <p className="text-[12.5px] leading-relaxed text-fg-muted">{body}</p>
    </div>
  );
}

function Dot() {
  return <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-fg-muted/50" />;
}
