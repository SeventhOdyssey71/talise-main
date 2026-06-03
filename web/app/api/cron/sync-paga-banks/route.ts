import { NextResponse } from "next/server";
import { syncPagaBanks } from "@/lib/paga-banks";

export const runtime = "nodejs";

/**
 * GET /api/cron/sync-paga-banks
 *
 * Refreshes the `paga_banks` registry from the Paga Business API `getBanks`
 * so quotes resolve the real per-bank `destinationBankUUID`. Bearer
 * CRON_SECRET gated (Vercel cron sends it). Requires live Paga credentials —
 * without them this returns ok:false rather than 500, so the cron stays green
 * and quotes keep working off the static fallback list.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const { synced } = await syncPagaBanks();
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    console.warn("[cron/sync-paga-banks] sync failed:", (e as Error).message);
    return NextResponse.json({ ok: false, reason: (e as Error).message });
  }
}
