import { api } from "@/api/client";
import { sponsorExecute, signAndSubmitSend } from "@/auth/zklogin";
import { usdToMicros } from "@/api/money";

/** Streams — money over time. Endpoints + DTOs verbatim from ios StreamView.swift. */

export type StreamRole = "recipient" | "sender";

export type Stream = {
  id: string;
  /** Server-DERIVED: active | paused | completed | cancelled. */
  state: string;
  role?: StreamRole;
  /** Live-resolved name for the recipient, else the creation-time snapshot. */
  recipientHandle?: string | null;
  recipientAddress?: string | null;
  senderName?: string | null;
  /** The OTHER party from our side: the sender when money streams in. */
  counterpartyAddress?: string | null;
  counterpartyName?: string | null;
  totalUsd?: number;
  /** Confirmed on chain: money the recipient actually holds. */
  releasedUsd?: number;
  remainingUsd?: number;
  /** Earned by the Clock, claimed or not. */
  accruedUsd?: number;
  accruedTranches?: number;
  /** Earned but not pushed yet, what the next claim moves. */
  claimableUsd?: number;
  claimableTranches?: number;
  /** Something is due that the chain hasn't paid yet, the auto-fire gate. */
  dueNow?: boolean;
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

  /**
   * Tell the server a signed stream tx landed so the mirror re-reads the
   * contract's release cursor. Best-effort: the figures on the card come from
   * the chain, so a missed confirm only means the next claim re-syncs them.
   */
  confirm: async (id: string, digest: string): Promise<void> => {
    try {
      await api(`/api/streams/${id}/confirm`, { method: "POST", zk: true, body: { digest } });
    } catch {
      /* the mirror catches up on the next claim */
    }
  },

  /**
   * Sender: stop + refund the true remainder. The server's PTB settles every
   * accrued tranche to the recipient before withdrawing, so cancelling never
   * claws back money the Clock already earned them.
   */
  cancel: async (id: string): Promise<{ refundUsd?: number }> => {
    const r = await api<{ mode?: string; bytes?: string; refundUsd?: number }>(`/api/streams/${id}/cancel`, {
      method: "POST",
      zk: true,
      body: {},
    });
    if (r.mode === "onchain" && r.bytes) {
      const { digest } = await sponsorExecute(r.bytes, { kind: "stream-cancel" });
      await streamsApi.confirm(id, digest);
    }
    return { refundUsd: r.refundUsd };
  },

  /** Either party: push every tranche the Clock has made due to the recipient. */
  claim: async (id: string): Promise<{ nothingToClaim?: boolean }> => {
    const r = await api<{ mode?: string; bytes?: string; nothingToClaim?: boolean }>(`/api/streams/${id}/claim`, {
      method: "POST",
      zk: true,
      body: {},
    });
    if (r.mode === "onchain" && r.bytes) {
      const { digest } = await sponsorExecute(r.bytes, { kind: "stream-claim" });
      await streamsApi.confirm(id, digest);
    }
    return { nothingToClaim: r.nothingToClaim };
  },

  /**
   * Sender: pause or resume, ON CHAIN. Only the contract's `paused` flag
   * actually stops money moving (claim_accrued is permissionless), so both
   * directions sign sponsor-ready bytes and then confirm the digest.
   */
  setPaused: async (id: string, paused: boolean): Promise<void> => {
    const r = await api<{ mode?: string; bytes?: string; state?: string }>(
      `/api/streams/${id}/${paused ? "pause" : "resume"}`,
      { method: "POST", zk: true, body: {} },
    );
    if (r.mode === "onchain" && r.bytes) {
      const { digest } = await sponsorExecute(r.bytes, {
        kind: paused ? "stream-pause" : "stream-resume",
      });
      await streamsApi.confirm(id, digest);
    }
  },

  /**
   * Fire every DUE claim — the "no cron" trigger, same shape as rules and team
   * streams. `claim_accrued` is permissionless on chain and can only ever pay
   * the stream's hardwired recipient, so BOTH sides fire it: the sender opening
   * the app pushes their own outgoing stream forward, which is what makes it
   * actually stream instead of waiting on a button.
   *
   * `dueNow` means the Clock has earned something the chain hasn't paid yet, so
   * a stream with nothing due costs no sponsored gas, and paused/cancelled
   * streams are excluded server-side because the contract would abort them.
   * Every step is best-effort; the contract is the real gate. Returns how many
   * claims went out.
   */
  fireDueClaims: async (streams?: Stream[]): Promise<number> => {
    let list = streams;
    try {
      if (!list) list = await streamsApi.list();
    } catch {
      return 0;
    }
    let fired = 0;
    for (const s of list.filter((x) => x.dueNow)) {
      try {
        const r = await api<{ mode?: string; bytes?: string }>(`/api/streams/${s.id}/claim`, {
          method: "POST",
          zk: true,
          body: {},
        });
        if (r.mode !== "onchain" || !r.bytes) continue;
        const { digest } = await sponsorExecute(r.bytes, { kind: "stream-claim" });
        await streamsApi.confirm(s.id, digest);
        fired++;
      } catch {
        // Nothing due after all / session lapse / transient — skip silently.
      }
    }
    return fired;
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
