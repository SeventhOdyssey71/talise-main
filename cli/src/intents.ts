/**
 * Intent executor — turns an agent Payment Intent step (or a direct CLI
 * command) into the real backend call the app uses. Today it fully implements
 * `send` and `request`; the other kinds map to prepare→sign→execute endpoints
 * and are wired as their prepare routes are confirmed (see PLAN.md §6/§10).
 */
import type { Api } from "./http.js";
import type { Session } from "./config.js";
import { signPreparedTx } from "./signer.js";
import type { IntentStep } from "./stream.js";

const ADDRESS_RE = /^0x[a-f0-9]{64}$/i;

export type SendResult = {
  ok: true;
  kind: string;
  digest: string;
  to: string;
  recipient: string;
  amount: number;
  asset: string;
  suiscan: string;
};

export type RequestResult = {
  ok: true;
  kind: "request";
  url: string;
  amount: number;
};

export type StepResult = SendResult | RequestResult | { ok: true; kind: string; note: string };

/** Resolve any recipient form (@handle, name.sui, 0x…) to a 0x address.
 *  Passed VERBATIM to the resolver — never rewritten (per the agent rules). */
export async function resolveRecipient(api: Api, recipient: string): Promise<{ address: string; label: string }> {
  const raw = recipient.trim();
  if (ADDRESS_RE.test(raw)) return { address: raw.toLowerCase(), label: raw };
  const r = await api.get<{ address?: string; suiAddress?: string; username?: string; handle?: string }>(
    `/api/recipient/resolve?q=${encodeURIComponent(raw)}`,
  );
  const address = (r.address ?? r.suiAddress ?? "").toLowerCase();
  if (!ADDRESS_RE.test(address)) {
    throw new Error(`could not resolve recipient "${recipient}" — check the handle or use a 0x address`);
  }
  return { address, label: r.username ?? r.handle ?? raw };
}

/** Execute a plain USDsui/SUI send: prepare → local sign → gasless-submit. */
export async function executeSend(
  api: Api,
  session: Session,
  args: { recipient: string; amount: number; asset?: string },
): Promise<SendResult> {
  const asset = args.asset ?? "USDsui";
  const { address, label } = await resolveRecipient(api, args.recipient);

  // 1. Prepare — server builds the gasless PTB and returns bytes to sign.
  const prep = await api.post<{ bytes?: string; error?: string }>("/api/send/sponsor-prepare", {
    to: address,
    amount: args.amount,
    asset,
  });
  if (!prep.bytes) throw new Error(prep.error || "prepare returned no transaction bytes");

  // 2. Sign locally with the ephemeral key (non-custodial).
  const signed = await signPreparedTx(session, prep.bytes);

  // 3. Submit — server assembles the zkLogin proof and broadcasts.
  const res = await api.post<{ digest?: string; error?: string }>("/api/send/gasless-submit", {
    bytesB64: prep.bytes,
    ephemeralPubKeyB64: signed.ephemeralPubKeyB64,
    maxEpoch: signed.maxEpoch,
    randomness: signed.randomness,
    userSignature: signed.userSignature,
    meta: { kind: "send", amountUsd: asset === "USDsui" ? args.amount : undefined },
  });
  if (!res.digest) throw new Error(res.error || "submit returned no digest");

  return {
    ok: true,
    kind: "send",
    digest: res.digest,
    to: address,
    recipient: label,
    amount: args.amount,
    asset,
    suiscan: `https://suiscan.xyz/mainnet/tx/${res.digest}`,
  };
}

/** Mint a shareable payment link (no signing — no money moves). */
export async function executeRequest(
  api: Api,
  args: { amount: number; note?: string },
): Promise<RequestResult> {
  const r = await api.post<{ id?: string; payUrl?: string; url?: string; error?: string }>("/api/requests", {
    amount: args.amount,
    note: args.note,
  });
  const url = r.payUrl ?? r.url ?? (r.id ? `https://www.talise.io/req/${r.id}` : "");
  if (!url) throw new Error(r.error || "could not create the payment link");
  return { ok: true, kind: "request", url, amount: args.amount };
}

/** Dispatch one agent intent step. */
export async function executeStep(api: Api, session: Session, step: IntentStep): Promise<StepResult> {
  switch (step.kind) {
    case "send": {
      if (step.amount == null || !step.recipient) throw new Error("send step missing amount or recipient");
      return executeSend(api, session, { recipient: step.recipient, amount: step.amount });
    }
    case "request": {
      if (step.amount == null) throw new Error("request step missing amount");
      return executeRequest(api, { amount: step.amount, note: step.note });
    }
    // swap / save / withdraw / cash_out: prepare→sign→execute endpoints, wired
    // in Phase 5 (see PLAN.md). Fail clearly rather than pretending success.
    case "swap":
    case "save":
    case "withdraw":
    case "cash_out":
      throw new Error(
        `"${step.kind}" isn't wired into the CLI yet — run it in the app for now (send + request are live)`,
      );
    default:
      throw new Error(`unknown intent step "${(step as IntentStep).kind}"`);
  }
}

/** Human one-liner describing a step, for the confirm prompt. */
export function describeStep(step: IntentStep): string {
  const amt = step.amount != null ? `$${step.amount.toFixed(2)}` : "";
  const local =
    step.localAmount != null && step.localCurrency
      ? ` (${step.localAmount.toLocaleString()} ${step.localCurrency})`
      : "";
  switch (step.kind) {
    case "send":
      return `send ${amt}${local} to ${step.recipient}`;
    case "request":
      return `create a payment link for ${amt}${step.note ? ` (${step.note})` : ""}`;
    case "swap":
      return `swap ${step.amount} ${step.from} to ${step.to}`;
    case "save":
      return `save ${amt}${step.venue ? ` on ${step.venue}` : ""}`;
    case "withdraw":
      return `withdraw ${amt}${step.venue ? ` from ${step.venue}` : ""}`;
    case "cash_out":
      return `cash out ${amt}${local} to your bank`;
    default:
      return JSON.stringify(step);
  }
}
