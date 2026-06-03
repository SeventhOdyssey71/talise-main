import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paga Business REST API client — typed wrapper around the few endpoints
 * Talise uses to power NGN bank-payout offramps.
 *
 * Spec: docs/offramp/paga-integration.md. The three credentials Paga hands
 * out (principal / credentials / hashKey) are read from env. Every request
 * carries:
 *   • `principal`   — merchant id (Basic-auth style identifier)
 *   • `credentials` — secret key
 *   • `hash`        — HMAC-SHA512 over an endpoint-specific ordered
 *                     concatenation of body fields, hex-encoded.
 *
 * The hashed-fields order is endpoint-specific and is enforced by the
 * `bodyForHash` argument the caller assembles. We don't try to be clever
 * here — caller passes the canonical string they want hashed; we just
 * sign + serialize.
 */

const SANDBOX_BASE_URL = "https://beta.mypaga.com";

export interface PagaConfig {
  baseUrl: string;
  clientId: string;
  password: string;
  hmacKey: string;
}

/**
 * Read Paga env. Throws a precise error message naming any missing var so
 * an offramp call doesn't silently fail with a vague 500.
 */
export function pagaConfig(): PagaConfig {
  const clientId = process.env.PAGA_CLIENT_ID;
  const password = process.env.PAGA_PASSWORD;
  const hmacKey = process.env.PAGA_HMAC_KEY;
  const missing: string[] = [];
  if (!clientId) missing.push("PAGA_CLIENT_ID");
  if (!password) missing.push("PAGA_PASSWORD");
  if (!hmacKey) missing.push("PAGA_HMAC_KEY");
  if (missing.length > 0) {
    throw new Error(`Paga client misconfigured: missing ${missing.join(", ")}`);
  }
  return {
    baseUrl: process.env.PAGA_BASE_URL?.trim() || SANDBOX_BASE_URL,
    clientId: clientId!,
    password: password!,
    hmacKey: hmacKey!,
  };
}

/**
 * Build the Paga header set for a single request. The hash is HMAC-SHA512
 * (hex) over `bodyForHash` keyed by `PAGA_HMAC_KEY` — caller assembles the
 * exact field ordering documented per endpoint (e.g. for `depositToBank`
 * the concatenation is `referenceNumber + amount + destinationBankUUID +
 * destinationBankAccountNumber`).
 */
export function pagaHeaders(bodyForHash: string): Record<string, string> {
  const cfg = pagaConfig();
  const hash = createHmac("sha512", cfg.hmacKey).update(bodyForHash).digest("hex");
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    principal: cfg.clientId,
    credentials: cfg.password,
    hash,
  };
}

function endpointUrl(path: string): string {
  const { baseUrl } = pagaConfig();
  const cleanBase = baseUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}/paga-webservices/business-rest/secured${cleanPath}`;
}

interface PagaRawResponse {
  responseCode?: number;
  message?: string;
  destinationAccountHolderNameAtBank?: string;
  transactionId?: string;
  referenceNumber?: string;
  sessionId?: string;
  fee?: number;
  vat?: number;
  // transactionStatus shape
  transactionStatus?: string;
  // catch-all for other fields we don't use
  [k: string]: unknown;
}

async function pagaPost(
  path: string,
  body: Record<string, unknown>,
  bodyForHash: string
): Promise<PagaRawResponse> {
  const url = endpointUrl(path);
  const headers = pagaHeaders(bodyForHash);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`Paga ${path} network error: ${(e as Error).message}`);
  }
  const text = await resp.text();
  let json: PagaRawResponse;
  try {
    json = text ? (JSON.parse(text) as PagaRawResponse) : {};
  } catch {
    throw new Error(`Paga ${path} returned non-JSON (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  if (!resp.ok) {
    const msg = json.message ?? `HTTP ${resp.status}`;
    throw new Error(`Paga ${path} failed: ${msg}`);
  }
  return json;
}

// ─── Operations ───────────────────────────────────────────────────────

export interface NameEnquiryInput {
  bankCode: string;
  accountNumber: string;
}

export interface NameEnquiryResult {
  accountName: string;
}

/**
 * Resolve the account holder name for a bank/account pair. We map to Paga's
 * `validateDepositToBank` endpoint — it doubles as a name-enquiry + fee
 * preview. Hash order: `referenceNumber | amount | destinationBankUUID |
 * destinationBankAccountNumber` (same as depositToBank); we pass a fixed
 * reference + 0 amount because the call is read-only for our purposes.
 */
export async function nameEnquiry(
  input: NameEnquiryInput
): Promise<NameEnquiryResult> {
  const reference = `name-enq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const amount = "0";
  const bodyForHash = `${reference}${amount}${input.bankCode}${input.accountNumber}`;
  const json = await pagaPost(
    "/validateDepositToBank",
    {
      referenceNumber: reference,
      amount,
      destinationBankUUID: input.bankCode,
      destinationBankAccountNumber: input.accountNumber,
      currency: "NGN",
    },
    bodyForHash
  );
  if (json.responseCode !== 0 || !json.destinationAccountHolderNameAtBank) {
    throw new Error(json.message ?? "Could not resolve bank account holder name");
  }
  return { accountName: json.destinationAccountHolderNameAtBank };
}

export interface MoneyTransferInput {
  amount: number;
  destinationBankUUID: string;
  destinationBankAccountNumber: string;
  recipientName: string;
  reference: string;
  remarks?: string;
}

export interface MoneyTransferResult {
  pagaReference: string;
  status: "ok" | "pending";
}

/**
 * Initiate a NGN payout to a bank account via Paga's `depositToBank`. The
 * `reference` is OUR uuid — we feed it to Paga as `referenceNumber` so
 * retries are idempotent (calling `depositToBank` twice with the same
 * `referenceNumber` returns the original transaction).
 *
 * Hash order is `referenceNumber + amount + destinationBankUUID +
 * destinationBankAccountNumber` per the public docs.
 */
export async function moneyTransfer(
  input: MoneyTransferInput
): Promise<MoneyTransferResult> {
  const amountStr = input.amount.toFixed(2);
  const bodyForHash =
    `${input.reference}${amountStr}${input.destinationBankUUID}${input.destinationBankAccountNumber}`;
  const json = await pagaPost(
    "/depositToBank",
    {
      referenceNumber: input.reference,
      amount: amountStr,
      currency: "NGN",
      destinationBankUUID: input.destinationBankUUID,
      destinationBankAccountNumber: input.destinationBankAccountNumber,
      recipientName: input.recipientName,
      remarks: input.remarks ?? "Talise withdraw",
    },
    bodyForHash
  );
  // Paga uses responseCode === 0 for the ack (the actual NGN settlement is
  // confirmed via webhook / status poll). Anything else is a hard reject.
  if (json.responseCode !== 0) {
    throw new Error(json.message ?? "Paga rejected money transfer");
  }
  const pagaReference =
    typeof json.transactionId === "string" && json.transactionId.length > 0
      ? json.transactionId
      : typeof json.referenceNumber === "string"
      ? json.referenceNumber
      : input.reference;
  return { pagaReference, status: "pending" };
}

export interface TransactionStatusResult {
  status: "settled" | "pending" | "failed";
  message: string;
}

/**
 * Poll the status of a previously-submitted payout. Paga's
 * `transactionStatus` returns one of SUCCESSFUL | PENDING | FAILED for the
 * underlying NIBSS settlement. Hash order: `referenceNumber` only.
 */
export async function transactionStatus(
  reference: string
): Promise<TransactionStatusResult> {
  const bodyForHash = `${reference}`;
  const json = await pagaPost(
    "/transactionStatus",
    { referenceNumber: reference },
    bodyForHash
  );
  const raw = (json.transactionStatus ?? "").toString().toUpperCase();
  let status: TransactionStatusResult["status"] = "pending";
  if (raw === "SUCCESSFUL" || raw === "SUCCESS" || raw === "COMPLETED") {
    status = "settled";
  } else if (raw === "FAILED" || raw === "REJECTED") {
    status = "failed";
  } else {
    status = "pending";
  }
  return { status, message: json.message ?? "" };
}

// ─── Settlement webhook (statusCallbackUrl receiver) ──────────────────────

/**
 * Verify an inbound Paga settlement webhook. Paga does not publish a callback
 * signature scheme, so we follow their best-practices guidance: recompute
 * HMAC-SHA512 over the RAW request body keyed by `PAGA_HMAC_KEY` and compare
 * constant-time against the inbound hash header. Returns false on any
 * mismatch / missing header (the receiver then logs + refuses to act).
 */
export function verifyPagaWebhookSignature(
  rawBody: string,
  providedHash: string | null | undefined
): boolean {
  if (!providedHash) return false;
  const { hmacKey } = pagaConfig();
  const expected = createHmac("sha512", hmacKey).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(providedHash.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export type PagaWebhookStatus = "settled" | "failed" | "pending" | "unknown";

export interface PagaWebhookEvent {
  reference: string | null;
  status: PagaWebhookStatus;
}

/**
 * Normalize a parsed Paga callback body to (our reference, settlement status).
 * The exact field names aren't published, so we accept the documented and the
 * common variants and map the terminal NIBSS states.
 */
export function parsePagaWebhook(json: Record<string, unknown>): PagaWebhookEvent {
  const refRaw = json.referenceNumber ?? json.reference ?? json.merchantReference;
  const reference = typeof refRaw === "string" && refRaw.length > 0 ? refRaw : null;
  const rawStatus = String(
    json.transactionStatus ?? json.status ?? json.statusCode ?? ""
  ).toUpperCase();
  let status: PagaWebhookStatus = "unknown";
  if (["SUCCESSFUL", "SUCCESS", "COMPLETED", "CREDITED"].includes(rawStatus)) {
    status = "settled";
  } else if (["FAILED", "REJECTED", "REVERSED", "DECLINED"].includes(rawStatus)) {
    status = "failed";
  } else if (["PENDING", "PROCESSING", "IN_PROGRESS"].includes(rawStatus)) {
    status = "pending";
  }
  return { reference, status };
}
