import { NextResponse } from "next/server";
import { sweepExpiredCheques, chequesEnabled } from "@/lib/cheques";

export const runtime = "nodejs";

/**
 * GET /api/cron/cheques-sweep
 *
 * Reclaims funded cheques past their expiry back to their creators so no escrow
 * float is ever stranded. Bearer CRON_SECRET gated (Vercel cron sends it).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  if (!chequesEnabled()) return NextResponse.json({ ok: true, swept: 0, disabled: true });
  const swept = await sweepExpiredCheques();
  return NextResponse.json({ ok: true, swept });
}
