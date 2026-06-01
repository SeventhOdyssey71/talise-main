import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vault/sweep-now
 *
 * User-triggered instant sweep. Hits the existing cron endpoint with
 * the cron-secret so the server-side logic runs without waiting for
 * the next Vercel-scheduled tick (cron min is 60s, demos can't wait).
 *
 * Auth: requires a valid mobile session via `readEntryIdFromRequest`.
 * Implicit user identity (DB row) means the same per-user sweep loop
 * runs as the scheduled cron — no privilege escalation, just
 * different invocation timing.
 *
 * Use cases: iOS triggers this after a successful Send (so the
 * recipient's @handle drain happens instantly), or after the user
 * taps a "refresh" affordance. Idempotent — multiple back-to-back
 * calls are bounded by the on-chain cap throttles.
 *
 * Returns the cron's full summary verbatim so the caller can show
 * "swept N coins" feedback.
 */
export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "sweep not configured" },
      { status: 503 }
    );
  }

  // Resolve our own deployment URL — Vercel sets VERCEL_URL on every
  // serverless function. Fall back to the canonical app domain if we're
  // outside Vercel (local dev). We hit our OWN cron endpoint so we
  // reuse all the discovery + sweep + flush logic, including the v7
  // hardening (registry pause, dest allowlist, per-cap throttle).
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://app.talise.io");

  try {
    const r = await fetch(`${base}/api/cron/auto-swap-sweep`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cronSecret}` },
      // 25s — leave headroom under Vercel's 60s function ceiling so we
      // never time the function out, even on a chatty mainnet.
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: `sweep upstream ${r.status}` },
        { status: 502 }
      );
    }
    const body = (await r.json()) as Record<string, unknown>;
    return NextResponse.json(body);
  } catch (err) {
    console.warn(
      `[sweep-now] user=${user.id} sweep failed:`,
      (err as Error).message
    );
    return NextResponse.json(
      { error: "sweep failed" },
      { status: 502 }
    );
  }
}
