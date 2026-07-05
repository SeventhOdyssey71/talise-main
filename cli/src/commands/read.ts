/**
 * Read-only commands: whoami, balance, activity, resolve. No signing, just the
 * bearer. All support --json.
 */
import { makeApi } from "../http.js";
import { requireSession } from "../config.js";
import { emit, note, heading, dim, usd, type OutputMode } from "../format.js";
import { resolveRecipient } from "../intents.js";

export async function whoami(baseUrl: string, mode: OutputMode): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const me = await api.get<{
    email?: string;
    name?: string;
    suiAddress?: string;
    taliseHandle?: string;
    taliseSubname?: string;
  }>("/api/me");
  emit(
    mode,
    {
      userId: s.userId,
      address: me.suiAddress,
      handle: me.taliseHandle ?? null,
      subname: me.taliseSubname ?? null,
      email: me.email ?? null,
      name: me.name ?? null,
    },
    () => {
      note(mode, heading(me.taliseHandle ? `@${me.taliseHandle}` : me.name ?? "Talise account"));
      note(mode, dim("address ") + (me.suiAddress ?? "—"));
      if (me.taliseSubname) note(mode, dim("suins   ") + me.taliseSubname);
      if (me.email) note(mode, dim("email   ") + me.email);
    },
  );
}

export async function balance(baseUrl: string, mode: OutputMode): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const b = await api.get<{
    usdsui?: number;
    sui?: number;
    suiPriceUsd?: number;
    totalUsd?: number;
  }>("/api/balances?fresh=1");
  emit(
    mode,
    {
      usdsui: b.usdsui ?? 0,
      sui: b.sui ?? 0,
      totalUsd: b.totalUsd ?? 0,
    },
    () => {
      note(mode, heading(usd(b.totalUsd ?? 0)) + dim("  total"));
      note(mode, `  ${(b.usdsui ?? 0).toFixed(2)} USDsui`);
      note(mode, `  ${(b.sui ?? 0).toFixed(4)} SUI`);
    },
  );
}

export async function activity(baseUrl: string, mode: OutputMode, limit: number): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const r = await api.get<{ entries?: ActivityEntry[] }>(`/api/activity?limit=${limit}`);
  const entries = r.entries ?? [];
  emit(mode, { entries }, () => {
    if (entries.length === 0) {
      note(mode, dim("no activity yet"));
      return;
    }
    for (const e of entries) {
      const inflow = e.direction === "received" || e.direction === "withdraw";
      const sign = inflow ? "+" : "-";
      const amt = e.amountUsdsui != null ? `${sign}${usd(Math.abs(e.amountUsdsui))}` : "";
      const who = e.counterpartyName ?? (e.counterparty ? short(e.counterparty) : "");
      note(mode, `${pad(amt, 12)} ${dim(pad(e.direction, 9))} ${who}`);
    }
  });
}

export async function resolve(baseUrl: string, mode: OutputMode, query: string): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const { address, label } = await resolveRecipient(api, query);
  emit(mode, { query, address, label }, () => {
    note(mode, `${label} ${dim("→")} ${address}`);
  });
}

type ActivityEntry = {
  digest: string;
  direction: string;
  amountUsdsui?: number;
  counterparty?: string;
  counterpartyName?: string;
};

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
