import { SectionShell, Eyebrow } from "./primitives";

/**
 * Stat strip — three numeric tiles that sit just below the hero and act
 * as proof-points. Preserves the original copy verbatim, restyled as
 * light-gray cards with hairline borders (Xend-style).
 */
export function StatsStrip() {
  const stats: Array<[string, string, string]> = [
    ["avg send fee", "0%", "vs ~5% Wise"],
    ["finality", "<1s", "sub-second on Sui"],
    ["fee at $100", "$0.00", "no markup"],
  ];

  return (
    <SectionShell className="pt-6 pb-20 md:pt-10 md:pb-28">
      <div className="text-center">
        <Eyebrow>a dollar account without the bank</Eyebrow>
      </div>
      <div className="mx-auto mt-10 grid max-w-[960px] grid-cols-1 gap-4 md:grid-cols-3">
        {stats.map(([label, value, sub]) => (
          <div
            key={label}
            className="rounded-[18px] border border-[var(--landing-border)] bg-[var(--landing-surface)] px-6 py-6 text-left"
          >
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--landing-fg-muted)]">
              {label}
            </div>
            <div
              className="mt-2 text-[36px] font-semibold leading-none tracking-tight text-[var(--landing-fg)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {value}
            </div>
            <div className="mt-2 text-[13px] text-[var(--landing-fg-dim)]">
              {sub}
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
