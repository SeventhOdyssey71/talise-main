// LEGACY (2026-05-30): the new Google-first /waitlist UI never calls
// this endpoint. The flow is now Google sign-in → handle pick →
// /api/waitlist/handle/claim (which UPSERTs the waitlist row itself).
// Kept alive for backwards compatibility with any external links /
// embeds that still POST here.
import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { sendWaitlistConfirmation } from "@/lib/email";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { turnstileConfigured, verifyTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/waitlist
 *
 * Body: { email: string, source?: string }
 *
 * Persists the email to `waitlist_signups` and fires a Resend
 * confirmation. Email is the PRIMARY KEY, so duplicate detection is a
 * single-statement `INSERT ... ON CONFLICT (email) DO NOTHING RETURNING
 * email`. An empty RETURNING set means the row already existed → 409.
 *
 * The Resend call is awaited (so we can flip `confirmation_sent` in the
 * same request) but capped by a 4s timeout — we never wedge the
 * response on a Resend hiccup.
 *
 * --- Bot protection (audit F9) ---
 * This endpoint is UNAUTHENTICATED and triggers a Resend email per new
 * address, so left open it's an outbound-spam amplifier (a script feeds
 * victim addresses and Talise emails them). We gate it with Cloudflare
 * Turnstile, FAIL-CLOSED:
 *
 *   - TURNSTILE_SECRET_KEY set  → a missing or invalid `turnstileToken`
 *     (alias `cf-turnstile-response`) → 403, no row, no email.
 *   - TURNSTILE_SECRET_KEY unset → fall back to rate-limit-only and log a
 *     LOUD warning. Rationale: don't break local dev; production MUST set
 *     the secret before this endpoint is exposed (see web/.env.example).
 *
 * The 10/min/IP rate limit stays as defense-in-depth in both modes.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (!e || e.length >= 254) return null;
  // Must contain exactly one @ and at least one . — the regex covers
  // both but we keep an explicit check for clarity.
  const atCount = (e.match(/@/g) || []).length;
  if (atCount !== 1) return null;
  if (!e.includes(".")) return null;
  if (!EMAIL_RE.test(e)) return null;
  return e;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      }
    );
  });
}

export async function POST(req: Request) {
  let body: {
    email?: unknown;
    turnstileToken?: unknown;
    "cf-turnstile-response"?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email = validEmail(body.email);
  if (!email) {
    return NextResponse.json(
      { error: "Enter a valid email." },
      { status: 400 }
    );
  }

  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || null;

  // Light per-IP throttle so a script can't enumerate the address book.
  // 10 attempts per minute is well above any legit user's keystroke rate.
  // Kept FIRST so abusive callers don't get to hammer Cloudflare's
  // siteverify on our behalf.
  const rl = await rateLimitAsync({ key: `waitlist:${ip}`, limit: 10, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec ?? 60) },
      }
    );
  }

  // Bot gate (audit F9). Fail-closed when configured; rate-limit-only +
  // loud warning when not (see the route docblock).
  if (turnstileConfigured()) {
    const rawToken =
      (typeof body.turnstileToken === "string" && body.turnstileToken) ||
      (typeof body["cf-turnstile-response"] === "string" &&
        body["cf-turnstile-response"]) ||
      "";
    const verified = await verifyTurnstile(rawToken, ip);
    if (!verified) {
      return NextResponse.json(
        { error: "Verification required." },
        { status: 403 }
      );
    }
  } else {
    console.warn(
      "[waitlist] TURNSTILE_SECRET_KEY unset — endpoint is UNPROTECTED " +
        "(rate-limit only). Set it before exposing /api/waitlist publicly. " +
        "See audit F9."
    );
  }

  try {
    await ensureSchema();
    const c = db();

    // Atomic insert + dup detection in one round-trip.
    const ins = await c.execute({
      sql: `INSERT INTO waitlist_signups (email, created_at, ip, user_agent)
              VALUES (?, ?, ?, ?)
            ON CONFLICT (email) DO NOTHING
            RETURNING email`,
      args: [email, Date.now(), ip, userAgent],
    });

    if (ins.rows.length === 0) {
      // Already on the list. Treated as a soft conflict — the form
      // surfaces it as a muted "you're already on the list" note, not
      // an error.
      return NextResponse.json(
        { error: "You are already on the waitlist." },
        { status: 409 }
      );
    }

    console.log(`[waitlist] new=${email}`);

    // Fire Resend confirmation with a 4s ceiling. If Resend wedges or
    // errors we still return 200 — the row is durably saved and we can
    // backfill the email out of band.
    const sendRes = await withTimeout(
      sendWaitlistConfirmation({ to: email, name: null }),
      4000
    );
    if (sendRes && sendRes.ok) {
      try {
        await c.execute({
          sql: `UPDATE waitlist_signups
                  SET confirmation_sent = true, confirmation_sent_at = ?
                WHERE email = ?`,
          args: [Date.now(), email],
        });
      } catch (e) {
        console.warn(
          "[waitlist] mark confirmation_sent failed:",
          (e as Error).message
        );
      }
    } else if (sendRes && !sendRes.ok) {
      console.warn("[waitlist] confirmation send failed:", sendRes.reason);
    } else {
      console.warn("[waitlist] confirmation send timed out (>4s)");
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn(
      "[waitlist] insert failed:",
      (err as Error).message,
      "email_len:",
      email.length
    );
    return NextResponse.json(
      { error: "Could not save your email. Try again." },
      { status: 500 }
    );
  }
}
