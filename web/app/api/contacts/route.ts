import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getRecentActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/contacts — recent counterparties built from the user's
 * on-chain activity. Deduped by address, sorted by most-recent
 * interaction, capped at 30.
 *
 * Mobile uses this to populate the contacts sheet that pops over the
 * Home screen. Tapping a row deep-links into Send with the recipient
 * pre-filled.
 */
export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  try {
    const activity = await getRecentActivity(user.sui_address, 50, {
      includeNonTalise: true,
    });
    const seen = new Map<
      string,
      {
        address: string;
        name: string | null;
        lastSeenMs: number;
        sentCount: number;
        receivedCount: number;
      }
    >();
    for (const e of activity) {
      if (!e.counterparty) continue;
      const addr = e.counterparty.toLowerCase();
      const existing = seen.get(addr);
      if (existing) {
        existing.lastSeenMs = Math.max(existing.lastSeenMs, e.timestampMs);
        if (e.direction === "sent") existing.sentCount += 1;
        else existing.receivedCount += 1;
        if (!existing.name && e.counterpartyName) existing.name = e.counterpartyName;
      } else {
        seen.set(addr, {
          address: e.counterparty,
          name: e.counterpartyName,
          lastSeenMs: e.timestampMs,
          sentCount: e.direction === "sent" ? 1 : 0,
          receivedCount: e.direction === "received" ? 1 : 0,
        });
      }
    }
    const contacts = [...seen.values()]
      .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
      .slice(0, 30);
    return NextResponse.json({ contacts });
  } catch (err) {
    console.warn(`[api/contacts] failed: ${(err as Error).message}`);
    return NextResponse.json({ contacts: [] });
  }
}
