/**
 * In-process sliding-window rate limiter.
 *
 * --- Scope ---
 * Single Node process, in-memory Map. Good enough for our launch traffic
 * profile (one Vercel function instance handles thousands of req/s and
 * cold starts reset the counter, which is acceptable for abuse-mitigation
 * rather than strict quota enforcement).
 *
 * --- Upgrade path: Upstash Redis ---
 * When we cross ~1k DAU or move to multi-region serverless, swap this
 * Map for an Upstash Redis pipeline:
 *
 *   import { Redis } from "@upstash/redis";
 *   const redis = Redis.fromEnv();
 *   const pipe = redis.pipeline();
 *   pipe.incr(`rl:${key}`);
 *   pipe.expire(`rl:${key}`, windowSec, "NX");
 *   const [count] = await pipe.exec<[number]>();
 *   return count <= limit ? { ok: true } : { ok: false, retryAfterSec: ... };
 *
 * Required env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
 * Public API (`rateLimit`, `getClientIp`) stays identical so callers
 * don't change. The 4 currently-hardened routes pick up the swap for
 * free.
 *
 * --- TODO: extend to these routes next (P1 backlog) ---
 *   - /api/zk/sponsor                (sponsor request before execute)
 *   - /api/send/prepare              (PTB build is expensive)
 *   - /api/onramp/quote
 *   - /api/onramp/create-session
 *   - /api/offramp/quote
 *   - /api/username/claim            (handle squatting defense)
 *   - /api/auth/callback             (web OAuth landing)
 *   - /api/contacts/lookup           (PII enumeration vector)
 */

type Bucket = { count: number; resetAt: number };

// Module-level Map survives across requests within a single Node process.
// Vercel's per-function isolation means each lambda instance has its own
// copy — fine for abuse control, not for strict global quotas.
const buckets = new Map<string, Bucket>();

// Lazy GC: every N inserts we sweep expired keys so the Map doesn't grow
// unbounded under a long-running process (Vercel typically recycles
// instances often enough that this is mostly defensive).
let opsSinceSweep = 0;
const SWEEP_EVERY = 500;

function sweep(now: number): void {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitOptions {
  /** Caller-supplied key, typically `${routeId}:${ip}` or `${routeId}:user:${id}`. */
  key: string;
  /** Max requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds the client should wait before retrying. Only present when ok=false. */
  retryAfterSec?: number;
}

/**
 * Fixed-window rate limit check. Increments the counter for `key` and
 * returns whether the caller is within `limit` in the current window.
 *
 * Why fixed-window and not sliding-window: simpler, atomic in a single
 * process, and the burst behavior at window edges is fine for the
 * limits we care about (5-30 req per minute/hour).
 */
export function rateLimit(opts: RateLimitOptions): RateLimitResult {
  const { key, limit, windowSec } = opts;
  const now = Date.now();
  const windowMs = windowSec * 1000;

  if (++opsSinceSweep >= SWEEP_EVERY) {
    opsSinceSweep = 0;
    sweep(now);
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  existing.count += 1;
  if (existing.count <= limit) {
    return { ok: true };
  }

  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return { ok: false, retryAfterSec };
}

/**
 * Best-effort client IP for rate-limit keying.
 *
 * Order matters for anti-spoofing: prefer the headers the PLATFORM sets
 * (and a client cannot forge) before the client-influenced
 * `x-forwarded-for`. On Vercel, `x-vercel-forwarded-for` and
 * `x-real-ip` are set by the edge to the true connecting IP and any
 * inbound value is overwritten — so they can't be spoofed. The leftmost
 * value of a raw `x-forwarded-for` IS attacker-controllable on
 * non-Vercel / self-hosted deploys (a client can send
 * `X-Forwarded-For: <anything>` to rotate their rate-limit bucket and
 * bypass every limiter), so it's the LAST resort. Falls back to a
 * literal so unknown clients still share one bucket rather than
 * skipping the check.
 *
 * AUDIT_PENDING(F3): these limits are still per-instance (in-memory Map).
 * Promote to Upstash Redis before scaling so caps are global, not N×.
 */
export function getClientIp(req: Request): string {
  // Vercel-set, non-spoofable.
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const first = vercel.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  // Client-influenced — last resort.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
