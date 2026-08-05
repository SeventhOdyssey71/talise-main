"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../data/api";

/**
 * Reward banner + claim dialog for the web app.
 *
 * Renders NOTHING unless this account has an unopened gift. `/api/rewards/grant`
 * is scoped to the session, so a user who was not rewarded never learns rewards
 * exist — the banner is absent rather than empty.
 *
 * Takes the slot the perps announcement used to occupy. A launch banner is
 * broadcast to everybody; this one is addressed to one person, which is why it
 * outranks it for the accounts that have it.
 */

type Grant = { id: string; amountUsd: number; reason: string };
type Phase = "sealed" | "opening" | "opened";

export function RewardBanner({ fallback }: { fallback?: React.ReactNode }) {
  const [grant, setGrant] = useState<Grant | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("sealed");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Fails silently: a gift is a delight, never a reason to break Home.
    api<{ grant: Grant | null }>("/api/rewards/grant")
      .then((r) => {
        if (alive && r.grant && r.grant.amountUsd > 0) setGrant(r.grant);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const claim = useCallback(async () => {
    if (!grant || phase !== "sealed") return;
    setPhase("opening");
    setError(null);
    try {
      await api("/api/rewards/grant/claim", { method: "POST", body: { id: grant.id } });
      setPhase("opened");
    } catch (e) {
      const msg = (e as Error).message ?? "";
      // 409 means it was opened elsewhere. The money is theirs either way, so
      // show the happy state rather than an error about a race they won.
      if (msg.toLowerCase().includes("already")) {
        setPhase("opened");
      } else {
        setPhase("sealed");
        setError("Couldn't open that just now. Please try again.");
      }
    }
  }, [grant, phase]);

  function close() {
    setOpen(false);
    // Only consume the gift once it is actually open; dismissing a sealed one
    // leaves the banner in place so nothing is lost by clicking away.
    if (phase === "opened") setGrant(null);
    setPhase("sealed");
    setError(null);
  }

  if (!grant) return <>{fallback ?? null}</>;

  const amount = `$${grant.amountUsd.toFixed(2)}`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group flex w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-accent-light)] px-4 py-2.5 text-center text-[#1c3d12] transition-colors hover:bg-[#bcf2a2]"
      >
        <span className="bg-[#1c3d12] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-accent-light)] sm:text-[9.5px]">
          Gift
        </span>
        <span
          className="text-[13px] font-[500] sm:text-[14px]"
          style={{ fontFamily: '"TWK Everett", var(--font-display-v2), system-ui, sans-serif' }}
        >
          You&rsquo;ve received a Talise reward! 🎉
        </span>
        <span aria-hidden className="font-mono text-[12px] transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={close}
        >
          <div
            className="w-full max-w-[420px] rounded-[18px] border border-[var(--color-line)] bg-white p-8 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <GiftMark opened={phase === "opened"} />

            <h2
              className="mt-6 text-[30px] leading-tight tracking-[-0.03em] text-[var(--color-fg)]"
              style={{ fontFamily: '"TWK Everett", var(--font-display-v2), system-ui, sans-serif' }}
            >
              {phase === "opened" ? "It's yours" : "You've got a gift"}
            </h2>

            {/* Hidden until claimed — a gift you can already price is just a
                notification. */}
            {phase === "opened" && (
              <div
                className="mt-3 text-[42px] font-medium tracking-[-0.04em] text-[#2f6a1f] tabular-nums"
                style={{ fontFamily: '"TWK Everett", var(--font-display-v2), system-ui, sans-serif' }}
              >
                {amount}
              </div>
            )}

            <p className="mx-auto mt-3 max-w-[320px] font-mono text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
              {phase === "opened" ? "Added to your balance." : grant.reason}
            </p>

            {error && <p className="mt-3 font-mono text-[11px] text-[#c0503f]">{error}</p>}

            <button
              onClick={phase === "opened" ? close : claim}
              disabled={phase === "opening"}
              className="mt-7 h-11 w-[180px] rounded-full bg-[#121a0f] text-[14px] font-medium text-white disabled:opacity-60"
            >
              {phase === "opening" ? "Opening…" : phase === "opened" ? "Done" : "Claim"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Wrapped box whose lid lifts and drifts off once opened. */
function GiftMark({ opened }: { opened: boolean }) {
  return (
    <div className="relative mx-auto h-[128px] w-[150px]">
      <div
        className="absolute bottom-0 left-1/2 h-[86px] w-[112px] -translate-x-1/2 rounded-[10px] border-[1.5px] border-[#2f6a1f]/50 bg-[#caffb8]/40"
        aria-hidden
      >
        <div className="absolute inset-y-0 left-1/2 w-[15px] -translate-x-1/2 bg-[#2f6a1f]/35" />
      </div>
      <div
        className="absolute left-1/2 h-[24px] w-[126px] rounded-[6px] border-[1.5px] border-[#2f6a1f]/60 bg-[#caffb8]/70 transition-all duration-500 ease-out"
        style={{
          bottom: opened ? "104px" : "80px",
          transform: `translateX(-50%) translateX(${opened ? "26px" : "0"}) rotate(${opened ? "16deg" : "0deg"})`,
          opacity: opened ? 0.85 : 1,
        }}
        aria-hidden
      >
        <div className="absolute inset-y-0 left-1/2 w-[15px] -translate-x-1/2 bg-[#2f6a1f]/45" />
      </div>
    </div>
  );
}
