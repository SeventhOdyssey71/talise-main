import { api, ApiError } from "@/api/client";
import { sponsorExecute } from "@/auth/zklogin";

/** Payroll — pay a team in one gasless transaction. From ios PayrollAPI/TeamStreamAPI. */

export type TeamMember = { recipient: string; amount?: number | null; label?: string | null };

export type Team = {
  id: string;
  name: string;
  members: TeamMember[];
  createdAt?: number;
  updatedAt?: number;
  chainObjectId?: string | null;
};

export type TeamStreamMember = { address: string; handle?: string | null };

export type TeamStream = {
  id: string;
  teamId?: string | null;
  teamName: string;
  members: TeamStreamMember[];
  memberCount: number;
  totalUsd: number;
  trancheUsd: number;
  perMemberUsd: number;
  numTranches: number;
  tranchesDone: number;
  releasedUsd: number;
  /** Rounding remainder the schedule can't pay; refunded to you on cancel. */
  dustUsd?: number;
  intervalMs: number;
  startMs: number;
  nextTrancheAt: number;
  state: string;
  fundingDigest?: string | null;
  /** The on-chain TeamStream object holding the pot. */
  streamObjectId?: string | null;
  /** Pre-on-chain escrow-era stream — never fired by the client trigger. */
  legacy?: boolean;
  /** A tranche is due: the app fires it on open (there is no cron). */
  dueNow?: boolean;
  createdAt: number;
};

type StreamPrepare = {
  mode?: string;
  streamId: string;
  /** Sponsor-ready `team_stream::create` bytes: signing them funds the pot. */
  bytes: string;
  firstDueMs: number;
  totalUsd: number;
  perMemberUsd: number;
  trancheUsd: number;
  dustUsd?: number;
  numTranches: number;
  memberCount: number;
  intervalMs: number;
};

export const payrollApi = {
  teams: async (): Promise<Team[]> => {
    const r = await api<{ teams?: Team[] }>("/api/payouts/teams");
    return r.teams ?? [];
  },

  /** Create/edit a team. On-chain rail signs the prepared bytes then records; db rail is already saved. */
  saveTeam: async (input: { name: string; members: TeamMember[]; chainObjectId?: string | null }): Promise<{ team: Team }> => {
    const r = await api<{ mode?: string; team?: Team; bytes?: string; edit?: boolean; chainObjectId?: string | null }>(
      "/api/payouts/teams",
      { method: "POST", zk: true, body: { name: input.name, members: input.members } },
    );
    if (r.mode === "onchain" && r.bytes) {
      const { digest } = await sponsorExecute(r.bytes, { kind: "team-save" });
      return api<{ team: Team }>("/api/payouts/teams/record", {
        method: "POST",
        zk: true,
        body: { digest, name: input.name, members: input.members, chainObjectId: r.chainObjectId ?? input.chainObjectId ?? null },
      });
    }
    return { team: r.team as Team };
  },

  deleteTeam: async (id: string): Promise<void> => {
    const r = await api<{ mode?: string; bytes?: string }>(`/api/payouts/teams/${id}`, { method: "DELETE" });
    if (r.mode === "onchain" && r.bytes) {
      const { digest } = await sponsorExecute(r.bytes, { kind: "team-delete" });
      await api(`/api/payouts/teams/${id}/record`, { method: "POST", zk: true, body: { digest } });
    }
  },

  /** Batch pay everyone in one sponsor-ready PTB (gasless). */
  payTeam: async (input: {
    recipients: { to: string; amount: number; label?: string | null }[];
    teamName?: string;
    teamId?: string;
  }): Promise<{ totalUsd: number; count: number }> => {
    const prep = await api<{ batchId: string; bytes: string; recipientCount: number; totalUsd: number }>(
      "/api/payouts/batch/prepare",
      { method: "POST", zk: true, body: { recipients: input.recipients, asset: "USDsui", teamName: input.teamName, teamId: input.teamId } },
    );
    const { digest } = await sponsorExecute(prep.bytes, { kind: "team-pay", amountUsd: prep.totalUsd });
    await api(`/api/payouts/batch/${prep.batchId}/record`, { method: "POST", zk: true, body: { digest } });
    return { totalUsd: prep.totalUsd, count: prep.recipientCount };
  },

  streams: async (): Promise<TeamStream[]> => {
    const r = await api<{ streams?: TeamStream[] }>("/api/payouts/streams");
    return r.streams ?? [];
  },

  /**
   * Fund the pot ONCE by signing `team_stream::create` — that single gasless
   * transaction moves the whole amount into an on-chain stream object you own.
   * Nobody (including Talise) can redirect it: the roster, the share and the
   * schedule are fixed on chain, and each due tranche then releases
   * permissionlessly. Then record to activate.
   */
  createStream: async (input: { teamId: string; totalUsd: number; numTranches: number; intervalMinutes: number }): Promise<TeamStream> => {
    const prep = await api<StreamPrepare>("/api/payouts/streams/create-prepare", { method: "POST", zk: true, body: input });
    const { digest } = await sponsorExecute(prep.bytes, { kind: "team-stream-create", amountUsd: prep.totalUsd });
    // Activate. A 409 means the fullnode hasn't surfaced the new stream object yet
    // — retry with the SAME digest (activation is idempotent, and the pot is
    // already sitting in the user's own on-chain stream either way).
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await api<{ stream: TeamStream }>("/api/payouts/streams/record", {
          method: "POST",
          zk: true,
          body: { streamId: prep.streamId, digest },
        });
        return r.stream;
      } catch (e) {
        const retryable = e instanceof ApiError && e.status === 409;
        if (!retryable || attempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, 1_500));
      }
    }
  },

  /**
   * Fire every DUE tranche — the "no cron" trigger, same shape as rules:
   * prepare → sign → record, per due stream. `release_due_tranche` is
   * permissionless on chain, so an open app just executes what the creator
   * already funded and authorized. Every step is best-effort: the contract is
   * the real gate (it aborts ENotDue / EExhausted / ECancelled), so a skip is
   * always safe and can never pay twice. Returns how many tranches went out.
   */
  fireDueStreams: async (streams?: TeamStream[]): Promise<number> => {
    let list = streams;
    try {
      if (!list) list = await payrollApi.streams();
    } catch {
      return 0;
    }
    const now = Date.now();
    const due = list.filter(
      (s) => s.state === "active" && !s.legacy && !!s.streamObjectId && (s.dueNow || s.nextTrancheAt <= now),
    );
    let fired = 0;
    for (const s of due) {
      try {
        const prep = await api<{ mode: string; bytes: string }>(`/api/payouts/streams/${s.id}/release`, {
          method: "POST",
          zk: true,
          body: {},
        });
        const { digest } = await sponsorExecute(prep.bytes, { kind: "team-stream-release" });
        await api(`/api/payouts/streams/${s.id}/released`, { method: "POST", zk: true, body: { digest } });
        fired++;
      } catch {
        // ENotDue / NO_STREAM (409) / transient — the contract is the gate; skip.
      }
    }
    return fired;
  },

  /**
   * Stop a stream: sign the on-chain `cancel` (refunds the whole remaining pot —
   * unreleased payouts plus rounding dust — to you), then close the row. A 409 /
   * `mode: "recorded"` means there was nothing on chain to refund.
   */
  cancelStream: async (id: string): Promise<void> => {
    try {
      const r = await api<{ mode?: string; bytes?: string }>(`/api/payouts/streams/${id}/cancel`, {
        method: "POST",
        zk: true,
        body: {},
      });
      if (r.mode === "onchain" && r.bytes) {
        const { digest } = await sponsorExecute(r.bytes, { kind: "team-stream-cancel" });
        await api(`/api/payouts/streams/${id}/cancelled`, { method: "POST", zk: true, body: { digest } });
      }
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409) throw e;
    }
  },
};

/** Stream interval presets (minutes) — exact from ios TeamStreamSetupView. */
export const TEAM_STREAM_INTERVALS: { label: string; unit: string; minutes: number }[] = [
  { label: "Every minute", unit: "minute", minutes: 1 },
  { label: "Hourly", unit: "hour", minutes: 60 },
  { label: "Daily", unit: "day", minutes: 1440 },
  { label: "Weekly", unit: "week", minutes: 10080 },
];
