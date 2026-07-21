import { api } from "@/api/client";
import { sponsorExecute, signAndSubmitSend } from "@/auth/zklogin";

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
  intervalMs: number;
  startMs: number;
  nextTrancheAt: number;
  state: string;
  fundingDigest?: string | null;
  createdAt: number;
};

type StreamPrepare = {
  streamId: string;
  escrowAddress: string;
  totalUsd: number;
  perMemberUsd: number;
  trancheUsd: number;
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

  /** Fund the escrow pot once (gasless Send rail), then activate the equal-share stream. */
  createStream: async (input: { teamId: string; totalUsd: number; numTranches: number; intervalMinutes: number }): Promise<TeamStream> => {
    const prep = await api<StreamPrepare>("/api/payouts/streams/create-prepare", { method: "POST", zk: true, body: input });
    const { digest } = await signAndSubmitSend(prep.escrowAddress, prep.totalUsd);
    return api<TeamStream>("/api/payouts/streams/record", { method: "POST", zk: true, body: { streamId: prep.streamId, digest } });
  },

  cancelStream: (id: string): Promise<TeamStream> => api(`/api/payouts/streams/${id}/cancel`, { method: "POST", zk: true, body: {} }),
};

/** Stream interval presets (minutes) — exact from ios TeamStreamSetupView. */
export const TEAM_STREAM_INTERVALS: { label: string; unit: string; minutes: number }[] = [
  { label: "Every minute", unit: "minute", minutes: 1 },
  { label: "Hourly", unit: "hour", minutes: 60 },
  { label: "Daily", unit: "day", minutes: 1440 },
  { label: "Weekly", unit: "week", minutes: 10080 },
];
