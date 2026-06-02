import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import { getChequeForClaim, startPhoneOtp } from "@/lib/cheques";

export const runtime = "nodejs";

/**
 * POST /api/cheques/:id/claim/phone/send  { secret, phone, name }
 *
 * name_phone gate: capture the claimer's name + phone and dispatch an SMS OTP.
 * Rate-limited per user. `devCode` is returned only when no SMS provider is
 * configured (so the flow stays exercisable in dev).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const rl = await rateLimitAsync({ key: `cheque-otp:user:${userId}`, limit: 5, windowSec: 600 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 600) } }
    );
  }

  const { id } = await params;
  let body: { secret?: string; phone?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const phone = (body.phone ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!/^\+?[0-9][0-9\s-]{6,17}$/.test(phone) || name.length < 2) {
    return NextResponse.json({ error: "valid name + phone required" }, { status: 400 });
  }

  const cq = await getChequeForClaim(id, body.secret ?? "");
  if (!cq) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (cq.status !== "funded" || cq.expiresAt < Date.now()) {
    return NextResponse.json({ error: "not_claimable" }, { status: 409 });
  }

  const r = await startPhoneOtp({ chequeId: id, phone, name });
  return NextResponse.json({ ok: r.ok, devCode: r.devCode });
}
