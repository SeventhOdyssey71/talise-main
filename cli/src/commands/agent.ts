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
import { provisionAgent } from "../auth.js";
import { emit, note, ok, confirm, usd, money, dim, heading, shortAddr, type OutputMode } from "../format.js";

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
  opts: { to?: string; amount?: string; memo?: string; asset?: string; token?: string },
): Promise<void> {
  if (!opts.to) throw new Error("agent pay: --to <recipient> required");
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("agent pay: --amount must be a positive number");

  // Custodial path: a provisioned agent token (env or --token) → the server
  // signs. No local key needed. Falls back to the local-key session otherwise.
  const agentToken = opts.token ?? process.env.TALISE_AGENT_TOKEN;
  if (agentToken) {
    const proceed = await confirm(mode, `Pay ${money(usd(amount))} to ${opts.to} (custodial agent wallet)?`);
    if (!proceed) {
      note(mode, "cancelled");
      return;
    }
    const api = makeApi(baseUrl, agentToken);
    const r = await api.post<{ digest?: string; recipient?: string; suiscan?: string; capRemaining?: number }>(
      "/api/agent/pay",
      { to: opts.to, amount, memo: opts.memo },
    );
    emit(mode, { ok: true, ...r, memo: opts.memo ?? null }, () => {
      note(mode, `paid ${money(usd(amount))} to ${r.recipient ?? opts.to} ${dim(r.suiscan ?? "")}`);
    });
    return;
  }

  // Local-key path: sign with the provisioned session's ephemeral key.
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const asset = opts.asset ?? "USDsui";
  const { address, label } = await resolveRecipient(api, opts.to);
  const proceed = await confirm(mode, `Pay ${money(usd(amount))} to ${label} ${dim(shortAddr(address))}?`);
  if (!proceed) {
    note(mode, "cancelled");
    return;
  }
  const result = await executeSend(api, s, { recipient: address, amount, asset });
  // The memo rides in the on-chain Payment Kit receipt so the payee can
  // reconcile the payment against the job it settles.
  emit(mode, { ...result, memo: opts.memo ?? null }, () => {
    note(mode, `paid ${money(usd(amount))} to ${label} ${dim(result.suiscan)}`);
  });
}

/** Provision a custodial agent wallet (server-held key, daily cap, revocable). */
export async function agentProvision(
  baseUrl: string,
  mode: OutputMode,
  opts: { name?: string; cap?: string },
): Promise<void> {
  const cap = Number(opts.cap);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("agent provision: --cap <usd/day> required");
  requireSession(); // must be signed in to authorize
  const { agentToken, agentId, address } = await provisionAgent(baseUrl, mode, { name: opts.name, cap });
  emit(mode, { ok: true, agentId, address, dailyCapUsd: cap, token: agentToken }, () => {
    ok(mode, `agent wallet ${agentId} provisioned (cap ${money(usd(cap))}/day)`);
    note(mode, heading("token (shown once, store it securely):"));
    note(mode, "  " + agentToken);
    note(mode, dim("use it via: export TALISE_AGENT_TOKEN=… ; talise agent pay --to @x --amount 1 --yes"));
  });
}

/** List the caller's custodial agent wallets. */
export async function agentWallets(baseUrl: string, mode: OutputMode): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const r = await api.get<{ wallets?: AgentWallet[] }>("/api/agent/wallet/list");
  const list = r.wallets ?? [];
  emit(mode, { wallets: list }, () => {
    if (list.length === 0) {
      note(mode, dim("no agent wallets - provision one with `talise agent provision --cap 5`"));
      return;
    }
    for (const w of list) {
      const state = w.revoked ? dim("revoked") : `${money(usd(w.spentTodayUsd))}/${usd(w.dailyCapUsd)} today`;
      note(mode, `${w.id.padEnd(20)} ${(w.name ?? "").padEnd(14)} ${state}`);
    }
  });
}

/** Revoke an agent wallet immediately. */
export async function agentRevoke(baseUrl: string, mode: OutputMode, id: string): Promise<void> {
  if (!id) throw new Error("usage: talise agent revoke <id>");
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const r = await api.post<{ ok?: boolean }>("/api/agent/wallet/revoke", { id });
  emit(mode, { ok: true, id, ...r }, () => ok(mode, `agent wallet ${id} revoked`));
}

type AgentWallet = {
  id: string;
  name: string | null;
  suiAddress: string;
  dailyCapUsd: number;
  spentTodayUsd: number;
  revoked: boolean;
};

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
