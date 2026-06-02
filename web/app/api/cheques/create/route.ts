import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import { userById } from "@/lib/db";
import { screenTransfer } from "@/lib/screening";
import { requireAppAttestStructural } from "@/lib/app-attest";
import {
  chequesEnabled,
  escrowAddress,
  createCheque,
  usdToMicros,
  claimUrl,
  type ChequeGate,
} from "@/lib/cheques";

export const runtime = "nodejs";

const MIN_USD = 0.01; // gasless minimum (0.01 USDsui)
const MAX_USD = 10_000;

/**
 * POST /api/cheques/create
 *
 * Write a cheque (draft). Returns the escrow address + a claim URL; the client
 * then funds the cheque by sending `amount` USDsui to `escrowAddress` over the
 * normal send rail and calls /api/cheques/:id/confirm-funded with the digest.
 *
 * Body: { amountUsd, payeeLabel?, memo?, signatureName?, gates?: [{kind, allowed?}] }
 */
export async function POST(req: Request) {
  const attestBlock = requireAppAttestStructural(req);
  if (attestBlock) return attestBlock;

  if (!chequesEnabled()) {
    return NextResponse.json({ error: "cheques_disabled" }, { status: 503 });
  }
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const rl = await rateLimitAsync({ key: `cheques-create:user:${userId}`, limit: 30, windowSec: 3600 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } }
    );
  }

  const user = await userById(userId);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  let body: {
    amountUsd?: number;
    payeeLabel?: string;
    memo?: string;
    signatureName?: string;
    gates?: Array<{ kind?: string; allowed?: string[] }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const amountUsd = Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < MIN_USD || amountUsd > MAX_USD) {
    return NextResponse.json(
      { error: `amount must be between ${MIN_USD} and ${MAX_USD}` },
      { status: 400 }
    );
  }

  // Parse + validate gates.
  const gates: ChequeGate[] = [];
  for (const g of body.gates ?? []) {
    if (g.kind === "name_phone") gates.push({ kind: "name_phone" });
    else if (g.kind === "nationality") {
      const allowed = (g.allowed ?? [])
        .map((c) => String(c).toUpperCase().trim())
        .filter((c) => /^[A-Z]{2}$/.test(c));
      if (allowed.length === 0) {
        return NextResponse.json(
          { error: "nationality gate needs at least one ISO-3166 alpha-2 country" },
          { status: 400 }
        );
      }
      gates.push({ kind: "nationality", allowed });
    }
  }

  // Sanctions screen the creator (fail-closed on a name hit). Recipient is the
  // Talise escrow, so only the creator side is screened here.
  const screen = await screenTransfer({
    senderAddr: user.sui_address,
    recipientAddr: escrowAddress(),
    senderName: user.business_name ?? user.name,
    recipientName: null,
  });
  if (!screen.allow) {
    return NextResponse.json(
      { error: "This cheque was blocked by a compliance screen.", code: "SCREENING_BLOCK" },
      { status: 403 }
    );
  }

  const { id, secret, expiresAt } = await createCheque({
    creatorUserId: userId,
    amountMicros: usdToMicros(amountUsd),
    payeeLabel: body.payeeLabel?.slice(0, 80) ?? null,
    memo: body.memo?.slice(0, 140) ?? null,
    signatureName: body.signatureName?.slice(0, 60) ?? user.business_name ?? user.name ?? null,
    gates,
  });

  return NextResponse.json({
    chequeId: id,
    escrowAddress: escrowAddress(),
    amountUsd,
    claimUrl: claimUrl(id, secret),
    secret, // returned once so the client can build the shareable link
    expiresAt,
    gates: gates.map((g) => g.kind),
  });
}
