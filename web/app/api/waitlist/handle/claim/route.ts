import { NextResponse, after } from "next/server";
import { db, ensureSchema, userById } from "@/lib/db";
import { sendWaitlistConfirmation } from "@/lib/email";
import {
  isWaitlistHandleAvailable,
  normalizeReasonMessage,
  normalizeWaitlistHandle,
} from "@/lib/handle-claim";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { readSessionEntryId } from "@/lib/session";
import { mintSubname, suinsOperatorEnabled } from "@/lib/suins-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/waitlist/handle/claim
 *
 * Body: { handle: string }
 *
 * Auth-required: the caller MUST be signed in via the web session
 * cookie (the user clicked "Sign in with Google" on /waitlist BEFORE
 * picking a handle — the email used by the row is derived from the
 * authenticated session, not from the request body). On claim we:
 *   1. Resolve the user from the session cookie. No session → 401.
 *   2. Confirm `<handle>.talise.sui` is free (DB + on-chain).
 *   3. UPSERT the waitlist row (the user may never have hit the legacy
 *      /api/waitlist endpoint — Google-first flow skips it). The UPSERT
 *      reserves the handle atomically; racers lose at the partial-
 *      unique-index level.
 *   4. Mint on chain via the Onara-sponsored operator PTB.
 *   5. Persist the NFT object id + bind the row to the user. Also
 *      write `users.talise_username` so the reverse-lookup paths
 *      pick it up immediately.
 *
 * If the mint fails after step 3, we ROLL BACK the reservation so
 * the user can retry with the same handle (and the partial-unique
 * index doesn't permanently lock it out for everyone). The rollback
 * is a plain UPDATE — by that point the row is guaranteed to exist.
 */

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

  let body: { handle?: unknown };
  try {
    body = (await req.json()) as { handle?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const norm = normalizeWaitlistHandle(body.handle);
  if (!norm.ok) {
    return NextResponse.json(
      { error: normalizeReasonMessage(norm.reason), reason: norm.reason },
      { status: 400 }
    );
  }

  // Auth gate. Google-first flow: the user signed in with Google
  // BEFORE picking a handle, so we always have a session here. The
  // email used for the waitlist row is derived from the session, not
  // accepted from the client — no spoofing surface.
  const userId = await readSessionEntryId();
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to claim." },
      { status: 401 }
    );
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to claim." },
      { status: 401 }
    );
  }
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "Your Google account has no email attached." },
      { status: 400 }
    );
  }

  try {
    await ensureSchema();
    const c = db();

    // Already-claimed gate. A missing row is fine in the Google-first
    // flow — the user may have signed in without ever hitting the
    // legacy /api/waitlist endpoint. The UPSERT below will INSERT.
    const row = await c.execute({
      sql: "SELECT claimed_handle FROM waitlist_signups WHERE email = ? LIMIT 1",
      args: [email],
    });
    const prior = row.rows[0]?.claimed_handle as string | null | undefined;
    if (prior) {
      return NextResponse.json(
        { error: `You already claimed ${prior}@talise.sui.`, prior },
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

    // The DB reservation. Three guards make this safe:
    //  1. The UPSERT's WHERE in the conflict branch: only flip
    //     `claimed_handle` when the existing row's value is NULL —
    //     same email can't double-claim if two requests race.
    //  2. The partial-unique index on `claimed_handle` — two different
    //     emails racing for the same handle: one write wins, the
    //     other raises a unique-violation we catch as 409.
    //  3. In the Google-first flow the row may not exist yet, so we
    //     UPSERT: INSERT a fresh waitlist row when missing.
    //
    // We reserve BEFORE the mint so a concurrent racer can't sneak in
    // between our availability check and the on-chain submit. If the
    // mint subsequently fails we roll back this column to NULL so the
    // user (and others) can retry.
    const userAgent = req.headers.get("user-agent");
    let claimed = false;
    try {
      const upd = await c.execute({
        sql: `INSERT INTO waitlist_signups (
                 email, created_at, ip, user_agent,
                 claimed_handle, handle_claimed_at
               ) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(email) DO UPDATE SET
                 claimed_handle = excluded.claimed_handle,
                 handle_claimed_at = excluded.handle_claimed_at
                 WHERE waitlist_signups.claimed_handle IS NULL
               RETURNING claimed_handle`,
        args: [
          email,
          Date.now(),
          ip,
          userAgent,
          norm.handle,
          Date.now(),
        ],
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
      // The conflict branch's WHERE blocked the flip — `claimed_handle`
      // was already non-NULL when we tried to write. A same-email
      // double-claim race.
      return NextResponse.json(
        { error: "You already claimed a handle." },
        { status: 409 }
      );
    }

    // On-chain mint. Onara-sponsored — the user pays no gas, the
    // operator wallet covers it. We do this SYNCHRONOUSLY (within the
    // request lifecycle) so the response only resolves once the
    // subname truly exists on chain.
    if (!suinsOperatorEnabled()) {
      // Roll back the DB reservation — we cannot honor the claim.
      await c
        .execute({
          sql: "UPDATE waitlist_signups SET claimed_handle = NULL, handle_claimed_at = NULL WHERE email = ?",
          args: [email],
        })
        .catch(() => null);
      return NextResponse.json(
        {
          error:
            "Minting is temporarily unavailable. Please try again in a minute.",
        },
        { status: 503 }
      );
    }

    let mintDigest = "";
    let mintNftId: string | null = null;
    try {
      const out = await mintSubname({
        username: norm.handle,
        userAddress: user.sui_address,
      });
      mintDigest = out.digest;
      mintNftId = out.subnameNftId;
    } catch (mintErr) {
      // Roll back the DB reservation so the user (or someone else) can
      // retry. We log the underlying error but surface a generic 502
      // — the caller cannot do anything useful with the on-chain
      // failure detail.
      const msg = (mintErr as Error).message.slice(0, 200);
      console.warn(
        `[waitlist/handle/claim] mint failed email=${email} handle=${norm.handle}: ${msg}`
      );
      await c
        .execute({
          sql: "UPDATE waitlist_signups SET claimed_handle = NULL, handle_claimed_at = NULL WHERE email = ?",
          args: [email],
        })
        .catch(() => null);
      return NextResponse.json(
        { error: "On-chain mint failed. Try again." },
        { status: 502 }
      );
    }

    // Mint succeeded. Persist the bind on the waitlist row so the
    // sign-in hook (`bindWaitlistHandleIfAny`) treats it as already
    // bound on future logins — same hook is still wired for legacy
    // rows that pre-date this commit.
    await c.execute({
      sql: `UPDATE waitlist_signups
               SET handle_object_id = COALESCE(handle_object_id, ?),
                   handle_bound_user_id = ?,
                   handle_bound_at = ?
             WHERE email = ?`,
      args: [mintNftId, String(user.id), Date.now(), email],
    });

    // Write the canonical bare handle on the user row. Swallow a
    // UNIQUE collision — the user might already own a different
    // talise_username from an unrelated path; the mint above already
    // succeeded and is authoritative.
    try {
      await c.execute({
        sql: "UPDATE users SET talise_username = ? WHERE id = ?",
        args: [norm.handle, Number(user.id)],
      });
    } catch (e) {
      console.warn(
        `[waitlist/handle/claim] users.talise_username write failed email=${email}: ${(e as Error).message}`
      );
    }

    // Confirmation email — runs AFTER the response is returned, via
    // Next.js 15's `after()` hook. The old fire-and-forget pattern
    // (`withTimeout(...).catch(() => null)` without await) was racy
    // on Vercel: the serverless function instance can shut down
    // immediately after the response, killing any in-flight promise.
    // `after()` is the Vercel-aware equivalent — guarantees the work
    // finishes before the instance is reclaimed. No timeout cap, so
    // Resend cold-starts (occasionally 3–5s) still complete instead
    // of dropping the email silently. Errors are logged but never
    // surface to the user, who has already seen "your handle is
    // claimed."
    after(async () => {
      try {
        await sendWaitlistConfirmation({
          to: email,
          name: user.name ?? null,
          claimedHandle: norm.handle,
        });
      } catch (e) {
        console.warn(
          `[waitlist/handle/claim] confirmation email failed email=${email} handle=${norm.handle}: ${(e as Error).message}`
        );
      }
    });

    console.log(
      `[waitlist/handle/claim] minted email=${email} handle=${norm.handle} digest=${mintDigest} nft=${mintNftId ?? "?"}`
    );
    return NextResponse.json({
      ok: true,
      handle: norm.handle,
      mintDigest,
      suiAddress: user.sui_address,
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
