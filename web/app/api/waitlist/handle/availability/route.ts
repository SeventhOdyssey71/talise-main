import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import {
  isWaitlistHandleAvailable,
  normalizeReasonMessage,
  normalizeWaitlistHandle,
} from "@/lib/handle-claim";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/waitlist/handle/availability
 *
 * Body: { email: string, handle: string }
 *
 * Returns:
 *   200 { available: true,  normalized: "alice" }
 *   200 { available: false, reason: "taken_db" | "taken_chain", normalized }
 *   400 { error: <message> }      – invalid handle
 *   409 { error: "You already claimed <prior>." }
 *
 * The email scopes the "you already have a handle" short-circuit. In
 * the Google-first flow the waitlist row may not exist yet — that's
 * fine, we just skip the prior-claim check and run the on-chain /
 * cross-row availability lookup. The rate-limit is the anti-enum
 * defense.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (!e || e.length >= 254) return null;
  return EMAIL_RE.test(e) ? e : null;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  // Tight throttle — the live-availability UI calls this on every
  // keystroke (debounced 350ms on the client) so a normal flow stays
  // well under 30 calls/min. A scripted enumerator would blow past it.
  const rl = rateLimit({
    key: `waitlist-avail:${ip}`,
    limit: 30,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many checks. Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } }
    );
  }

  let body: { email?: unknown; handle?: unknown };
  try {
    body = (await req.json()) as { email?: unknown; handle?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email = validEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const norm = normalizeWaitlistHandle(body.handle);
  if (!norm.ok) {
    return NextResponse.json(
      { error: normalizeReasonMessage(norm.reason), reason: norm.reason },
      { status: 400 }
    );
  }

  try {
    await ensureSchema();
    const c = db();

    const row = await c.execute({
      sql: "SELECT claimed_handle FROM waitlist_signups WHERE email = ? LIMIT 1",
      args: [email],
    });
    // Missing row is fine in the Google-first flow — the user has a
    // session but has never been written to waitlist_signups; the
    // claim route will UPSERT. Only short-circuit if the row exists
    // AND already holds a handle.
    if (row.rows.length > 0) {
      const prior = row.rows[0]?.claimed_handle as
        | string
        | null
        | undefined;
      if (prior) {
        return NextResponse.json(
          { error: `You already claimed ${prior}@talise.sui.`, prior },
          { status: 409 }
        );
      }
    }

    const verdict = await isWaitlistHandleAvailable(norm.handle);
    if (verdict.available) {
      return NextResponse.json({ available: true, normalized: norm.handle });
    }
    return NextResponse.json(
      {
        available: false,
        normalized: norm.handle,
        reason: verdict.reason,
        error: "That handle is taken.",
      },
      { status: 200 }
    );
  } catch (err) {
    console.warn(
      "[waitlist/handle/availability] failed:",
      (err as Error).message
    );
    return NextResponse.json(
      { error: "Could not check availability. Try again." },
      { status: 500 }
    );
  }
}
