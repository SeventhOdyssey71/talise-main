import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { sendWaitlistConfirmation } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/waitlist
 *
 * Body: {
 *   email: string,
 *   name?: string,
 *   country?: string,
 *   reason?: string,
 *   source?: string
 * }
 *
 * Stores a marketing-waitlist signup while Talise is in private beta and
 * fires a Resend confirmation email. Idempotent on email: a repost is a
 * no-op for the DB row, and the email is only sent if we have not sent
 * one before (tracked via `confirmation_sent_at`).
 *
 * Returns 200 on success (whether new or duplicate). 400 on a malformed
 * email so the form can surface inline validation. Email-send failures
 * do not block the 200 response; they are logged and retried lazily.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COUNTRY_WHITELIST = new Set([
  "Nigeria",
  "Kenya",
  "Ghana",
  "South Africa",
  "UK",
  "US",
  "Other",
]);

const REASON_WHITELIST = new Set([
  "Send money home",
  "Receive money",
  "Hold dollars",
  "Just curious",
]);

function cleanField(
  v: unknown,
  maxLen: number,
  allowed?: Set<string>
): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  if (allowed && !allowed.has(trimmed)) return null;
  return trimmed;
}

export async function POST(req: Request) {
  let body: {
    email?: unknown;
    source?: unknown;
    name?: unknown;
    country?: unknown;
    reason?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  const source =
    typeof body.source === "string" && body.source.length < 50
      ? body.source.trim()
      : "landing";

  const name = cleanField(body.name, 50);
  const country = cleanField(body.country, 50, COUNTRY_WHITELIST);
  const reason = cleanField(body.reason, 50, REASON_WHITELIST);

  try {
    await ensureSchema();
    const c = db();

    // Upsert: keep the first-seen row but patch in the new optional
    // fields if the user re-submits with more info filled in.
    await c.execute({
      sql: `INSERT INTO waitlist (email, created_at, source, name, country, reason)
              VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (email) DO UPDATE SET
              name = COALESCE(EXCLUDED.name, waitlist.name),
              country = COALESCE(EXCLUDED.country, waitlist.country),
              reason = COALESCE(EXCLUDED.reason, waitlist.reason)`,
      args: [email, Date.now(), source, name, country, reason],
    });

    // Idempotency check: only send a confirmation mail if we have not
    // already done so for this email.
    const existing = await c.execute({
      sql: `SELECT name, confirmation_sent_at FROM waitlist
              WHERE email = ? LIMIT 1`,
      args: [email],
    });
    const row = existing.rows[0] as
      | { name?: string | null; confirmation_sent_at?: number | null }
      | undefined;
    const alreadySent =
      row && row.confirmation_sent_at != null && row.confirmation_sent_at > 0;

    if (!alreadySent) {
      // Fire-and-forget. We deliberately do not await the send in the
      // response path; Resend rate limits or outages should not delay
      // the user's UI flip to "you are on the list".
      void (async () => {
        try {
          const res = await sendWaitlistConfirmation({
            to: email,
            name: row?.name ?? name,
          });
          if (res.ok) {
            await db().execute({
              sql: `UPDATE waitlist
                      SET confirmation_sent_at = ?, confirmation_message_id = ?
                    WHERE email = ?`,
              args: [Date.now(), res.id, email],
            });
          } else {
            console.warn(
              "[waitlist] confirmation send failed:",
              res.reason,
              "email:",
              email
            );
          }
        } catch (err) {
          console.warn(
            "[waitlist] confirmation send threw:",
            (err as Error).message,
            "email:",
            email
          );
        }
      })();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn(
      "[waitlist] insert failed:",
      (err as Error).message,
      "email_len:",
      email.length
    );
    return NextResponse.json({ error: "could not save email" }, { status: 500 });
  }
}
