import { NextResponse, type NextRequest } from "next/server";

/**
 * Global security response headers.
 *
 * Applied to every path — runs at the edge before the route handler so
 * the headers are present even on cached or static responses.
 *
 * NOTE: CSP is deliberately omitted in this pass. Talise renders
 * inline-styled email previews, embeds third-party iframes for onramp /
 * offramp partners, and uses Next.js Script tags that inject hashed
 * inline bootstrap — landing a strict CSP without first auditing every
 * route would break product flows. Tracked as P1 in
 * `docs/security/audit.md` — must ship before public launch.
 */
const SECURITY_HEADERS: Record<string, string> = {
  // Two-year HSTS with preload — matches the chrome://hsts requirement.
  // Safe because every Talise host already serves HTTPS exclusively.
  "Strict-Transport-Security":
    "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Disable powerful APIs we never request. Tighten further when we add
  // payments / clipboard APIs and need explicit grants.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function middleware(_req: NextRequest) {
  // Note: we deliberately do NOT redirect www→apex here. The Vercel
  // project's primary domain is www.talise.io and Vercel already 307s
  // the apex over to www. A second redirect in the opposite direction
  // creates a loop and (worse) turns API POSTs into GETs the moment
  // the browser follows the redirect — breaking the waitlist form. The
  // OAuth redirect_uri mismatch is solved on the Google Cloud Console
  // side instead by registering both variants.
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export const config = {
  // Skip Next internals + common static assets — those don't need the
  // headers and adding them on every static fetch is wasted work. We
  // keep the matcher liberal otherwise so every page + API response
  // picks the headers up.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)).*)",
  ],
};
