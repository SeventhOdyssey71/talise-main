import { api } from "@/api/client";

/** Requests — mint a link to ask for a set amount. From ios RequestsListView/RequestCreateView. */

export type RequestStatus = "open" | "paid" | "cancelled" | "expired" | string;

export type MoneyRequest = {
  id: string;
  amountUsd: number;
  currency: string;
  requesterNote?: string | null;
  status: RequestStatus;
  expiresAt?: number | null;
  createdAt?: number | null;
  paidAt?: number | null;
  payDigest?: string | null;
};

export const requestsApi = {
  list: async (): Promise<MoneyRequest[]> => {
    const r = await api<{ requests?: MoneyRequest[] }>("/api/requests");
    return r.requests ?? [];
  },

  create: (input: { amountUsd: number; note?: string }): Promise<{ request: MoneyRequest; payUrl: string }> =>
    api("/api/requests", { method: "POST", body: { amountUsd: input.amountUsd, currency: "USD", note: input.note } }),

  cancel: (id: string): Promise<{ status?: string }> => api(`/api/requests/${id}`, { method: "DELETE" }),
};

/** Public pay link — server returns the authoritative payUrl; this is the fallback shape. */
export function requestPayUrl(id: string): string {
  return `https://www.talise.io/req/${id}`;
}
