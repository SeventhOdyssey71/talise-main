"use client";

import { useId, useMemo, useState } from "react";

type DailyPoint = { date: string; volumeUsd: number; txCount: number };

type Props = { points: DailyPoint[] };

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const usdPrecise = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Render a "YYYY-MM-DD" date as a short label (e.g. "Jun 3") in UTC.
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// SVG viewBox geometry. We draw in a fixed coordinate space and scale to 100%.
const VB_W = 800;
const VB_H = 280;
const PAD_L = 56;
const PAD_R = 16;
const PAD_T = 18;
const PAD_B = 34;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

export default function VolumeChart({ points }: Props) {
  const gradId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(
    () => (Array.isArray(points) ? points.filter((p) => p && typeof p.date === "string") : []),
    [points],
  );

  const maxVol = useMemo(() => {
    const m = data.reduce((acc, p) => Math.max(acc, p.volumeUsd || 0), 0);
    return m > 0 ? m : 1;
  }, [data]);

  const totalVol = useMemo(
    () => data.reduce((acc, p) => acc + (p.volumeUsd || 0), 0),
    [data],
  );

  // Geometry helpers.
  const n = data.length;
  // x position for the center of bucket i.
  const xCenter = (i: number) =>
    n <= 1 ? PAD_L + PLOT_W / 2 : PAD_L + (PLOT_W * i) / (n - 1);
  const yFor = (v: number) => PAD_T + PLOT_H - (PLOT_H * (v || 0)) / maxVol;

  // Area + line path for the volume series.
  const { areaPath, linePath } = useMemo(() => {
    if (n === 0) return { areaPath: "", linePath: "" };
    if (n === 1) {
      const x = xCenter(0);
      const y = yFor(data[0].volumeUsd);
      return {
        linePath: `M ${PAD_L} ${y} L ${PAD_L + PLOT_W} ${y}`,
        areaPath: `M ${PAD_L} ${PAD_T + PLOT_H} L ${PAD_L} ${y} L ${PAD_L + PLOT_W} ${y} L ${
          PAD_L + PLOT_W
        } ${PAD_T + PLOT_H} Z`,
      };
    }
    const pts = data.map((p, i) => [xCenter(i), yFor(p.volumeUsd)] as const);
    const line = pts
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(" ");
    const baseY = PAD_T + PLOT_H;
    const area =
      `M ${pts[0][0].toFixed(2)} ${baseY} ` +
      pts.map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") +
      ` L ${pts[pts.length - 1][0].toFixed(2)} ${baseY} Z`;
    return { areaPath: area, linePath: line };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, n, maxVol]);

  // y gridlines at 0%, 50%, 100% of max.
  const gridLines = [0, 0.5, 1].map((f) => ({
    f,
    y: PAD_T + PLOT_H - PLOT_H * f,
    label: usd(maxVol * f),
  }));

  // x tick labels — pick up to ~5 evenly spaced.
  const tickIdxs = useMemo(() => {
    if (n === 0) return [];
    if (n <= 6) return data.map((_, i) => i);
    const count = 5;
    const out: number[] = [];
    for (let k = 0; k < count; k++) {
      out.push(Math.round((k * (n - 1)) / (count - 1)));
    }
    return Array.from(new Set(out));
  }, [data, n]);

  const hovered = hover != null ? data[hover] : null;

  // Tooltip placement (in viewBox coords, clamped).
  const tipX = hover != null ? xCenter(hover) : 0;
  const TIP_W = 150;
  const tipBoxX = Math.min(Math.max(tipX - TIP_W / 2, PAD_L), VB_W - PAD_R - TIP_W);

  return (
    <section
      aria-label="Stablecoin volume over the last 30 days"
      className="bg-[#f7fcf2] rounded-[28px] p-6 sm:p-7"
      style={{ boxShadow: "10px 10px 0 #15300c" }}
    >
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
            Volume
          </div>
          <h2 className="mt-1 font-[var(--font-display-v2)] text-[20px] sm:text-[22px] font-[800] uppercase tracking-[-0.02em] text-[#15300c]">
            Stablecoin volume · last 30 days
          </h2>
        </div>
        <div className="text-right">
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
            Total
          </div>
          <div className="mt-1 tabular-nums text-[20px] font-[700] text-[#15300c]">
            {usdPrecise(totalVol)}
          </div>
        </div>
      </header>

      {n === 0 ? (
        <div className="flex h-[220px] flex-col items-center justify-center rounded-[20px] border border-dashed border-[#3d7a29]/30 bg-[#caffb8]/20 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
            No data yet
          </div>
          <p className="mt-2 max-w-xs px-6 text-[14px] text-[#3a5230]">
            Run a re-index to populate daily stablecoin volume.
          </p>
        </div>
      ) : (
        <div className="relative w-full">
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            width="100%"
            className="block h-auto w-full select-none"
            role="img"
            aria-label={`Daily stablecoin volume chart, ${n} day${n === 1 ? "" : "s"}, peak ${usd(
              maxVol,
            )}`}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#CAFFB8" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#CAFFB8" stopOpacity="0.15" />
              </linearGradient>
            </defs>

            {/* gridlines + y labels */}
            {gridLines.map((g) => (
              <g key={g.f}>
                <line
                  x1={PAD_L}
                  y1={g.y}
                  x2={VB_W - PAD_R}
                  y2={g.y}
                  stroke="#15300c"
                  strokeOpacity={g.f === 0 ? 0.18 : 0.08}
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 10}
                  y={g.y + 4}
                  textAnchor="end"
                  className="fill-[#3a5230] font-mono"
                  fontSize={11}
                >
                  {g.label}
                </text>
              </g>
            ))}

            {/* area fill */}
            <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
            {/* line */}
            <path
              d={linePath}
              fill="none"
              stroke="#3d7a29"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* hover guide + dot */}
            {hover != null && (
              <g pointerEvents="none">
                <line
                  x1={tipX}
                  y1={PAD_T}
                  x2={tipX}
                  y2={PAD_T + PLOT_H}
                  stroke="#15300c"
                  strokeOpacity={0.25}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <circle
                  cx={tipX}
                  cy={yFor(data[hover].volumeUsd)}
                  r={4.5}
                  fill="#f7fcf2"
                  stroke="#3d7a29"
                  strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}

            {/* x tick labels */}
            {tickIdxs.map((i) => (
              <text
                key={i}
                x={xCenter(i)}
                y={VB_H - 12}
                textAnchor="middle"
                className="fill-[#3a5230] font-mono"
                fontSize={11}
              >
                {shortDate(data[i].date)}
              </text>
            ))}

            {/* invisible hover hit-zones (one column per bucket) */}
            {data.map((p, i) => {
              const w = n <= 1 ? PLOT_W : PLOT_W / (n - 1);
              const x = xCenter(i) - w / 2;
              return (
                <rect
                  key={p.date + i}
                  x={Math.max(PAD_L, x)}
                  y={PAD_T}
                  width={Math.min(w, VB_W - PAD_R - Math.max(PAD_L, x))}
                  height={PLOT_H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseMove={() => setHover(i)}
                />
              );
            })}

            {/* tooltip */}
            {hovered && (
              <g pointerEvents="none" transform={`translate(${tipBoxX}, ${PAD_T + 4})`}>
                <rect
                  width={TIP_W}
                  height={62}
                  rx={12}
                  fill="#15300c"
                  fillOpacity={0.96}
                />
                <text x={12} y={20} fontSize={11} className="fill-[#CAFFB8] font-mono" letterSpacing="1.5">
                  {shortDate(hovered.date).toUpperCase()}
                </text>
                <text x={12} y={40} fontSize={15} fontWeight={700} className="fill-[#f7fcf2]">
                  {usdPrecise(hovered.volumeUsd)}
                </text>
                <text x={12} y={55} fontSize={11} className="fill-[#caffb8]/80">
                  {hovered.txCount} tx{hovered.txCount === 1 ? "" : "s"}
                </text>
              </g>
            )}
          </svg>
        </div>
      )}
    </section>
  );
}
