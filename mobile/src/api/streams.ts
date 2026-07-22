import { api } from "@/api/client";
import { sponsorExecute, signAndSubmitSend } from "@/auth/zklogin";
import { usdToMicros } from "@/api/money";

/** Streams — money over time. Endpoints + DTOs verbatim from ios StreamView.swift. */

export type StreamRole = "recipient" | "sender";

export type Stream = {
  id: string;
  state: string;
  role?: StreamRole;
  recipientHandle?: string | null;
  recipientAddress?: string | null;
  totalUsd?: number;
  releasedUsd?: number;
  remainingUsd?: number;
  tranchesDone?: number;
  numTranches?: number;
  nextTrancheAt?: number | null;
  startMs?: number | null;
  intervalMs?: number | null;
};

export const streamsApi = {
  list: async (): Promise<Stream[]> => {
    const r = await api<{ streams?: Stream[] }>("/api/streams");
    return r.streams ?? [];
  },

  /**
   * Create + fund a stream. On-chain rail signs the funding bytes via sponsor-
   * execute; escrow rail sends to the escrow address gaslessly. Records with the
   * funding digest to activate. `intervalMs`/`numTranches` come from the presets.
   */
  create: async (input: {
    recipientAddress: string;
    recipientHandle?: string;
    totalUsd: number;
    intervalMs: number;
    numTranches: number;
  }): Promise<{ id?: string }> => {
    const prep = await api<{ mode?: string; bytes?: string; escrowAddress?: string; error?: string }>(
      "/api/streams/create-prepare",
      {
        method: "POST",
        zk: true,
        body: { to: input.recipientAddress, totalUsd: input.totalUsd, intervalMs: input.intervalMs, numTranches: input.numTranches },
      },
    );
    if (prep.error) throw new Error(prep.error);

    let fundingDigest: string;
    if (prep.mode === "onchain" && prep.bytes) {
      fundingDigest = (await sponsorExecute(prep.bytes, { kind: "stream-fund", amountUsd: input.totalUsd })).digest;
    } else {
      const escrow = prep.escrowAddress ?? (await api<{ escrowAddress: string }>("/api/streams/escrow")).escrowAddress;
      fundingDigest = (await signAndSubmitSend(escrow, input.totalUsd)).digest;
    }

    const trancheUsd = input.totalUsd / input.numTranches;
    return api<{ id?: string }>("/api/streams/record", {
      method: "POST",
      zk: true,
      body: {
        fundingDigest,
        recipientAddress: input.recipientAddress,
        recipientHandle: input.recipientHandle,
        totalMicros: usdToMicros(input.totalUsd),
        trancheMicros: usdToMicros(trancheUsd),
        numTranches: input.numTranches,
        startMs: Date.now(),
        intervalMs: input.intervalMs,
      },
    });
  },

  /** Sender: stop + refund the remainder. On-chain rail signs the withdrawal bytes. */
  cancel: async (id: string): Promise<{ refundUsd?: number }> => {
    const r = await api<{ mode?: string; bytes?: string; refundUsd?: number }>(`/api/streams/${id}/cancel`, {
      method: "POST",
      zk: true,
      body: {},
    });
    if (r.mode === "onchain" && r.bytes) await sponsorExecute(r.bytes, { kind: "stream-cancel" });
    return { refundUsd: r.refundUsd };
  },

  /** Recipient: pull accrued tranches. On-chain rail signs the claim bytes. */
  claim: async (id: string): Promise<{ nothingToClaim?: boolean }> => {
    const r = await api<{ mode?: string; bytes?: string; nothingToClaim?: boolean }>(`/api/streams/${id}/claim`, {
      method: "POST",
      zk: true,
      body: {},
    });
    if (r.mode === "onchain" && r.bytes) await sponsorExecute(r.bytes, { kind: "stream-claim" });
    return { nothingToClaim: r.nothingToClaim };
  },
};

/** Duration & interval presets (minutes) — exact from ios StreamSetupView. */
export const STREAM_DURATIONS: { label: string; minutes: number }[] = [
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 1440 },
  { label: "1 week", minutes: 10080 },
  { label: "30 days", minutes: 43200 },
];
export const STREAM_INTERVALS: { label: string; minutes: number }[] = [
  { label: "1 min", minutes: 1 },
  { label: "10 min", minutes: 10 },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 1440 },
];

/** numTranches = max(1, duration/interval); each tranche = total/numTranches. */
export function planTranches(totalUsd: number, durationMin: number, intervalMin: number) {
  const numTranches = Math.max(1, Math.floor(durationMin / Math.max(1, intervalMin)));
  return { numTranches, trancheUsd: totalUsd / numTranches, intervalMs: intervalMin * 60_000 };
}
