"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { InboxIcon } from "@hugeicons/core-free-icons";
import { useActivity, Eyebrow, EmptyState } from "@/components/app";
import { HistoryRow } from "./HistoryRow";
import { ReceiptSheet } from "./ReceiptSheet";
import {
  type ActivityRow,
  type FilterKey,
  FILTERS,
  asRow,
  matchesFilter,
} from "./types";

/**
 * Full transaction history. Header + five filter chips (All / Sent / Received
 * / Earn / Swap), then the live feed from `useActivity(50)` rendered as
 * directional glass rows. Tapping a row opens the on-chain receipt sheet.
 *
 * `useActivity` already auto-refreshes on the `talise:tx` window event and
 * serves the immutable snapshot floor first, so this screen never flashes
 * empty after a send and history never shrinks.
 */
export function ActivityScreen() {
  const { entries, loading, error, refresh } = useActivity(50);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const [open, setOpen] = useState(false);

  const rows = useMemo<ActivityRow[]>(
    () => entries.map(asRow),
    [entries]
  );
  const filtered = useMemo(
    () => rows.filter((r) => matchesFilter(r, filter)),
    [rows, filter]
  );

  const openReceipt = (row: ActivityRow) => {
    setSelected(row);
    setOpen(true);
  };

  const showSkeleton = loading && rows.length === 0;
  const activeLabel = FILTERS.find((f) => f.key === filter)?.label ?? "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="space-y-1.5">
        <Eyebrow>Activity</Eyebrow>
        <h1
          className="text-[26px] font-medium text-fg lg:text-[30px]"
          style={{ letterSpacing: "-0.03em" }}
        >
          All activity
        </h1>
      </header>

      {/* Filter chips */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={
                active
                  ? "shrink-0 rounded-full bg-accent-soft px-4 py-2 text-[13px] font-medium text-accent transition-colors"
                  : "shrink-0 rounded-full bg-surface-2 px-4 py-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg"
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* List */}
      {showSkeleton ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : error && entries.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-4">
          <span className="text-[14px] text-fg-muted">Couldn&apos;t load your activity.</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium text-fg transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="pt-6">
          <EmptyState
            icon={<HugeiconsIcon icon={InboxIcon} size={26} strokeWidth={1.8} />}
            title={
              filter === "all"
                ? "No activity yet"
                : `No ${activeLabel.toLowerCase()} activity`
            }
            subtitle={
              filter === "all"
                ? "Your sends, receipts, earnings and swaps will appear here."
                : "Nothing here yet — try a different filter."
            }
          />
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((row) => (
            <li key={rowKey(row)}>
              <HistoryRow row={row} onOpen={() => openReceipt(row)} />
            </li>
          ))}
        </ul>
      )}

      <ReceiptSheet row={selected} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** Stable list key — digest when present, else a synthetic composite. */
function rowKey(row: ActivityRow): string {
  if (row.digest && row.digest.length > 0) return row.digest;
  return `${row.direction}:${row.timestampMs}:${row.amountUsdsui ?? ""}:${row.amountSui ?? ""}`;
}

function SkeletonRow() {
  return (
    <div className="talise-history-row flex w-full items-center gap-3.5 px-4 py-3.5 sm:px-5">
      <span className="size-[38px] shrink-0 animate-pulse rounded-full bg-surface-2" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="h-3 w-28 animate-pulse rounded-full bg-surface-2" />
        <span className="h-2.5 w-20 animate-pulse rounded-full bg-surface-2" />
      </span>
      <span className="h-3.5 w-16 animate-pulse rounded-full bg-surface-2" />
    </div>
  );
}
