"use client";

/**
 * The Invest hub: live venue cards (NAVI default; DeepBook only when the user
 * has a position there) + a supply card with an amount input, a live Day /
 * Week / Month / Year earnings projection, and a forest "Earn $X" button.
 *
 * The user's typed amount is in their DISPLAY currency; we convert to USD
 * (USDsui is 1:1 USD) at the wire boundary by dividing by the FX rate. The
 * first supply is gated behind the one-time opt-in disclosure.
 *
 * Money movement flows through `useEarnAction` (prepare → sponsor → execute).
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Plant02Icon,
  ArrowRight02Icon,
} from "@hugeicons/core-free-icons";
import {
  GlassCard,
  Eyebrow,
  MicroLabel,
  PrimaryButton,
  useCurrency,
  useToast,
  ApiError,
} from "@/components/app";
import {
  useYieldComparison,
  type YieldVenue,
  venueLabel,
  formatApy,
  hasAcceptedEarnDisclosure,
  markEarnDisclosureAccepted,
} from "./earn-data";
import { useEarnAction } from "./useEarnAction";

// framer-motion only loads on the save-success celebration — keep it out of the
// Earn page's initial bundle.
const PiggySave = dynamic(
  () => import("@/components/app/anim/PiggySave").then((m) => ({ default: m.PiggySave })),
  { ssr: false }
);
import { EarnDisclosureSheet } from "./EarnDisclosureSheet";
import { WithdrawSheet } from "./WithdrawSheet";

/** Colloquial plural for the user's display currency — drives the headline. */
function moneyWordFor(code: string): string {
  switch (code) {
    case "USD":
    case "CAD":
    case "SGD":
      return "dollars";
    case "NGN":
      return "naira";
    case "GHS":
      return "cedis";
    case "KES":
      return "shillings";
    case "ZAR":
      return "rand";
    case "EUR":
      return "euros";
    case "GBP":
      return "pounds";
    case "JPY":
      return "yen";
    case "PHP":
      return "pesos";
    default:
      return "money";
  }
}

export function SupplyCard() {
  const { data, loading, refresh } = useYieldComparison();
  const { supply, working } = useEarnAction();
  const { symbol, rate, formatUsd, currency } = useCurrency();
  const { toast } = useToast();

  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successDigest, setSuccessDigest] = useState<string | null>(null);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<YieldVenue | null>(null);

  const best = data?.best ?? null;
  const moneyWord = moneyWordFor(currency);

  // Local-currency input → USD (USDsui is 1:1 USD). Divide by the rate.
  const amountUsd = useMemo(() => {
    const local = Number(amount);
    if (!Number.isFinite(local) || local <= 0) return 0;
    return local / (rate || 1);
  }, [amount, rate]);

  const projection = useMemo(() => {
    if (amountUsd <= 0 || !best || best.apy <= 0) return null;
    const annual = amountUsd * best.apy;
    return {
      day: annual / 365,
      week: annual / 52,
      month: annual / 12,
      year: annual,
    };
  }, [amountUsd, best]);

  const canSupply = amountUsd > 0 && !!best && !working;

  // Venues to show: NAVI always; DeepBook only when there's a position.
  const visibleVenues = (data?.venues ?? []).filter((v) =>
    v.venue === "deepbook" ? v.supplied > 0 : true
  );

  async function runSupply() {
    if (!best || amountUsd <= 0) return;
    setError(null);
    try {
      const { digest } = await supply(best.venue, amountUsd);
      setSuccessDigest(digest);
      const localPretty = formatUsd(amountUsd, { fixed: true });
      toast(`Now earning on ${localPretty}`, "success");
      setAmount("");
      void refresh();
      // Drop back to the input after a brief celebration.
      window.setTimeout(() => setSuccessDigest((d) => (d === digest ? null : d)), 4000);
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOT_SIGNED_IN") return;
      setError(e instanceof ApiError ? e.message : "Couldn't start earning. Try again.");
    }
  }

  function onSupplyTapped() {
    if (!canSupply) return;
    if (hasAcceptedEarnDisclosure()) {
      void runSupply();
    } else {
      setShowDisclosure(true);
    }
  }

  return (
    <div className="space-y-4">
      {/* Headline */}
      <div className="space-y-1">
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em] text-fg sm:text-[30px]">
          {best
            ? `Earn up to ${(best.apy * 100).toFixed(2)}% on your ${moneyWord}`
            : `Earn on your ${moneyWord}`}
        </h1>
        <p className="text-[13px] text-fg-muted">
          A separate lending service, not part of your balance.
        </p>
      </div>

      {/* Venue cards */}
      <div className="space-y-2.5">
        {loading && !data ? (
          <>
            <VenueSkeleton />
            <VenueSkeleton />
          </>
        ) : visibleVenues.length > 0 ? (
          visibleVenues.map((v) => (
            <VenueRow
              key={v.venue}
              venue={v}
              best={best?.venue === v.venue}
              onWithdraw={v.supplied > 0 ? () => setWithdrawTarget(v) : undefined}
              formatUsd={formatUsd}
            />
          ))
        ) : (
          <GlassCard className="px-5 py-6 text-center" radius={20}>
            <p className="text-[13px] text-fg-muted">No live venues right now.</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-1 font-mono text-[11px] uppercase tracking-wider text-accent"
            >
              Refresh
            </button>
          </GlassCard>
        )}
      </div>

      {/* Supply card / success state */}
      {successDigest ? (
        <GlassCard className="px-5 py-8 text-center" radius={24} tint="#caffb8">
          {/* Piggy drops in + a coin falls into the slot with a little gulp —
              the web port of the iOS savings-success piggy. Plays once. */}
          <div className="mx-auto mb-1 grid place-items-center">
            <PiggySave size={132} />
          </div>
          <p className="text-[18px] font-medium tracking-[-0.02em] text-fg">Now earning</p>
          <p className="mt-1 font-mono text-[11px] text-fg-dim">
            {successDigest.slice(0, 18)}…
          </p>
          <button
            type="button"
            onClick={() => setSuccessDigest(null)}
            className="mt-4 font-mono text-[11px] uppercase tracking-wider text-accent"
          >
            Earn more
          </button>
        </GlassCard>
      ) : (
        <GlassCard className="space-y-4 p-5" radius={24}>
          <div className="space-y-2">
            <Eyebrow>Amount</Eyebrow>
            <div
              className="talise-glass flex items-center gap-2 px-4 py-3.5"
              style={{ borderRadius: 16 }}
            >
              <span className="text-[28px] font-medium text-fg-muted">{symbol}</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  if ((v.match(/\./g) ?? []).length <= 1) setAmount(v);
                  setError(null);
                }}
                placeholder="0.00"
                className="w-full bg-transparent text-[28px] font-medium tracking-[-0.02em] tabular-nums text-fg outline-none placeholder:text-fg-dim"
              />
              <span className="text-[14px] font-medium text-fg-muted">{currency}</span>
            </div>
          </div>

          {projection && (
            <div className="space-y-2">
              <MicroLabel>You&apos;ll earn</MicroLabel>
              <div className="talise-glass overflow-hidden" style={{ borderRadius: 16 }}>
                <ProjectionRow label="Day" value={formatUsd(projection.day)} />
                <Divider />
                <ProjectionRow label="Week" value={formatUsd(projection.week)} />
                <Divider />
                <ProjectionRow label="Month" value={formatUsd(projection.month)} />
                <Divider />
                <ProjectionRow label="Year" value={formatUsd(projection.year)} accent />
              </div>
            </div>
          )}

          {error && <p className="text-[13px] text-danger">{error}</p>}

          <PrimaryButton full disabled={!canSupply} loading={working} onClick={onSupplyTapped}>
            {amountUsd > 0
              ? `Earn ${formatUsd(amountUsd, { fixed: true })}`
              : "Start earning"}
          </PrimaryButton>
        </GlassCard>
      )}

      <EarnDisclosureSheet
        open={showDisclosure}
        apy={best?.apy ?? 0}
        moneyWord={moneyWord}
        onAccept={() => {
          markEarnDisclosureAccepted();
          setShowDisclosure(false);
          void runSupply();
        }}
        onClose={() => setShowDisclosure(false)}
      />

      <WithdrawSheet
        venue={withdrawTarget}
        bestApy={best?.apy ?? 0}
        onClose={() => setWithdrawTarget(null)}
        onWithdrawn={() => {
          setWithdrawTarget(null);
          void refresh();
        }}
      />
    </div>
  );
}

function VenueRow({
  venue,
  best,
  onWithdraw,
  formatUsd,
}: {
  venue: YieldVenue;
  best: boolean;
  onWithdraw?: () => void;
  formatUsd: (usd: number, o?: { fixed?: boolean }) => string;
}) {
  const hasPosition = venue.supplied > 0;
  const body = (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
        style={{ background: "var(--color-accent-soft)" }}
      >
        <HugeiconsIcon icon={Plant02Icon} size={19} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-medium text-fg">{venueLabel(venue.venue)}</span>
          {best && (
            <span className="rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent"
              style={{ background: "var(--color-accent-soft)" }}>
              Best
            </span>
          )}
        </div>
        <span className="block truncate font-mono text-[11px] text-fg-dim">
          {hasPosition ? `Supplied ${formatUsd(venue.supplied, { fixed: true })}` : "Idle"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-[22px] font-medium tracking-[-0.02em] tabular-nums ${
            venue.apy >= 0.0001 ? "text-fg" : "text-fg-dim"
          }`}
        >
          {formatApy(venue.apy)}
        </span>
        {hasPosition && (
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            size={16}
            className="text-fg-dim"
            strokeWidth={2}
          />
        )}
      </div>
    </div>
  );

  if (onWithdraw) {
    return (
      <GlassCard as="button" onClick={onWithdraw} interactive radius={20} className="!p-0">
        {body}
      </GlassCard>
    );
  }
  return (
    <GlassCard radius={20} className="!p-0">
      {body}
    </GlassCard>
  );
}

function VenueSkeleton() {
  return (
    <div className="talise-glass flex items-center justify-between px-4 py-4 opacity-70" style={{ borderRadius: 20 }}>
      <div className="space-y-2">
        <div className="h-2.5 w-16 rounded-full bg-surface-2" />
        <div className="h-2 w-24 rounded-full bg-surface-2" />
      </div>
      <div className="h-4 w-14 rounded-full bg-surface-2" />
    </div>
  );
}

function ProjectionRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-[13px] text-fg-muted">{label}</span>
      <span
        className={`text-[15px] font-medium tracking-[-0.01em] tabular-nums ${
          accent ? "text-accent" : "text-fg"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="mx-3 h-px bg-line" />;
}
