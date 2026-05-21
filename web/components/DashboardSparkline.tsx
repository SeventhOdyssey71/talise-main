"use client";

import { motion } from "framer-motion";
import type { ActivityEntry } from "@/lib/activity";

/**
 * 14-day activity sparkline — bars for sent + received per day.
 *
 * Hand-rolled SVG so we don't bundle a charting lib just for one chart.
 * Each day has two stacked-ish bars: sent (warm) on top, received (green)
 * below. Days with no activity show a faint ground line.
 */
export function DashboardSparkline({
  activity,
  days = 14,
}: {
  activity: ActivityEntry[];
  days?: number;
}) {
  // Build a per-day bucket of sent vs received USD volume.
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets: Array<{ sent: number; received: number; label: string }> =
    Array.from({ length: days }, (_, i) => {
      const start = now - (days - 1 - i) * dayMs;
      const d = new Date(start);
      return {
        sent: 0,
        received: 0,
        label: d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      };
    });

  for (const e of activity) {
    if (!e.timestampMs) continue;
    const diff = now - e.timestampMs;
    const idx = days - 1 - Math.floor(diff / dayMs);
    if (idx < 0 || idx >= days) continue;
    const amt = e.amountUsdsui ?? 0;
    if (e.direction === "sent") buckets[idx].sent += Math.abs(amt);
    else buckets[idx].received += Math.abs(amt);
  }

  const max = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.sent, b.received))
  );

  const w = 100; // viewBox width %
  const h = 100; // viewBox height %
  const gap = 0.6;
  const colW = (w - gap * (days - 1)) / days;
  const half = 48; // each direction gets ~48% of the height

  const sentSum = buckets.reduce((s, b) => s + b.sent, 0);
  const recvSum = buckets.reduce((s, b) => s + b.received, 0);

  return (
    <div className="relative">
      <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        <div>Activity · last {days} days</div>
        <div className="flex gap-4 text-[10px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#c08a3e]" />
            sent ${sentSum.toFixed(0)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#21A179]" />
            received ${recvSum.toFixed(0)}
          </span>
        </div>
      </div>

      <motion.svg
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-32 w-full md:h-40"
        aria-label="Activity chart"
      >
        {/* Centerline divider — visually separates sent (top) from received (bottom). */}
        <line
          x1="0"
          x2={w}
          y1={half + 2}
          y2={half + 2}
          stroke="currentColor"
          strokeWidth="0.25"
          className="text-[var(--color-line)]"
        />

        {buckets.map((b, i) => {
          const x = i * (colW + gap);
          const sentH = (b.sent / max) * half;
          const recvH = (b.received / max) * half;
          return (
            <g key={i}>
              {/* Sent — grows upward from centerline. */}
              {sentH > 0 ? (
                <rect
                  x={x}
                  y={half - sentH + 2}
                  width={colW}
                  height={sentH}
                  rx={0.6}
                  fill="#c08a3e"
                  opacity={0.85}
                />
              ) : null}
              {/* Received — grows downward from centerline. */}
              {recvH > 0 ? (
                <rect
                  x={x}
                  y={half + 2}
                  width={colW}
                  height={recvH}
                  rx={0.6}
                  fill="#21A179"
                  opacity={0.85}
                />
              ) : null}
              {/* Ground tick — keeps the chart from feeling empty on quiet days. */}
              {sentH === 0 && recvH === 0 ? (
                <rect
                  x={x + colW / 2 - 0.2}
                  y={half + 1}
                  width={0.4}
                  height={2}
                  fill="currentColor"
                  className="text-[var(--color-line)]"
                />
              ) : null}
            </g>
          );
        })}
      </motion.svg>

      {/* Day labels — just first / mid / last to avoid clutter. */}
      <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
        <span>{buckets[0]?.label}</span>
        <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
    </div>
  );
}
