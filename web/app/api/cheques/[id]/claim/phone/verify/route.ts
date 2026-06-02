import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { getChequeForClaim, verifyPhoneOtp } from "@/lib/cheques";

export const runtime = "nodejs";

/**
 * POST /api/cheques/:id/claim/phone/verify  { secret, phone, code }
 *
 * name_phone gate: constant-time OTP check. On success the gate is satisfied
 * for this cheque+phone (re-checked at /claim/release from DB state).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { id } = await params;
  let body: { secret?: string; phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.phone || !body.code) {
    return NextResponse.json({ error: "phone + code required" }, { status: 400 });
  }

  const cq = await getChequeForClaim(id, body.secret ?? "");
  if (!cq) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const r = await verifyPhoneOtp({ chequeId: id, phone: body.phone, code: body.code });
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
