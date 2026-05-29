import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { userById } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 *
 * Lightweight, web-session-cookie-only "am I signed in?" probe used by
 * the waitlist UI to branch between the "needs sign-in" CTA and the
 * "claim now" form. Unlike `/api/me`, this never touches SuiNS or any
 * RPC — it must be sub-10ms so we can race it in parallel with the
 * "existing handle" lookup on mount.
 *
 * Bearer tokens are intentionally NOT honored here: the waitlist is a
 * web surface, the mobile app has its own flow. Reading bearers would
 * be a footgun if some embedded webview replayed a header.
 *
 * Shape:
 *   { signedIn: false }
 *   { signedIn: true, email, suiAddress, handle: string | null }
 */
export async function GET(_req: Request) {
  const userId = await readSessionEntryId();
  if (!userId) {
    return NextResponse.json({ signedIn: false });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ signedIn: false });
  }
  return NextResponse.json({
    signedIn: true,
    email: user.email,
    suiAddress: user.sui_address,
    handle: user.talise_username ?? null,
  });
}
