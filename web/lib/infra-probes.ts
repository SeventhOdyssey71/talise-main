import "server-only";

import { dbHealth } from "@/lib/db";
import { sui } from "@/lib/sui";
import { onara } from "@/lib/onara";
import { getRateTable } from "@/lib/fx-feed";
import type { ProbeId } from "@/lib/infra-config";

/**
 * Server-side latency probes for the /infra dashboard. Each probe times a
 * READ-ONLY call against one integration (no money moves, no state changes).
 * Reuses the same dependency clients /api/health pings.
 */

export type ProbeResult = { id: ProbeId; ok: boolean; ms: number; detail: string };

async function timed(id: ProbeId, fn: () => Promise<string>): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { id, ok: true, ms: Date.now() - t0, detail };
  } catch (e) {
    return { id, ok: false, ms: Date.now() - t0, detail: (e as Error).message.slice(0, 160) };
  }
}

/** Network reachability ping (RTT to a base URL) — for partners we don't make a real call to. */
async function reach(url: string): Promise<string> {
  const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000), redirect: "manual" });
  return `reachable · HTTP ${r.status}`;
}

const RUNNERS: Record<ProbeId, () => Promise<string>> = {
  db: async () => {
    const h = await dbHealth();
    if (!h.ok) throw new Error(h.error ?? "db unhealthy");
    return `SELECT 1 in ${h.latencyMs}ms`;
  },
  sui: async () => {
    await sui().getReferenceGasPrice();
    return "reference gas price ok";
  },
  onara: async () => {
    if (!process.env.ONARA_URL) throw new Error("ONARA_URL not configured");
    const s = (await onara().status()) as { address?: string };
    if (!s.address) throw new Error("no sponsor address");
    return `sponsor ${s.address.slice(0, 10)}…`;
  },
  fx: async () => {
    await getRateTable();
    return "rate table loaded";
  },
  prover: async () => {
    if (!process.env.SHINAMI_API_KEY) throw new Error("SHINAMI_API_KEY not configured");
    return reach("https://api.shinami.com/");
  },
  paga: async () => reach(process.env.PAGA_BASE_URL?.trim() || "https://beta.mypaga.com"),
  stripe: async () => reach("https://api.stripe.com/healthcheck"),
};

// Connection-backed integrations: measure WARM steady-state (what a user feels
// after the channel is established), not the one-time cold connect — boot
// warmup means cold-connect rarely hits a real request anyway. Reachability
// pings (paga/stripe/prover) are measured single-shot (cold RTT is their only
// meaningful signal).
const WARM_FIRST: ReadonlySet<ProbeId> = new Set<ProbeId>(["db", "sui", "onara", "fx"]);

export async function runProbe(id: ProbeId): Promise<ProbeResult> {
  const runner = RUNNERS[id];
  if (!runner) return { id, ok: false, ms: 0, detail: "unknown probe" };
  if (WARM_FIRST.has(id)) {
    // Throwaway warm pass so the timed read reflects steady-state, not a cold
    // channel open. If the warm pass itself fails we fall through and the timed
    // read surfaces the real error.
    try {
      await runner();
    } catch {
      /* surfaced by the timed read below */
    }
  }
  return timed(id, runner);
}

export function allProbeIds(): ProbeId[] {
  return Object.keys(RUNNERS) as ProbeId[];
}
