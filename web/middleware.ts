import { NextResponse, type NextRequest } from "next/server";

/**
 * Global security response headers.
 *
 * Applied to every path — runs at the edge before the route handler so
 * the headers are present even on cached or static responses.
 *
 * CSP: shipped in REPORT-ONLY mode (2026-06-01). A strict enforcing CSP can
 * break product flows (inline-styled emails, third-party onramp/offramp
 * iframes, Next.js inline bootstrap), so we monitor first: violations are
 * reported but nothing is blocked. PROMOTE to enforcing (rename the header to
 * `Content-Security-Policy` + switch script-src to a per-request nonce instead
 * of 'unsafe-inline') once the Vercel/console reports confirm zero legitimate
 * violations. Until then this still hardens against the worst case alongside
 * the session-only ephemeral-key storage (web/lib/zkclient.ts).
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  // 'unsafe-inline' is a temporary allowance for Next's inline bootstrap +
  // Vercel Analytics; replace with a nonce when promoting to enforcing.
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://lh3.googleusercontent.com https://images.unsplash.com",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com https://*.vercel-insights.com https://va.vercel-scripts.com",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  // Monitor-only CSP (see note above) — defense-in-depth against XSS without
  // risking a broken product flow before launch.
  "Content-Security-Policy-Report-Only": CSP_REPORT_ONLY,
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

// F13: cap request bodies on the API surface. Next.js App Router doesn't
// impose a small default, so a multi-MB/GB POST is a cheap allocation/parse
// DoS. 1 MB is far above any legitimate Talise payload (signable bytes are
// tens of KB; webhooks are small). Chunked/absent Content-Length falls
// through to the route's own parse — no regression.
const MAX_API_BODY_BYTES = 1_048_576;

export function middleware(req: NextRequest) {
  if (
    req.nextUrl.pathname.startsWith("/api/") &&
    (req.method === "POST" || req.method === "PUT" || req.method === "PATCH")
  ) {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(len) && len > MAX_API_BODY_BYTES) {
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    }
  }
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
