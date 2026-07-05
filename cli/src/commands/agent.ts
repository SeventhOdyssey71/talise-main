/**
 * Agent-to-agent money. Designed for autonomous, non-interactive callers:
 *   talise agent whoami --json         identity block for discovery/handshake
 *   talise agent pay --to @svc --amount 0.25 --memo "job:123" --json
 *   talise agent recv --json [--since <ms>]   print inbound settlements
 *
 * An "agent" is a headless install with a provisioned session (see PLAN.md
 * §3b): `talise login` once, or inject TALISE_SESSION / a session.json. Paying
 * still signs locally with the ephemeral key — non-custodial, sub-second,
 * gasless. Money moves require --yes (or a TTY confirm) so a stray run can't
 * drain a wallet.
 */
import { makeApi } from "../http.js";
import { requireSession } from "../config.js";
import { executeSend, resolveRecipient } from "../intents.js";
import { emit, note, confirm, usd, money, dim, type OutputMode } from "../format.js";

export async function agentWhoami(baseUrl: string, mode: OutputMode): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  let handle: string | null = s.handle ?? null;
  let address = s.address ?? null;
  try {
    const me = await api.get<{ suiAddress?: string; taliseHandle?: string }>("/api/me");
    address = me.suiAddress ?? address;
    handle = me.taliseHandle ?? handle;
  } catch {
    /* offline / read failure — fall back to cached session identity */
  }
  // A stable, machine-readable identity another agent can pay to.
  emit(mode, { cli: "talise", protocol: "talise-a2a/1", address, handle, payTo: handle ? `@${handle}` : address }, () => {
    note(mode, `${handle ? "@" + handle : "(no handle)"}  ${dim(address ?? "")}`);
  });
}

export async function agentPay(
  baseUrl: string,
  mode: OutputMode,
  opts: { to?: string; amount?: string; memo?: string; asset?: string },
): Promise<void> {
  if (!opts.to) throw new Error("agent pay: --to <recipient> required");
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("agent pay: --amount must be a positive number");

  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const asset = opts.asset ?? "USDsui";
  const { address, label } = await resolveRecipient(api, opts.to);

  // Money-move guard: --yes proceeds; a non-TTY without --yes refuses.
  const proceed = await confirm(mode, `Pay ${money(usd(amount))} to ${label} ${dim(short(address))}?`);
  if (!proceed) {
    note(mode, "cancelled");
    return;
  }

  const result = await executeSend(api, s, { recipient: address, amount, asset });
  // The memo rides in the on-chain Payment Kit receipt so the payee can
  // reconcile the payment against the job it settles.
  emit(mode, { ...result, memo: opts.memo ?? null }, () => {
    note(mode, `paid ${money(usd(amount))} to ${label} — ${dim(result.suiscan)}`);
  });
}

export async function agentRecv(baseUrl: string, mode: OutputMode, sinceMs: number): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const r = await api.get<{ entries?: RecvEntry[] }>("/api/activity?limit=25");
  const inbound = (r.entries ?? [])
    .filter((e) => e.direction === "received")
    .filter((e) => (sinceMs ? (e.timestampMs ?? 0) > sinceMs : true))
    .map((e) => ({
      digest: e.digest,
      amount: e.amountUsdsui ?? 0,
      from: e.counterpartyName ?? e.counterparty ?? null,
      at: e.timestampMs ?? null,
      suiscan: `https://suiscan.xyz/mainnet/tx/${e.digest}`,
    }));
  emit(mode, { inbound }, () => {
    if (inbound.length === 0) {
      note(mode, dim("no new inbound"));
      return;
    }
    for (const i of inbound) note(mode, `${money("+" + usd(i.amount))}  ${dim("from")} ${i.from ?? "?"}  ${dim(i.suiscan)}`);
  });
}

type RecvEntry = {
  digest: string;
  direction: string;
  amountUsdsui?: number;
  counterparty?: string;
  counterpartyName?: string;
  timestampMs?: number;
};

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
