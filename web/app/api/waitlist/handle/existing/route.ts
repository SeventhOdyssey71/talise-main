import { NextResponse } from "next/server";
import { getExistingUserHandle } from "@/lib/handle-claim";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/waitlist/handle/existing
 *
 * Body: { email: string }
 *
 * Returns:
 *   200 { existing: { handle: "alice" } }   — user already has a bound handle
 *   200 { existing: null }                   — no existing handle for this email
 *   400 { error: "Enter a valid email." }
 *
 * Called by the waitlist form right after the email submission succeeds.
 * If an existing handle is found, the form swaps the claim UI for a
 * "welcome back" card rather than prompting the user to choose a new
 * handle (which would later collide with the one they already own).
 *
 * IP-rate-limited so the endpoint can't be turned into an email-to-handle
 * enumeration oracle. Only returns the handle when it's already public
 * on chain (the user is openly using it as their .talise.sui name), so
 * this endpoint reveals nothing the SuiNS resolver doesn't already.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit({
    key: `waitlist-handle-existing:${ip}`,
    limit: 30,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec ?? 60) },
      }
    );
  }

  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const raw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!raw || raw.length >= 254 || !EMAIL_RE.test(raw)) {
    return NextResponse.json(
      { error: "Enter a valid email." },
      { status: 400 }
    );
  }

  const existing = await getExistingUserHandle(raw);
  return NextResponse.json({ existing });
}
