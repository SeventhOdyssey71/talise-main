"use client";

/**
 * Month-to-date money insights: Spent / Received / Saved tiles + a short list
 * of top counterparties. Reads GET /api/rewards/insights.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Analytics02Icon } from "@hugeicons/core-free-icons";
import { GlassCard, Eyebrow, useCurrency } from "@/components/app";
import { useInsights } from "./earn-data";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long" });

export function InsightsSection() {
  const { data, loading } = useInsights();
  const { formatUsd } = useCurrency();

  const monthLabel = data?.monthStartMs ? MONTH.format(new Date(data.monthStartMs)) : "This month";

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Eyebrow>Insights</Eyebrow>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-dim">
          · {monthLabel}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Spent" value={formatUsd(data?.spentUsd ?? 0, { fixed: true })} loading={loading && !data} />
        <Tile label="Received" value={formatUsd(data?.receivedUsd ?? 0, { fixed: true })} loading={loading && !data} />
        <Tile
          label="Saved"
          value={formatUsd(data?.savedUsd ?? 0, { fixed: true })}
          accent
          loading={loading && !data}
        />
      </div>

      {data && data.topCounterparties.length > 0 && (
        <GlassCard radius={20} className="overflow-hidden !p-0">
          {data.topCounterparties.slice(0, 4).map((c, i) => (
            <div key={c.address}>
              {i > 0 && <div className="mx-4 h-px bg-line" />}
              <div className="flex items-center gap-3.5 px-4 py-3">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full font-medium text-accent"
                  style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
                >
                  {initials(c.name, c.address)}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-fg">
                    {c.name ?? shortAddr(c.address)}
                  </span>
                  <span className="block font-mono text-[11px] text-fg-dim">
                    {c.count} {c.count === 1 ? "payment" : "payments"}
                  </span>
                </div>
                <span className="text-[14px] font-medium tabular-nums text-fg">
                  {formatUsd(c.totalUsd, { fixed: true })}
                </span>
              </div>
            </div>
          ))}
        </GlassCard>
      )}

      {data && data.topCounterparties.length === 0 && !loading && (
        <GlassCard radius={20} className="flex items-center gap-3 px-4 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-fg-dim">
            <HugeiconsIcon icon={Analytics02Icon} size={18} strokeWidth={1.6} />
          </span>
          <p className="text-[13px] text-fg-muted">
            Your spending breakdown shows up here once you start sending.
          </p>
        </GlassCard>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  accent,
  loading,
}: {
  label: string;
  value: string;
  accent?: boolean;
  loading?: boolean;
}) {
  return (
    <GlassCard radius={18} className="px-3 py-3.5">
      <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
        {label}
      </span>
      {loading ? (
        <span className="mt-2 block h-5 w-12 rounded-full bg-white/10" />
      ) : (
        <span
          className={`mt-1 block truncate text-[18px] font-medium tracking-[-0.02em] tabular-nums ${
            accent ? "text-accent" : "text-fg"
          }`}
        >
          {value}
        </span>
      )}
    </GlassCard>
  );
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function initials(name: string | null, address: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || name[0].toUpperCase();
  }
  return address.slice(2, 4).toUpperCase();
}
