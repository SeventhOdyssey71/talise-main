import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { sendWaitlistConfirmation } from "@/lib/email";
import {
  isWaitlistHandleAvailable,
  normalizeReasonMessage,
  normalizeWaitlistHandle,
} from "@/lib/handle-claim";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/waitlist/handle/claim
 *
 * Body: { email: string, handle: string }
 *
 * Reserves `<handle>` for this waitlist row (Strategy A — reserve in
 * DB; the on-chain mint runs at sign-in via
 * `bindWaitlistHandleIfAny`). The atomic SQL UPDATE with
 * `WHERE claimed_handle IS NULL` plus the partial-unique index on
 * `claimed_handle` together guarantee that two concurrent claim
 * requests for the same handle cannot both succeed.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (!e || e.length >= 254) return null;
  return EMAIL_RE.test(e) ? e : null;
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
  const ip = getClientIp(req);
  // Claim writes — tighter than availability. 6/min is well above any
  // human retry cadence.
  const rl = rateLimit({
    key: `waitlist-claim:${ip}`,
    limit: 6,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
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

    // Existence + already-claimed gate.
    const row = await c.execute({
      sql: "SELECT claimed_handle FROM waitlist_signups WHERE email = ? LIMIT 1",
      args: [email],
    });
    if (row.rows.length === 0) {
      return NextResponse.json(
        { error: "Join the waitlist first." },
        { status: 404 }
      );
    }
    const prior = row.rows[0]?.claimed_handle as string | null | undefined;
    if (prior) {
      return NextResponse.json(
        { error: `You already claimed @${prior}.`, prior },
        { status: 409 }
      );
    }

    // Composite availability — DB + on-chain. Re-checked atomically
    // inside the UPDATE below, but failing fast here gives the user a
    // precise error instead of a generic "race lost" 409.
    const verdict = await isWaitlistHandleAvailable(norm.handle);
    if (!verdict.available) {
      return NextResponse.json(
        {
          error:
            verdict.reason === "taken_chain"
              ? "That handle is already minted on chain."
              : "That handle is taken.",
          reason: verdict.reason,
        },
        { status: 409 }
      );
    }

    // The actual reservation. Two guards make this safe:
    //  1. `claimed_handle IS NULL` in the WHERE — same email can't
    //     double-claim if two requests race.
    //  2. The partial-unique index on `claimed_handle` — two different
    //     emails racing for the same handle: one UPDATE wins, the
    //     other raises a unique-violation we catch as 409.
    let claimed = false;
    try {
      const upd = await c.execute({
        sql: `UPDATE waitlist_signups
                 SET claimed_handle = ?, handle_claimed_at = ?
               WHERE email = ? AND claimed_handle IS NULL
               RETURNING claimed_handle`,
        args: [norm.handle, Date.now(), email],
      });
      claimed = upd.rows.length > 0;
    } catch (e) {
      const msg = String((e as Error).message).toLowerCase();
      if (msg.includes("unique") || msg.includes("duplicate key")) {
        return NextResponse.json(
          { error: "Someone just claimed that handle. Pick another." },
          { status: 409 }
        );
      }
      throw e;
    }

    if (!claimed) {
      // Either the row vanished (unlikely) or `claimed_handle` flipped
      // non-NULL between our SELECT and UPDATE — i.e. a same-email
      // double-claim race.
      return NextResponse.json(
        { error: "You already claimed a handle." },
        { status: 409 }
      );
    }

    // Confirmation email — fire-and-forget with a 4s ceiling, same
    // pattern as the original waitlist route.
    withTimeout(
      sendWaitlistConfirmation({
        to: email,
        name: null,
        claimedHandle: norm.handle,
      }).catch(() => null),
      4000
    ).catch(() => null);

    console.log(`[waitlist/handle/claim] email=${email} handle=${norm.handle}`);
    return NextResponse.json({
      ok: true,
      handle: norm.handle,
      strategy: "reserve" as const,
    });
  } catch (err) {
    console.warn(
      "[waitlist/handle/claim] failed:",
      (err as Error).message,
      "email_len:",
      email.length
    );
    return NextResponse.json(
      { error: "Could not claim that handle. Try again." },
      { status: 500 }
    );
  }
}
