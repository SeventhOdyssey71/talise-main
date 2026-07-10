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

/** Swap sources (destination is always USDsui). Mirrors the server allowlist. */
const SWAP_TOKENS: Record<string, { type: string; decimals: number }> = {
  SUI: { type: "0x2::sui::SUI", decimals: 9 },
  USDC: {
    type: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    decimals: 6,
  },
  DEEP: {
    type: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
    decimals: 6,
  },
};

export type TxResult = {
  ok: true;
  kind: string;
  digest: string;
  suiscan: string;
  [k: string]: unknown;
};

/**
 * Sponsored execution: a prepared transaction KIND → Onara sets gasOwner/gasPrice
 * and returns sponsor-ready bytes → we sign locally → sponsor-execute broadcasts.
 * This is the rail for save / withdraw (anything needing sponsored gas).
 */
async function sponsorSignExecute(
  api: Api,
  session: Session,
  transactionKindB64: string,
  meta?: Record<string, unknown>,
): Promise<string> {
  const sponsored = await api.post<{ bytes?: string; error?: string }>("/api/zk/sponsor", {
    transactionKindB64,
  });
  if (!sponsored.bytes) throw new Error(sponsored.error || "sponsor returned no bytes");
  return signExecute(api, session, sponsored.bytes, meta);
}

/** Sign sponsor-ready bytes and broadcast via zk/sponsor-execute. Used directly
 *  by swap (whose prepare already returns sponsor-ready bytes). */
async function signExecute(
  api: Api,
  session: Session,
  bytesB64: string,
  meta?: Record<string, unknown>,
): Promise<string> {
  const signed = await signPreparedTx(session, bytesB64);
  const res = await api.post<{ digest?: string; error?: string }>("/api/zk/sponsor-execute", {
    bytesB64,
    ephemeralPubKeyB64: signed.ephemeralPubKeyB64,
    maxEpoch: signed.maxEpoch,
    randomness: signed.randomness,
    userSignature: signed.userSignature,
    ...(meta ? { meta } : {}),
  });
  if (!res.digest) throw new Error(res.error || "execute returned no digest");
  return res.digest;
}

function suiscan(digest: string): string {
  return `https://suiscan.xyz/mainnet/tx/${digest}`;
}

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

export type StepResult = SendResult | RequestResult | TxResult;

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
    throw new Error(`could not resolve recipient "${recipient}" - check the handle or use a 0x address`);
  }
  return { address, label: r.username ?? r.handle ?? raw };
}

/** Execute a plain USDsui/SUI send: prepare → local sign → gasless-submit. */
export async function executeSend(
  api: Api,
  session: Session,
  args: { recipient: string; amount: number; asset?: string; sponsorFallback?: boolean },
): Promise<SendResult> {
  const asset = args.asset ?? "USDsui";
  const { address, label } = await resolveRecipient(api, args.recipient);

  // 1. Prepare — server builds the gasless PTB and returns bytes to sign.
  const prep = await api.post<{ bytes?: string; error?: string }>("/api/send/sponsor-prepare", {
    to: address,
    amount: args.amount,
    asset,
    // Talise-sponsored money-out flows (cash-out) opt into the sponsored fallback.
    ...(args.sponsorFallback ? { sponsorFallback: true } : {}),
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

/** Swap SUI/USDC/DEEP → USDsui: prepare (sponsor-ready bytes) → sign → execute. */
export async function executeSwap(
  api: Api,
  session: Session,
  args: { from: string; amount: number },
): Promise<TxResult> {
  const token = SWAP_TOKENS[args.from.toUpperCase()];
  if (!token) throw new Error(`can't swap "${args.from}" - supported: SUI, USDC, DEEP`);
  const micros = BigInt(Math.round(args.amount * 10 ** token.decimals)).toString();
  const prep = await api.post<{ bytes?: string; error?: string }>("/api/swap/prepare", {
    fromCoinType: token.type,
    fromAmountMicros: micros,
  });
  if (!prep.bytes) throw new Error(prep.error || "swap prepare returned no bytes");
  const digest = await signExecute(api, session, prep.bytes, { kind: "swap" });
  return { ok: true, kind: "swap", digest, suiscan: suiscan(digest), from: args.from.toUpperCase(), to: "USDsui", amount: args.amount };
}

/** Save (supply) USDsui into a yield venue: prepare (kind) → sponsor → sign → execute. */
export async function executeSave(
  api: Api,
  session: Session,
  args: { amount: number; venue?: string },
): Promise<TxResult> {
  const venue = (args.venue ?? "best").toLowerCase();
  const prep = await api.post<{ transactionKindB64?: string; error?: string }>(
    "/api/earn/supply/prepare",
    { venue, amount: args.amount },
  );
  if (!prep.transactionKindB64) throw new Error(prep.error || "supply prepare returned no bytes");
  const digest = await sponsorSignExecute(api, session, prep.transactionKindB64, {
    kind: "invest",
    amountUsd: args.amount,
    venue,
  });
  return { ok: true, kind: "save", digest, suiscan: suiscan(digest), amount: args.amount, venue };
}

/** Withdraw from a yield venue: prepare (kind) → sponsor → sign → execute.
 *  `amount` omitted = withdraw the full position. */
export async function executeWithdraw(
  api: Api,
  session: Session,
  args: { amount?: number; venue?: string },
): Promise<TxResult> {
  const venue = (args.venue ?? "deepbook").toLowerCase();
  const prep = await api.post<{ transactionKindB64?: string; error?: string }>(
    "/api/earn/withdraw/prepare",
    { venue, amount: args.amount ?? null },
  );
  if (!prep.transactionKindB64) throw new Error(prep.error || "withdraw prepare returned no bytes");
  const digest = await sponsorSignExecute(api, session, prep.transactionKindB64, {
    kind: "withdraw",
    amountUsd: args.amount,
    venue,
  });
  return { ok: true, kind: "withdraw", digest, suiscan: suiscan(digest), amount: args.amount ?? null, venue };
}

/**
 * Cash out USDsui to the linked NGN bank. The server opens a Linq off-ramp order
 * and returns the wallet to fund; we send `amountUsdsui` there (Talise-sponsored).
 * If the off-ramp is closed (feature flag) the prepare returns a clear 503 which
 * surfaces as a clean error — no funds move.
 */
export async function executeCashOut(
  api: Api,
  session: Session,
  args: { amount: number },
): Promise<TxResult & { amountNgn?: number; bankLast4?: string }> {
  const order = await api.post<{
    orderId?: string;
    walletAddress?: string;
    amountUsdsui?: number;
    amountNgn?: number;
    bankLast4?: string;
    error?: string;
  }>("/api/agent/cashout/prepare", { amountUsd: args.amount });
  if (!order.walletAddress || !order.amountUsdsui) {
    throw new Error(order.error || "could not start the cash-out");
  }
  // Fund the Linq order wallet with a Talise-sponsored send.
  const send = await executeSend(api, session, {
    recipient: order.walletAddress,
    amount: order.amountUsdsui,
    asset: "USDsui",
    sponsorFallback: true,
  });
  return {
    ok: true,
    kind: "cash_out",
    digest: send.digest,
    suiscan: send.suiscan,
    amount: args.amount,
    amountNgn: order.amountNgn,
    bankLast4: order.bankLast4,
  };
}

export type BatchLeg = { to: string; amount: number; label?: string };

/**
 * Pay many recipients in ONE sponsored PTB ("pay your whole team in one
 * signature"). prepare (server resolves + screens all legs) → local sign →
 * sponsor-execute → record the digest against the batch.
 */
export async function executeBatch(
  api: Api,
  session: Session,
  args: { recipients: BatchLeg[]; teamName?: string; teamId?: string },
): Promise<TxResult & { batchId: string; recipientCount: number; totalUsd: number }> {
  if (args.recipients.length === 0) throw new Error("batch needs at least one recipient");
  const prep = await api.post<{
    batchId?: string;
    bytes?: string;
    recipientCount?: number;
    totalUsd?: number;
    error?: string;
  }>("/api/payouts/batch/prepare", {
    recipients: args.recipients,
    asset: "USDsui",
    ...(args.teamName ? { teamName: args.teamName } : {}),
    ...(args.teamId ? { teamId: args.teamId } : {}),
  });
  if (!prep.bytes || !prep.batchId) throw new Error(prep.error || "batch prepare returned no bytes");
  const digest = await signExecute(api, session, prep.bytes, {
    kind: "send",
    amountUsd: prep.totalUsd,
  });
  // Mark the batch broadcast with the confirmed digest (best-effort; the money
  // already moved, so a record failure must not surface as a failed payout).
  await api.post(`/api/payouts/batch/${prep.batchId}/record`, { digest }).catch(() => undefined);
  return {
    ok: true,
    kind: "batch",
    digest,
    suiscan: suiscan(digest),
    batchId: prep.batchId,
    recipientCount: prep.recipientCount ?? args.recipients.length,
    totalUsd: prep.totalUsd ?? 0,
  };
}

/**
 * Create a team payroll STREAM: split a total into N tranches released over
 * time. create-prepare opens the escrow → we fund it with a Talise-sponsored
 * send of the total → record links the funding digest. Gated server-side on the
 * stream escrow key (surfaces a clean "not available yet" when off).
 */
export async function executeStreamCreate(
  api: Api,
  session: Session,
  args: { teamId: string; totalUsd: number; numTranches: number; intervalMinutes: number },
): Promise<TxResult & { streamId: string; numTranches: number; totalUsd: number }> {
  const order = await api.post<{
    streamId?: string;
    escrowAddress?: string;
    totalUsd?: number;
    numTranches?: number;
    error?: string;
  }>("/api/payouts/streams/create-prepare", {
    teamId: args.teamId,
    totalUsd: args.totalUsd,
    numTranches: args.numTranches,
    intervalMinutes: args.intervalMinutes,
  });
  if (!order.streamId || !order.escrowAddress) {
    throw new Error(order.error || "could not create the stream");
  }
  // Fund the escrow with the full amount (Talise-sponsored money-out).
  const funded = await executeSend(api, session, {
    recipient: order.escrowAddress,
    amount: order.totalUsd ?? args.totalUsd,
    asset: "USDsui",
    sponsorFallback: true,
  });
  await api
    .post("/api/payouts/streams/record", { streamId: order.streamId, digest: funded.digest })
    .catch(() => undefined);
  return {
    ok: true,
    kind: "stream",
    digest: funded.digest,
    suiscan: funded.suiscan,
    streamId: order.streamId,
    numTranches: order.numTranches ?? args.numTranches,
    totalUsd: order.totalUsd ?? args.totalUsd,
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
    case "swap": {
      if (!step.from || step.amount == null) throw new Error("swap step missing from or amount");
      return executeSwap(api, session, { from: step.from, amount: step.amount });
    }
    case "save": {
      if (step.amount == null) throw new Error("save step missing amount");
      return executeSave(api, session, { amount: step.amount, venue: step.venue });
    }
    case "withdraw": {
      return executeWithdraw(api, session, { amount: step.amount, venue: step.venue });
    }
    case "cash_out": {
      if (step.amount == null) throw new Error("cash_out step missing amount");
      return executeCashOut(api, session, { amount: step.amount });
    }
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
      return `swap ${step.amount} ${step.from} to ${step.to ?? "USDsui"}`;
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
