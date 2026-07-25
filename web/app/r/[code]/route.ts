import { NextRequest, NextResponse, after } from "next/server";
import { setReferralCookie } from "@/lib/session";
import { REFERRAL_CODE_RE } from "@/lib/db";
import { emitGrowthEvent } from "@/lib/referral-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Referral landing, `talise.io/r/<CODE>`.
 *
 * This path had no route, so every invite link 404'd. It now captures the
 * inviter's code into the signed, httpOnly `talise_ref` cookie (issued with
 * Domain=.talise.io, so it survives the hop to app.talise.io where sign-up
 * happens) and redirects to the landing. Actual attribution runs later, at
 * sign-in / onboarding, when the cookie is read (see auth-exchange.ts).
 *
 * Robustness: we ALSO forward `?ref=<CODE>` so the landing's existing client
 * capture (`/api/referral/capture`) fires too, either path alone attributes.
 * An invalid or unknown code still redirects cleanly (no 404); it just won't
 * attribute, and a bad code is caught with a friendly message at onboarding.
 *
 * This is the ONE canonical referral entry point. `/waitlist?ref=CODE` (the old
 * second loop, which 404s) now redirects here, and every share surface builds
 * `/r/<CODE>` from `components/app/rewards/share-copy.ts`.
 *
 * `/r/*` is also claimed by the apps (see the AASA + assetlinks routes under
 * app/.well-known), so on a device WITH Talise installed this URL opens the app
 * directly and the app captures the code itself; this handler is what runs for
 * everyone else.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await params;
  const code = (raw ?? "").trim().toUpperCase();

  const dest = new URL("/", req.url);
  if (REFERRAL_CODE_RE.test(code)) {
    await setReferralCookie(code);
    dest.searchParams.set("ref", code);
    // Top of the funnel. Without this we could count signups but not the clicks
    // that produced them. Deferred with `after()` so a click never waits on
    // telemetry: this route's whole job is to 307 as fast as possible.
    const host = req.headers.get("host");
    const referer = req.headers.get("referer");
    after(() => emitGrowthEvent("invite_clicked", { code, surface: "web", host, referer }));
  }
  return NextResponse.redirect(dest, { status: 307 });
}
