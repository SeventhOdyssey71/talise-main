"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoneyBag02Icon,
  ArrowDataTransferHorizontalIcon,
  UserMultipleIcon,
  Activity01Icon,
} from "@hugeicons/core-free-icons";

type Props = {
  totals: {
    users: number;
    activeUsers: number;
    transactions: number;
    stablecoinVolumeUsd: number;
    swaps: number;
  };
  indexedAt: number | null;
};

const usd = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

const compact = (n: number): string => {
  const v = Number.isFinite(n) ? n : 0;
  if (Math.abs(v) < 10_000) return new Intl.NumberFormat("en-US").format(v);
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
};

function relativeTime(ms: number | null): string {
  if (ms == null) return "Never";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
      {children}
    </span>
  );
}

function Figure({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-[800] tracking-[-0.02em] tabular-nums text-[#15300c]"
      style={{ fontFamily: "var(--font-display-v2)" }}
    >
      {children}
    </span>
  );
}

export default function KpiCards({ totals, indexedAt }: Props) {
  const baseCard =
    "relative flex flex-col justify-between rounded-[28px] p-6 sm:p-7 min-h-[152px]";
  const cardShadow = { boxShadow: "10px 10px 0 #15300c" } as const;

  return (
    <section>
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        {/* Hero — Total stablecoin volume (spans 2 cols) */}
        <div
          className={`${baseCard} col-span-2 overflow-hidden bg-[#f7fcf2]`}
          style={cardShadow}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 30% 30%, #FFE59E 0%, #FF9E7A 75%, transparent 100%)",
              opacity: 0.55,
            }}
          />
          <div className="relative flex items-start justify-between">
            <Eyebrow>Total stablecoin volume</Eyebrow>
            <span
              className="grid h-10 w-10 place-items-center rounded-full text-[#15300c]"
              style={{ background: "#FFE59E" }}
            >
              <HugeiconsIcon icon={MoneyBag02Icon} size={20} strokeWidth={1.8} />
            </span>
          </div>
          <div className="relative mt-4">
            <Figure>
              <span className="text-[40px] leading-none sm:text-[52px]">
                {usd(totals.stablecoinVolumeUsd)}
              </span>
            </Figure>
            <p className="mt-2 text-[13px] text-[#3a5230]">
              USDsui moved across all talise users (in + out)
            </p>
          </div>
        </div>

        {/* Total swaps */}
        <div className={`${baseCard} bg-[#f7fcf2]`} style={cardShadow}>
          <div className="flex items-start justify-between">
            <Eyebrow>Total swaps</Eyebrow>
            <span
              className="grid h-10 w-10 place-items-center rounded-full text-[#15300c]"
              style={{ background: "#C9B8FF" }}
            >
              <HugeiconsIcon
                icon={ArrowDataTransferHorizontalIcon}
                size={20}
                strokeWidth={1.8}
              />
            </span>
          </div>
          <div className="mt-4">
            <Figure>
              <span className="text-[34px] leading-none sm:text-[40px]">
                {compact(totals.swaps)}
              </span>
            </Figure>
            <p className="mt-2 text-[13px] text-[#3a5230]">swap transactions</p>
          </div>
        </div>

        {/* Total users */}
        <div className={`${baseCard} bg-[#f7fcf2]`} style={cardShadow}>
          <div className="flex items-start justify-between">
            <Eyebrow>Total users</Eyebrow>
            <span
              className="grid h-10 w-10 place-items-center rounded-full text-[#15300c]"
              style={{ background: "#CAFFB8" }}
            >
              <HugeiconsIcon icon={UserMultipleIcon} size={20} strokeWidth={1.8} />
            </span>
          </div>
          <div className="mt-4">
            <Figure>
              <span className="text-[34px] leading-none sm:text-[40px]">
                {compact(totals.users)}
              </span>
            </Figure>
            <p className="mt-2 text-[13px] text-[#3a5230]">
              <span className="font-semibold text-[#3d7a29] tabular-nums">
                {compact(totals.activeUsers)}
              </span>{" "}
              active
            </p>
          </div>
        </div>

        {/* Total transactions */}
        <div
          className={`${baseCard} col-span-2 bg-[#f7fcf2] lg:col-span-2`}
          style={cardShadow}
        >
          <div className="flex items-start justify-between">
            <Eyebrow>Total transactions</Eyebrow>
            <span
              className="grid h-10 w-10 place-items-center rounded-full text-[#15300c]"
              style={{ background: "#FF9E7A" }}
            >
              <HugeiconsIcon icon={Activity01Icon} size={20} strokeWidth={1.8} />
            </span>
          </div>
          <div className="mt-4">
            <Figure>
              <span className="text-[34px] leading-none sm:text-[40px]">
                {compact(totals.transactions)}
              </span>
            </Figure>
            <p className="mt-2 text-[13px] text-[#3a5230]">
              indexed on-chain transactions
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
        Last indexed: {relativeTime(indexedAt)}
      </p>
    </section>
  );
}
