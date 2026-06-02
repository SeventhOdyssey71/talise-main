import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { screenTransfer } from "@/lib/screening";
import { requireAppAttestStructural } from "@/lib/app-attest";
import {
  getChequeForClaim,
  evaluateGates,
  releaseCheque,
  recordClaimAttempt,
  microsToUsd,
} from "@/lib/cheques";

export const runtime = "nodejs";

/**
 * POST /api/cheques/:id/claim/release  { secret, phone? }
 *
 * The choke point. Re-validates the secret, RE-EVALUATES every gate from DB
 * state (never trusts the client), sanctions-screens the payout leg, atomically
 * claims the row (double-claim lock), then releases escrow→claimer.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const attestBlock = requireAppAttestStructural(req);
  if (attestBlock) return attestBlock;

  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { id } = await params;
  let body: { secret?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const cq = await getChequeForClaim(id, body.secret ?? "");
  if (!cq) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (cq.status !== "funded" || cq.expiresAt < Date.now()) {
    return NextResponse.json({ error: "not_claimable", status: cq.status }, { status: 409 });
  }

  const user = await userById(userId);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });
  const country = (user as { country?: string | null }).country ?? null;

  // Re-evaluate every gate from DB — the release is the only authority.
  const gateState = await evaluateGates({
    chequeId: id,
    claimerPhone: body.phone ?? null,
    claimerCountry: country,
  });
  if (!gateState.allPassed) {
    await recordClaimAttempt({
      chequeId: id,
      userId,
      passed: false,
      failedGate: gateState.firstUnmet,
      phone: body.phone ?? null,
      nationality: country,
    });
    return NextResponse.json(
      { error: "gates_unmet", needs: gateState.needs }, { status: 403 }
    );
  }

  // Sanctions screen the payout leg (claimer name + address), fail-closed.
  const screen = await screenTransfer({
    senderAddr: cq.fundDigest ? "escrow" : "escrow",
    recipientAddr: user.sui_address,
    senderName: null,
    recipientName: user.business_name ?? user.name,
  });
  if (!screen.allow) {
    await recordClaimAttempt({ chequeId: id, userId, passed: false, failedGate: "screening" });
    return NextResponse.json(
      { error: "This claim was blocked by a compliance screen.", code: "SCREENING_BLOCK" },
      { status: 403 }
    );
  }

  const result = await releaseCheque({
    chequeId: id,
    claimerUserId: userId,
    claimerAddress: user.sui_address,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "release_failed" }, { status: 409 });
  }

  await recordClaimAttempt({
    chequeId: id,
    userId,
    passed: true,
    name: user.name,
    phone: body.phone ?? null,
    nationality: country,
  });

  return NextResponse.json({
    ok: true,
    digest: result.digest,
    amountUsd: microsToUsd(cq.amountMicros),
  });
}
