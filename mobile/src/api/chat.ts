import { API_BASE, api } from "@/api/client";
import { fmtUsd, shortAddr } from "@/api/money";
import { walletApi, type ActivityEntry } from "@/api/wallet";
import { secure } from "@/auth/secure";
import { signAndSubmit, signAndSubmitSend } from "@/auth/zklogin";

/**
 * Copilot / Agent chat — streaming + intent execution. Mirrors the ios Chat
 * feature (ChatViewModel / AgentExecutor / AgentPlanAPI). The stream is buffered
 * whole then split on blank lines; intents ride inside a ---INTENT--- fence.
 */

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  streaming?: boolean;
  intent?: AgentIntent | null;
  ts: number;
};

export type AgentStep = {
  kind: string;
  amount?: number;
  recipient?: string;
  from?: string;
  to?: string;
  venue?: string;
  limit?: number;
  note?: string;
  localAmount?: number;
  localCurrency?: string;
};

export type AgentIntent = { steps: AgentStep[]; rationale?: string };

const READ_ONLY = new Set(["check_balance", "check_yield", "show_activity"]);
export function isReadOnly(s: AgentStep): boolean {
  return READ_ONLY.has(s.kind);
}
export function intentIsReadOnly(i: AgentIntent): boolean {
  return i.steps.length > 0 && i.steps.every(isReadOnly);
}

/** Strip ---INTENT---…---END--- fences from displayed prose (handles a partial open block mid-stream). */
export function stripIntentBlocks(raw: string): string {
  let out = raw.replace(/---INTENT---[\s\S]*?---END---/g, "");
  const open = out.indexOf("---INTENT---");
  if (open >= 0) {
    const nl = out.lastIndexOf("\n", open);
    out = out.slice(0, nl >= 0 ? nl : open);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Parse the intent DTO from a completed raw stream (needs a non-empty steps array). */
export function parseIntent(raw: string): AgentIntent | null {
  const m = raw.match(/---INTENT---\s*([\s\S]*?)\s*---END---/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]) as AgentIntent;
    if (Array.isArray(obj.steps) && obj.steps.length) return { steps: obj.steps, rationale: obj.rationale };
  } catch {
    /* not valid yet */
  }
  return null;
}

/**
 * POST /api/chat/stream — buffers the whole SSE body, splits on blank lines,
 * accumulates `text` events, stops on `done`/`[DONE]`. Returns the displayed prose
 * plus any parsed intent.
 */
export async function sendChat(messages: { role: ChatRole; content: string }[]): Promise<{ content: string; intent: AgentIntent | null; raw: string }> {
  const bearer = await secure.getBearer();
  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": "Talise-Android/1.0.0",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ messages }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Couldn't reach the agent (${res.status}). Try again.`);
  if (!body) throw new Error("I didn't get a reply. Nothing came back from the server, try again.");

  let raw = "";
  for (const frame of body.split("\n\n")) {
    const payload = frame
      .split("\n")
      .map((l) => l.replace(/^data:\s?/, "").replace(/\r$/, ""))
      .filter((l) => l.length)
      .join("\n");
    if (!payload) continue;
    if (payload === "[DONE]") break;
    try {
      const evt = JSON.parse(payload) as { type?: string; value?: string };
      if (evt.type === "text" && typeof evt.value === "string") raw += evt.value;
      else if (evt.type === "done") break;
      // tool_use events are informational — skipped, like ios.
    } catch {
      /* skip a malformed frame; the stream continues */
    }
  }
  return { content: stripIntentBlocks(raw), intent: parseIntent(raw), raw };
}

// --- plan validation (server is authoritative on amounts + recipients) ---

export type PlannedStep = {
  kind: string;
  label: string;
  status: "ok" | "read_only" | "blocked" | "needs_info" | string;
  detail?: string | null;
  resolved?: { address: string; displayName?: string | null } | null;
  amountUsd?: number | null;
};
export type PlanLimit = { window: string; limit: number; used: number; tier: number };
export type AgentPlan = { confirmable: boolean; steps: PlannedStep[]; totalSendUsd: number; limit?: PlanLimit | null; summary: string };

export function planIntent(steps: AgentStep[]): Promise<AgentPlan> {
  return api<AgentPlan>("/api/agent/plan", { method: "POST", zk: true, body: { steps } });
}

// --- execution ---

export type ActionResult = {
  line: string;
  kind: string;
  amountUsd?: number;
  recipient?: string;
  venue?: string;
  digest?: string;
  link?: string;
};

const VENUE_LABEL: Record<string, string> = { deepbook: "DeepBook", navi: "NAVI" };
function displayVenue(v?: string | null): string {
  return v ? VENUE_LABEL[v] ?? v : "your savings";
}

function formatActivity(a: ActivityEntry): string {
  const amt = fmtUsd(a.amountUsdsui ?? 0);
  const who = a.counterpartyName ?? (a.counterparty ? shortAddr(a.counterparty) : "");
  switch (a.direction) {
    case "received":
      return `Received ${amt} from ${who}`;
    case "sent":
      return `Sent ${amt} to ${who}`;
    case "invest":
      return `Saved ${amt} into ${displayVenue(a.venue)}`;
    case "withdraw":
      return `Withdrew ${amt} from ${displayVenue(a.venue)}`;
    default:
      return `${a.direction} ${amt}`;
  }
}

/** Read-only steps — fetch + format inline, no signature. */
export async function runReadOnly(steps: AgentStep[]): Promise<string[]> {
  const lines: string[] = [];
  for (const s of steps) {
    try {
      if (s.kind === "check_balance") {
        const b = await api<{ usdsui?: number; totalUsd?: number }>("/api/balances");
        lines.push(`Available: ${fmtUsd(b.usdsui ?? 0)} · Total ${fmtUsd(b.totalUsd ?? 0)}`);
      } else if (s.kind === "check_yield") {
        const y = await api<{ suppliedUsd?: number; apy?: number; earnedUsd?: number }>("/api/yield/comparison");
        lines.push(`Saved ${fmtUsd(y.suppliedUsd ?? 0)} earning up to ${(y.apy ?? 0).toFixed(2)}% APY · ${fmtUsd(y.earnedUsd ?? 0)} earned so far`);
      } else if (s.kind === "show_activity") {
        const acts = await walletApi.activity(Math.min(s.limit ?? 8, 25));
        for (const a of acts) lines.push(formatActivity(a));
      }
    } catch {
      lines.push("Couldn't load that right now.");
    }
  }
  return lines;
}

/**
 * Execute the confirmed plan. Trusts ONLY server-validated data (resolved.address,
 * amountUsd) — never the LLM's raw values. Each kind routes to its real rail.
 */
export async function executePlan(plan: AgentPlan, steps: AgentStep[]): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const p = plan.steps[i];
    if (p.status !== "ok") continue;
    const s = steps[i] ?? steps.find((x) => x.kind === p.kind);
    try {
      if (p.kind === "send") {
        const to = p.resolved?.address;
        const amount = p.amountUsd;
        if (!to || !amount || amount <= 0) continue;
        const name = p.resolved?.displayName ?? undefined;
        const { digest } = await signAndSubmitSend(to, amount);
        results.push({ line: `Sent ${fmtUsd(amount)} to ${name ?? shortAddr(to)}.`, kind: "send", amountUsd: amount, recipient: name ?? shortAddr(to), digest });
      } else if (p.kind === "save") {
        const amount = p.amountUsd;
        if (!amount) continue;
        const venue = s?.venue ?? "navi";
        const built = await api<{ transactionKindB64: string }>("/api/earn/supply/prepare", { method: "POST", zk: true, body: [venue, amount] });
        const { digest } = await signAndSubmit(built.transactionKindB64, { kind: "invest", amountUsd: amount, venue });
        results.push({ line: `Saved ${fmtUsd(amount)} into ${displayVenue(venue)}.`, kind: "save", amountUsd: amount, recipient: displayVenue(venue), venue, digest });
      } else if (p.kind === "withdraw") {
        const amount = p.amountUsd;
        if (!amount) continue;
        const venue = s?.venue ?? "navi";
        const built = await api<{ transactionKindB64: string }>("/api/earn/withdraw/prepare", { method: "POST", zk: true, body: [venue, amount] });
        const { digest } = await signAndSubmit(built.transactionKindB64, { kind: "withdraw", amountUsd: amount, venue });
        results.push({ line: `Withdrew ${fmtUsd(amount)} from ${displayVenue(venue)}.`, kind: "withdraw", amountUsd: amount, recipient: displayVenue(venue), venue, digest });
      } else if (p.kind === "claim_rewards") {
        const venue = s?.venue ?? "navi";
        const built = await api<{ transactionKindB64: string }>("/api/earn/withdraw-earned/prepare", { method: "POST", zk: true, body: [venue] });
        const { digest } = await signAndSubmit(built.transactionKindB64, { kind: "claim", venue });
        results.push({ line: `Claimed your earned yield from ${displayVenue(venue)}.`, kind: "claim_rewards", recipient: displayVenue(venue), venue, digest });
      } else if (p.kind === "cash_out") {
        const prep = await api<{ walletAddress: string; amountUsdsui: number; bankLast4?: string | null }>("/api/agent/cashout/prepare", {
          method: "POST",
          zk: true,
          body: { amountUsd: p.amountUsd },
        });
        const { digest } = await signAndSubmitSend(prep.walletAddress, prep.amountUsdsui);
        const dest = prep.bankLast4 ? `your bank ••${prep.bankLast4}` : "your bank";
        results.push({ line: `Cashed out ${fmtUsd(prep.amountUsdsui)} to ${dest}.`, kind: "cash_out", amountUsd: prep.amountUsdsui, recipient: dest, digest });
      } else if (p.kind === "request") {
        const amount = p.amountUsd;
        if (!amount) continue;
        const resp = await api<{ payUrl?: string }>("/api/requests", { method: "POST", body: { amountUsd: amount, requesterNote: s?.note } });
        results.push({ line: resp.payUrl ? `Payment link ready for ${fmtUsd(amount)}.` : `Created a payment link for ${fmtUsd(amount)}.`, kind: "request", amountUsd: amount, link: resp.payUrl });
      }
    } catch {
      throw new Error("Couldn't complete that. Please try again.");
    }
  }
  return results;
}

/** Time-of-day greeting — "Good morning/afternoon/evening, {name}". */
export function greeting(firstName?: string | null): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return firstName ? `${part}, ${firstName}` : part;
}

/** The 2×2 starter suggestions — exact from ios ChatTabView. */
export const CHAT_SUGGESTIONS: { icon: string; title: string; subtitle: string; prompt: string }[] = [
  { icon: "creditcard.fill", title: "Balance", subtitle: "See your total", prompt: "What's my balance?" },
  { icon: "clock", title: "Recent activity", subtitle: "Your latest moves", prompt: "Show my recent activity" },
  { icon: "dollarsign.circle.fill", title: "Save money", subtitle: "Into your savings", prompt: "I'd like to save some money" },
  { icon: "building.columns.fill", title: "Cash out", subtitle: "To your bank", prompt: "Cash out to my bank account" },
];
