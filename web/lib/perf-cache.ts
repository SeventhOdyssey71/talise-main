type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

/**
 * Tiny in-memory TTL cache for server-side hot-path values like
 * `onara.status()` and `getReferenceGasPrice()`. Lives for the lifetime
 * of the Node process — Next.js Node runtime keeps modules alive across
 * requests so this works in practice.
 *
 * Not safe for per-user secrets. Only use for values that are global
 * and cheap to refetch if the cache is wrong.
 */
export async function memoTtl<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await fetcher();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidate(key: string) {
  store.delete(key);
}

// ───────────────────────────────────────────────────────────────────
// Send-latency ring buffer.
//
// In-process samples of the prepare + execute legs so an operator can
// hit `/api/health/send-latency` and see actual ms numbers without
// grepping Vercel logs. Bounded to 64 entries — enough to spot a
// regression, small enough that the buffer never matters for memory.
//
// Per-leg sample: `{ leg, totalMs, atMs, extras }`. `extras` carries
// the per-step breakdowns we already log (pk/roundup/navi for prepare,
// proof/onara for execute) so the dashboard can show a histogram per
// leg + a freshness-by-source breakdown for the proof.

export type SendLatencyLeg = "prepare" | "execute";

export type SendLatencySample = {
  leg: SendLatencyLeg;
  totalMs: number;
  atMs: number;
  extras?: Record<string, number | string | boolean | undefined>;
};

const SEND_LATENCY_MAX = 64;
const sendLatencyRing: SendLatencySample[] = [];

export function recordSendLatency(sample: SendLatencySample): void {
  sendLatencyRing.push(sample);
  if (sendLatencyRing.length > SEND_LATENCY_MAX) {
    sendLatencyRing.splice(0, sendLatencyRing.length - SEND_LATENCY_MAX);
  }
}

export function readSendLatencySamples(): SendLatencySample[] {
  // Return newest-first so the operator sees fresh data at the top of
  // the JSON response without paging.
  return sendLatencyRing.slice().reverse();
}
