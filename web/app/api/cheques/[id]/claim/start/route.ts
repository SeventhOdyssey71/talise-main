import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getChequeForClaim, evaluateGates, microsToUsd } from "@/lib/cheques";

export const runtime = "nodejs";

/**
 * POST /api/cheques/:id/claim/start  { secret }
 *
 * Authed claimer entry point. Validates the secret + cheque state and returns
 * the outstanding gates the claimer must satisfy before /claim/release.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { id } = await params;
  let body: { secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const cq = await getChequeForClaim(id, body.secret ?? "");
  if (!cq) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const expired = cq.expiresAt < Date.now();
  if (cq.status !== "funded" || expired) {
    return NextResponse.json({
      claimable: false,
      status: expired && cq.status === "funded" ? "expired" : cq.status,
    });
  }

  const user = await userById(userId);
  const country = (user as { country?: string | null } | null)?.country ?? null;
  const gateState = await evaluateGates({ chequeId: id, claimerCountry: country });

  return NextResponse.json({
    claimable: true,
    amountUsd: microsToUsd(cq.amountMicros),
    needs: gateState.needs,
    allPassed: gateState.allPassed,
  });
}
