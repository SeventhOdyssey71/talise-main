import { api } from "@/api/client";
import { sponsorExecute, signAndSubmitSend } from "@/auth/zklogin";

/** Cheques — money in a link. Endpoints + DTOs verbatim from ios ChequesView.swift. */

export type ChequeStatus = "draft" | "funded" | "claimed" | "reclaimed" | "voided" | "expired" | string;

export type MyCheque = {
  id: string;
  amountUsd: number;
  status: ChequeStatus;
  memo?: string | null;
  payeeLabel?: string | null;
  createdAt: number;
  expiresAt: number;
  reclaimable: boolean;
};

export type ChequePreview = {
  id: string;
  amountUsd: number;
  status: ChequeStatus;
  payeeLabel?: string | null;
  memo?: string | null;
  signatureName?: string | null;
  creatorDisplay: string;
  allowedCountries: string[];
  expiresAt: number;
  claimable: boolean;
};

type CreateResp = {
  chequeId: string;
  amountUsd: number;
  claimUrl: string;
  secret: string;
  mode?: "onchain" | "escrow";
  fundingBytes?: string;
  escrowAddress?: string;
};

export const chequesApi = {
  mine: async (): Promise<MyCheque[]> => {
    const r = await api<{ cheques?: MyCheque[] }>("/api/cheques/mine");
    return r.cheques ?? [];
  },

  /**
   * Create + fund a cheque. On-chain rail signs `fundingBytes` via sponsor-execute;
   * escrow rail sends to `escrowAddress` gaslessly. Both confirm the funding digest.
   * Returns the shareable claim link.
   */
  create: async (input: {
    amountUsd: number;
    payeeLabel: string;
    memo?: string;
    allowedCountries: string[];
  }): Promise<{ claimUrl: string }> => {
    const r = await api<CreateResp>("/api/cheques/create", { method: "POST", zk: true, body: input });
    if (r.mode === "onchain" && r.fundingBytes) {
      const { digest } = await sponsorExecute(r.fundingBytes, { kind: "cheque-fund", amountUsd: input.amountUsd });
      await api(`/api/cheques/${r.chequeId}/confirm-funded`, { method: "POST", zk: true, body: { digest } });
    } else if (r.escrowAddress) {
      const { digest } = await signAndSubmitSend(r.escrowAddress, input.amountUsd);
      await api(`/api/cheques/${r.chequeId}/confirm-funded`, { method: "POST", zk: true, body: { digest } });
    }
    return { claimUrl: r.claimUrl };
  },

  preview: (id: string, secret: string): Promise<ChequePreview> =>
    api<ChequePreview>(`/api/cheques/${id}/preview?s=${encodeURIComponent(secret)}`),

  claim: (id: string, secret: string): Promise<{ ok: boolean; digest?: string; amountUsd?: number }> =>
    api(`/api/cheques/${id}/claim/release`, { method: "POST", zk: true, body: { secret } }),

  /**
   * Creator reclaim. On-chain rail signs `reclaimBytes` then confirms with the
   * digest; escrow rail refunds server-side (no signature). Returns the amount back.
   */
  reclaim: async (id: string): Promise<{ amountUsd?: number }> => {
    const r = await api<{ mode?: string; reclaimBytes?: string; status?: string; amountUsd?: number }>(
      `/api/cheques/${id}/reclaim`,
      { method: "POST", zk: true, body: {} },
    );
    if (r.mode === "onchain" && r.reclaimBytes) {
      const { digest } = await sponsorExecute(r.reclaimBytes, { kind: "cheque-reclaim" });
      const c = await api<{ amountUsd?: number }>(`/api/cheques/${id}/reclaim`, { method: "POST", zk: true, body: { digest } });
      return { amountUsd: c.amountUsd ?? r.amountUsd };
    }
    return { amountUsd: r.amountUsd };
  },
};

/** Parse a cheque link — talise://c/<id>#<secret> or https://talise.io/c/<id>#<secret>. */
export function parseChequeLink(link: string): { id: string; secret: string } | null {
  const m = link.trim().match(/\/c\/([^#/?\s]+)#([^\s]+)$/);
  if (!m) return null;
  return { id: m[1], secret: m[2] };
}
