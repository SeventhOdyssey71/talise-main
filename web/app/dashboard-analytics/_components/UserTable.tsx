"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import type { UserStat } from "@/lib/analytics/types";

type SortKey = "txCount" | "volumeUsd" | "swapCount" | "lastActiveAt";
type SortDir = "asc" | "desc";

const usd = (n: number): string =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const shortAddr = (a: string): string =>
  a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

function relativeTime(ms: number | null): string {
  if (ms == null) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}

const NUM_COLS: { key: SortKey; label: string }[] = [
  { key: "txCount", label: "Transactions" },
  { key: "volumeUsd", label: "Volume" },
  { key: "swapCount", label: "Swaps" },
  { key: "lastActiveAt", label: "Last active" },
];

export default function UserTable({ users }: { users: UserStat[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("volumeUsd");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? users.filter(
          (u) =>
            u.handle.toLowerCase().includes(q) ||
            u.address.toLowerCase().includes(q),
        )
      : users.slice();

    const dir = sortDir === "asc" ? 1 : -1;
    base.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // nulls (lastActiveAt) always sort to the bottom regardless of dir
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av === bv) return 0;
      return av < bv ? -1 * dir : 1 * dir;
    });
    return base;
  }, [users, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <section
      className="bg-[#f7fcf2] rounded-[28px] p-6 sm:p-7"
      style={{ boxShadow: "10px 10px 0 #15300c" }}
    >
      {/* header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
            Indexed accounts
          </div>
          <h2 className="mt-1 font-[var(--font-display-v2)] text-[28px] font-[800] uppercase tracking-[-0.02em] text-[#15300c]">
            Users{" "}
            <span className="tabular-nums text-[#3d7a29]">
              {filtered.length}
            </span>
          </h2>
        </div>

        {/* search */}
        <div className="relative w-full sm:w-72">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#3d7a29]">
            <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={1.8} />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search handle or address"
            className="h-11 w-full rounded-full border border-[#15300c]/12 bg-white/70 pl-11 pr-4 text-[14px] text-[#15300c] outline-none placeholder:text-[#3a5230]/50 focus:border-[#3d7a29] focus:ring-2 focus:ring-[#CAFFB8]"
          />
        </div>
      </div>

      {/* table */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#15300c]/10">
              <th className="py-3 pr-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[#3d7a29]">
                User
              </th>
              {NUM_COLS.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className="py-3 pl-4 text-right font-mono text-[11px] uppercase tracking-[0.22em] text-[#3d7a29]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex items-center gap-1 transition-colors hover:text-[#15300c] ${
                        active ? "text-[#15300c]" : ""
                      }`}
                    >
                      {col.label}
                      <span
                        className={`transition-opacity ${
                          active ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        <HugeiconsIcon
                          icon={
                            sortDir === "asc" ? ArrowUp01Icon : ArrowDown01Icon
                          }
                          size={14}
                          strokeWidth={2}
                        />
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
                    No users
                  </div>
                  <div className="mt-2 text-[14px] text-[#3a5230]/70">
                    {query
                      ? "No accounts match your search."
                      : "Run a re-index to populate this table."}
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((u, i) => (
                <tr
                  key={u.userId}
                  className={`border-b border-[#15300c]/[0.08] transition-colors hover:bg-[#CAFFB8]/15 ${
                    i % 2 === 1 ? "bg-[#15300c]/[0.015]" : ""
                  }`}
                >
                  {/* user */}
                  <td className="py-3.5 pr-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#CAFFB8] font-[var(--font-display-v2)] text-[15px] font-[800] uppercase text-[#15300c]">
                        {(u.handle?.[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold text-[#3d7a29]">
                          @{u.handle}
                        </div>
                        <div className="truncate font-mono text-[11px] text-[#3a5230]/55">
                          {shortAddr(u.address)}
                        </div>
                      </div>
                    </div>
                  </td>
                  {/* transactions */}
                  <td className="py-3.5 pl-4 text-right text-[14px] tabular-nums text-[#15300c]">
                    {u.txCount.toLocaleString("en-US")}
                  </td>
                  {/* volume */}
                  <td className="py-3.5 pl-4 text-right text-[14px] font-semibold tabular-nums text-[#15300c]">
                    {usd(u.volumeUsd)}
                  </td>
                  {/* swaps */}
                  <td className="py-3.5 pl-4 text-right text-[14px] tabular-nums text-[#15300c]">
                    {u.swapCount.toLocaleString("en-US")}
                  </td>
                  {/* last active */}
                  <td className="py-3.5 pl-4 text-right text-[14px] tabular-nums text-[#3a5230]">
                    {relativeTime(u.lastActiveAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
