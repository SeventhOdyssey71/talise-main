import { api } from "@/api/client";
import { sponsorExecute, signAndSubmitSend } from "@/auth/zklogin";
import { usdToMicros } from "@/api/money";

/** Contracts — hire & pay over time. Wraps a funded stream. From ios ContractsView.swift. */

export type Cadence = "hourly" | "daily" | "weekly" | "monthly";

export type Contract = {
  id: string;
  payeeAddress: string;
  payeeHandle?: string | null;
  title: string;
  rateUsd: number;
  cadence: Cadence;
  cadenceLabel?: string | null;
  periods: number;
  totalUsd: number;
  streamId: string;
  status: "active" | "completed" | "cancelled" | string;
  createdAt: number;
  paidUsd?: number;
  remainingUsd?: number;
  periodsPaid?: number;
  nextPayAt?: number | null;
  streamState?: string;
};

/** Cadence picker — label, DTO cadence, and the underlying interval (minutes). */
export const CONTRACT_CADENCES: { label: string; cadence: Cadence; minutes: number }[] = [
  { label: "Hour", cadence: "hourly", minutes: 60 },
  { label: "Day", cadence: "daily", minutes: 1440 },
  { label: "Week", cadence: "weekly", minutes: 10080 },
  { label: "Month", cadence: "monthly", minutes: 43200 },
];

export const contractsApi = {
  list: async (): Promise<Contract[]> => {
    const r = await api<{ contracts?: Contract[] }>("/api/contracts");
    return r.contracts ?? [];
  },

  /**
   * Fund a stream upfront (rate × periods), then wrap it in contract metadata.
   * On-chain rail signs the stream funding bytes; escrow rail sends gaslessly.
   */
  create: async (input: {
    payeeAddress: string;
    payeeHandle?: string;
    title: string;
    rateUsd: number;
    cadence: Cadence;
    periods: number;
    intervalMs: number;
  }): Promise<{ ok: boolean }> => {
    const totalUsd = input.rateUsd * input.periods;
    const prep = await api<{ mode?: string; bytes?: string; escrowAddress?: string; error?: string }>(
      "/api/streams/create-prepare",
      { method: "POST", zk: true, body: { to: input.payeeAddress, totalUsd, intervalMs: input.intervalMs, numTranches: input.periods } },
    );
    if (prep.error) throw new Error(prep.error);

    let fundingDigest: string;
    if (prep.mode === "onchain" && prep.bytes) {
      fundingDigest = (await sponsorExecute(prep.bytes, { kind: "contract-fund", amountUsd: totalUsd })).digest;
    } else {
      const escrow = prep.escrowAddress ?? (await api<{ escrowAddress: string }>("/api/streams/escrow")).escrowAddress;
      fundingDigest = (await signAndSubmitSend(escrow, totalUsd)).digest;
    }

    const rec = await api<{ id?: string }>("/api/streams/record", {
      method: "POST",
      zk: true,
      body: {
        fundingDigest,
        recipientAddress: input.payeeAddress,
        recipientHandle: input.payeeHandle,
        totalMicros: usdToMicros(totalUsd),
        trancheMicros: usdToMicros(input.rateUsd),
        numTranches: input.periods,
        startMs: Date.now(),
        intervalMs: input.intervalMs,
      },
    });

    return api("/api/contracts", {
      method: "POST",
      zk: true,
      body: {
        streamId: rec.id,
        payeeAddress: input.payeeAddress,
        payeeHandle: input.payeeHandle,
        title: input.title,
        rateUsd: input.rateUsd,
        cadence: input.cadence,
        periods: input.periods,
        fundingDigest,
      },
    });
  },

  /** Sender: stop + refund remainder. If server hands back an on-chain path, sign it. */
  cancel: async (id: string): Promise<{ refundUsd?: number }> => {
    const r = await api<{ refundUsd?: number; onchainCancelPath?: string }>(`/api/contracts/${id}`, {
      method: "POST",
      zk: true,
      body: { action: "cancel" },
    });
    if (r.onchainCancelPath) {
      const c = await api<{ mode?: string; bytes?: string; refundUsd?: number }>(r.onchainCancelPath, {
        method: "POST",
        zk: true,
        body: {},
      });
      if (c.mode === "onchain" && c.bytes) await sponsorExecute(c.bytes, { kind: "contract-cancel" });
      return { refundUsd: c.refundUsd ?? r.refundUsd };
    }
    return { refundUsd: r.refundUsd };
  },
};
