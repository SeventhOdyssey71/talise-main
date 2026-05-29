"use client";

import { useEffect, useState } from "react";
import { EVENT_LABELS, formatPointsDelta, POINTS } from "@/lib/rewards-constants";
import type { RewardsEvent, RewardsEventKind } from "@/lib/db";

/**
 * Premium black/white chrome for the rewards page. Hero card displays the
 * user's referral code in DM Sans display; landscape variant of the
 * UsernameCard treatment.
 */
export function RewardsPanel({
  code,
  recentEvents,
}: {
  code: string;
  recentEvents: RewardsEvent[];
}) {
  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/?ref=${code}`
      : `https://talise.io/?ref=${code}`;

  return (
    <div>
      <ReferralHeroCard code={code} link={link} />

      {/* The 4-tile stat row is rendered by <RewardsHero/> above this
          panel — leaving it duplicated here would be visual noise. */}

      <div className="mt-10">
        <SectionRow title="Activity" />
        {recentEvents.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)] p-10 text-center">
            <div className="mx-auto h-9 w-9 rounded-full border border-[var(--color-line)]" />
            <p className="mt-4 text-[14px] text-[var(--color-fg)]">
              No points yet — share your code to get started.
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
              You earn the moment someone signs up with your code.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {recentEvents.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-10">
        <SectionRow title="How points work" />
        <ul className="mt-4 divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)]">
          <PolicyRow
            label="Invite a friend"
            detail="They sign in with your code"
            points={POINTS.REFERRAL_SIGNUP_REFERRER}
          />
          <PolicyRow
            label="They make their first send"
            detail="You both earn — every time"
            points={POINTS.REFERRAL_FIRST_SEND_REFERRER}
          />
          <PolicyRow
            label="Send volume"
            detail="Per $100 USDsui sent"
            points={POINTS.VOLUME_PER_100_USDSUI}
          />
        </ul>
      </div>
    </div>
  );
}

function ReferralHeroCard({ code, link }: { code: string; link: string }) {
  const [copied, setCopied] = useState(false);

  // Re-derive the visible URL once we hit the client so SSR matches.
  const [displayLink, setDisplayLink] = useState(link);
  useEffect(() => {
    setDisplayLink(`${window.location.origin}/?ref=${code}`);
  }, [code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(displayLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function share() {
    const shareData = {
      title: "Talise",
      text: "Send money home — instantly, almost free. Use my code on Talise:",
      url: displayLink,
    };
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* fall through to copy */
      }
    }
    await copy();
  }

  return (
    <div
      className={
        "group relative w-full overflow-hidden rounded-2xl border border-white/10 " +
        "bg-gradient-to-br from-[#0a0a0a] via-[#0f0f0f] to-[#1a1a1a] " +
        "shadow-[0_8px_30px_rgba(0,0,0,0.35)] " +
        "p-6 md:p-8"
      }
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(640px circle at 85% 110%, rgba(255,255,255,0.06), transparent 60%), radial-gradient(540px circle at 10% -10%, rgba(255,255,255,0.04), transparent 55%)",
        }}
      />

      <div className="relative flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/70">
          your referral code
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
          <span className="inline-flex h-1 w-1 rounded-full bg-white/80" />
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/55">
            live
          </span>
        </span>
      </div>

      <div className="relative mt-6 flex flex-wrap items-end justify-between gap-6 md:mt-8">
        <div className="min-w-0">
          <div className="font-display text-[40px] font-semibold leading-[1] tracking-[-0.03em] text-white md:text-[56px]">
            {code}
          </div>
          <div className="mt-3 truncate font-mono text-[11px] text-white/55 md:text-[12px]">
            {displayLink}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-white/15 bg-white/[0.04] px-4 py-2.5 text-[13px] text-white/90 transition hover:bg-white/[0.08]"
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={share}
            className="rounded-md bg-white px-4 py-2.5 text-[13px] font-medium text-[#0a0a0a] transition hover:bg-white/90"
          >
            Share
          </button>
        </div>
      </div>

      <div className="relative mt-8 grid grid-cols-3 gap-4 border-t border-white/10 pt-5 text-left">
        <HeroMetric label="Per signup" value={`+${POINTS.REFERRAL_SIGNUP_REFERRER}`} />
        <HeroMetric label="On first send" value={`+${POINTS.REFERRAL_FIRST_SEND_REFERRER}`} />
        <HeroMetric label="Per $100 sent" value={`+${POINTS.VOLUME_PER_100_USDSUI}`} />
      </div>
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/40">
        {label}
      </div>
      <div className="mt-1 font-display text-[18px] font-medium tracking-tight text-white md:text-[20px]">
        {value}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: RewardsEvent }) {
  const label = EVENT_LABELS[event.kind as RewardsEventKind] ?? event.kind;
  const when = relativeTime(event.created_at);
  return (
    <li className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3.5 text-[13px]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-line)] text-[12px] text-[var(--color-fg)]">
          +
        </span>
        <div className="min-w-0">
          <div className="truncate text-[var(--color-fg)]">{label}</div>
          <div className="font-mono text-[11px] text-[var(--color-fg-dim)]">
            {when}
          </div>
        </div>
      </div>
      <div className="font-mono text-[13px] text-[var(--color-fg)]">
        {formatPointsDelta(event.points)}
      </div>
    </li>
  );
}

function PolicyRow({
  label,
  detail,
  points,
}: {
  label: string;
  detail: string;
  points: number;
}) {
  return (
    <li className="flex items-center justify-between px-5 py-4 text-[13px]">
      <div className="min-w-0">
        <div className="text-[var(--color-fg)]">{label}</div>
        <div className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]">
          {detail}
        </div>
      </div>
      <div className="shrink-0 font-mono text-[13px] text-[var(--color-fg)]">
        +{points.toLocaleString()}
      </div>
    </li>
  );
}

function SectionRow({ title }: { title: string }) {
  return (
    <h2 className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
      {title}
    </h2>
  );
}


function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(mo / 12);
  return `${yr}y ago`;
}
