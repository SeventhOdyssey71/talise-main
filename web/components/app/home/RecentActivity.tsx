"use client";

/**
 * Recent activity preview — the top 5 entries from useActivity rendered as
 * compact glass rows (direction disc, title + counterparty, relative time, and
 * a signed localized amount). "View all" routes to the full Activity page.
 *
 * useActivity already listens for the global `talise:tx` event and re-pulls
 * fresh, so a send/receive made elsewhere in the app reflects here without a
 * manual refresh. We keep prior rows visible during a refresh (no skeleton
 * flash) once we've loaded at least once — same UX as iOS.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  ArrowDownLeft01Icon,
  Invoice01Icon,
} from "@hugeicons/core-free-icons";
import {
  useActivity,
  useCurrency,
  GlassCard,
  Eyebrow,
  EmptyState,
  type ActivityEntry,
} from "@/components/app";
import { relativeTime } from "./relativeTime";

function counterpartyLabel(e: ActivityEntry): string {
  if (e.counterpartyName) return e.counterpartyName;
  if (e.venue) return e.venue === "navi" ? "NAVI · Earn" : "DeepBook · Earn";
  const a = e.counterparty;
  if (a && a.startsWith("0x") && a.length > 14) return `${a.slice(0, 8)}…${a.slice(-4)}`;
  return a || "On-chain";
}

function titleFor(e: ActivityEntry): string {
  if (e.venue) return e.direction === "sent" ? "Moved to Earn" : "Earn payout";
  return e.direction === "received" ? "Received" : "Sent";
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const { formatLocal } = useCurrency();
  const received = entry.direction === "received";
  const amt = formatLocal(entry.amountUsdsui, { fixed: true });
  const signed = `${received ? "+" : "−"}${amt}`;

  return (
    <div
      className="talise-history-row flex items-center gap-3.5 px-3.5 py-3"
      data-direction={entry.direction}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: "color-mix(in srgb, var(--row-tint, #ffffff) 14%, transparent)" }}
      >
        <HugeiconsIcon
          icon={received ? ArrowDownLeft01Icon : ArrowUpRight01Icon}
          size={17}
          strokeWidth={2}
          color="var(--row-tint, var(--color-fg))"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-fg">{titleFor(entry)}</span>
        <span className="block truncate text-[12px] text-fg-dim">{counterpartyLabel(entry)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span
          className="text-[14px] font-semibold tabular-nums"
          style={{ color: received ? "var(--row-tint, var(--color-fg))" : "var(--color-fg)" }}
        >
          {signed}
        </span>
        <span className="mt-0.5 font-mono text-[10px] text-fg-dim">
          {relativeTime(entry.timestampMs)}
        </span>
      </span>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="talise-history-row flex items-center gap-3.5 px-3.5 py-3">
      <span className="size-9 shrink-0 animate-pulse rounded-full bg-surface-2" />
      <span className="min-w-0 flex-1 space-y-2">
        <span className="block h-2.5 w-24 animate-pulse rounded-full bg-surface-2" />
        <span className="block h-2 w-16 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--color-surface-2)_70%,transparent)]" />
      </span>
      <span className="h-3 w-14 animate-pulse rounded-full bg-surface-2" />
    </div>
  );
}

export function RecentActivity() {
  const { entries, loading, error, refresh } = useActivity(6);
  const loadedOnce = useRef(false);
  // Re-render once on tick so relative timestamps ("5m") stay roughly fresh
  // while the user lingers on Home.
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (entries.length > 0) loadedOnce.current = true;
  const showSkeleton = loading && !loadedOnce.current;
  const top = entries.slice(0, 6);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <Eyebrow>Recent</Eyebrow>
        {top.length > 0 && (
          <Link
            href="/app/activity"
            className="inline-flex items-center gap-1 text-[12px] text-fg-muted transition-colors hover:text-fg"
          >
            View all
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} strokeWidth={2.2} />
          </Link>
        )}
      </div>

      {showSkeleton ? (
        <div className="space-y-2.5">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : error && top.length === 0 ? (
        <GlassCard className="flex items-center justify-between gap-3 px-4 py-4" radius={14}>
          <span className="text-[13px] text-fg-muted">Couldn&apos;t load activity.</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
          >
            Retry
          </button>
        </GlassCard>
      ) : top.length === 0 ? (
        <GlassCard className="py-2" radius={14}>
          <EmptyState
            icon={
              <HugeiconsIcon
                icon={Invoice01Icon}
                size={24}
                strokeWidth={1.8}
                color="var(--color-accent)"
              />
            }
            title="Nothing yet"
            subtitle="Your sends and receives will land here."
          />
        </GlassCard>
      ) : (
        <div className="space-y-2.5">
          {top.map((e) => (
            <ActivityRow
              key={
                e.digest && e.digest.length > 0
                  ? e.digest
                  : `${e.direction}:${e.timestampMs}:${e.amountUsdsui ?? ""}`
              }
              entry={e}
            />
          ))}
        </div>
      )}
    </section>
  );
}
