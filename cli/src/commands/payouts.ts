/**
 * Payroll: batch (pay many in one signature), saved teams, and streams
 * (split a total into tranches released over time).
 */
import { readFileSync } from "node:fs";
import { makeApi } from "../http.js";
import { requireSession } from "../config.js";
import { executeBatch, executeStreamCreate, type BatchLeg } from "../intents.js";
import { emit, note, ok, confirm, money, dim, usd, type OutputMode } from "../format.js";

type Team = { id: string; name: string; members: { recipient: string; amount?: number; label?: string }[] };

/** List saved payout teams. */
export async function teams(baseUrl: string, mode: OutputMode): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const r = await api.get<{ teams?: Team[] }>("/api/payouts/teams");
  const list = r.teams ?? [];
  emit(mode, { teams: list }, () => {
    if (list.length === 0) {
      note(mode, dim("no saved teams - create one in the app, or use `batch --file`"));
      return;
    }
    for (const t of list) note(mode, `${t.id.padEnd(12)} ${t.name} ${dim(`(${t.members.length} members)`)}`);
  });
}

/**
 * Pay a batch. Recipients come from ONE of:
 *   --team <id>     a saved team (uses each member's default amount)
 *   --file <path>   JSON array [{to, amount, label?}] (or `-` for stdin)
 *   --to a=5 --to b=3   repeatable inline legs (name=amount)
 */
export async function batch(
  baseUrl: string,
  mode: OutputMode,
  opts: { team?: string; file?: string; toList: string[] },
): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);

  let recipients: BatchLeg[] = [];
  let teamName: string | undefined;
  let teamId: string | undefined;

  if (opts.team) {
    const r = await api.get<{ teams?: Team[] }>("/api/payouts/teams");
    const team = (r.teams ?? []).find((t) => t.id === opts.team);
    if (!team) throw new Error(`team "${opts.team}" not found - see \`talise teams\``);
    recipients = team.members.map((m) => {
      if (m.amount == null || m.amount <= 0) {
        throw new Error(`team member "${m.recipient}" has no default amount - use --file to set amounts`);
      }
      return { to: m.recipient, amount: m.amount, label: m.label };
    });
    teamName = team.name;
    teamId = team.id;
  } else if (opts.file) {
    const raw = opts.file === "-" ? readFileSync(0, "utf8") : readFileSync(opts.file, "utf8");
    const parsed = JSON.parse(raw) as BatchLeg[];
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("file must be a non-empty JSON array of {to, amount}");
    recipients = parsed.map((p) => ({ to: String(p.to), amount: Number(p.amount), label: p.label }));
  } else if (opts.toList.length > 0) {
    recipients = opts.toList.map((pair) => {
      const eq = pair.lastIndexOf("=");
      if (eq < 0) throw new Error(`--to expects name=amount, got "${pair}"`);
      const to = pair.slice(0, eq).trim();
      const amount = Number(pair.slice(eq + 1));
      if (!to || !Number.isFinite(amount) || amount <= 0) throw new Error(`bad --to entry: "${pair}"`);
      return { to, amount };
    });
  } else {
    throw new Error("batch needs recipients: --team <id>, --file <path>, or --to name=amount");
  }

  const total = recipients.reduce((a, r) => a + r.amount, 0);
  if (!(await confirm(mode, `Pay ${recipients.length} recipient${recipients.length > 1 ? "s" : ""}, ${money(usd(total))} total?`))) {
    note(mode, "cancelled");
    return;
  }
  const r = await executeBatch(api, s, { recipients, teamName, teamId });
  emit(mode, r, () => {
    ok(mode, `paid ${r.recipientCount} recipients, ${money(usd(r.totalUsd))} total`);
    note(mode, dim(r.suiscan));
  });
}

/** Create a payroll stream (split a total into tranches over time). */
export async function streamCreate(
  baseUrl: string,
  mode: OutputMode,
  opts: { team?: string; total?: string; tranches?: string; interval?: string },
): Promise<void> {
  if (!opts.team) throw new Error("stream create: --team <id> required");
  const totalUsd = Number(opts.total);
  const numTranches = Number(opts.tranches);
  const intervalMinutes = Number(opts.interval);
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) throw new Error("--total <usd> required");
  if (!Number.isInteger(numTranches) || numTranches < 1) throw new Error("--tranches <n> required");
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) throw new Error("--interval <minutes> required");

  const s = requireSession();
  const api = makeApi(baseUrl, s);
  if (!(await confirm(mode, `Stream ${money(usd(totalUsd))} to team ${opts.team} in ${numTranches} tranches, every ${intervalMinutes} min?`))) {
    note(mode, "cancelled");
    return;
  }
  const r = await executeStreamCreate(api, s, { teamId: opts.team, totalUsd, numTranches, intervalMinutes });
  emit(mode, r, () => {
    ok(mode, `stream ${r.streamId} funded: ${money(usd(r.totalUsd))} over ${r.numTranches} tranches`);
    note(mode, dim(r.suiscan));
  });
}

export async function streamList(baseUrl: string, mode: OutputMode): Promise<void> {
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const r = await api.get<{ streams?: Stream[] }>("/api/payouts/streams");
  const list = r.streams ?? [];
  emit(mode, { streams: list }, () => {
    if (list.length === 0) {
      note(mode, dim("no streams"));
      return;
    }
    for (const st of list) {
      note(mode, `${(st.id ?? "").padEnd(12)} ${money(usd(st.totalUsd ?? 0))} ${dim(`${st.tranchesPaid ?? 0}/${st.numTranches ?? "?"} paid · ${st.status ?? ""}`)}`);
    }
  });
}

export async function streamCancel(baseUrl: string, mode: OutputMode, id: string): Promise<void> {
  if (!id) throw new Error("usage: talise stream cancel <id>");
  const s = requireSession();
  const api = makeApi(baseUrl, s);
  const r = await api.post<{ ok?: boolean; error?: string }>(`/api/payouts/streams/${id}/cancel`);
  emit(mode, { ok: true, id, ...r }, () => ok(mode, `stream ${id} cancelled`));
}

type Stream = {
  id?: string;
  totalUsd?: number;
  numTranches?: number;
  tranchesPaid?: number;
  status?: string;
};
