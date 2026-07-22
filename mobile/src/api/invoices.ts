import { api } from "@/api/client";
import { signAndSubmitSend } from "@/auth/zklogin";

/** Invoices — get paid in USDsui. Endpoints + DTOs verbatim from ios InvoicesView.swift. */

export type InvoiceStatus = "open" | "paid" | "void" | string;

export type Invoice = {
  id: string;
  amountUsd: number;
  currency: string;
  customerName?: string | null;
  memo?: string | null;
  status: InvoiceStatus;
  dueMs?: number | null;
  createdAt: number;
  payDigest?: string | null;
};

export type InvoiceDetail = {
  id: string;
  amountUsd: number;
  currency: string;
  customerName?: string | null;
  memo?: string | null;
  status: InvoiceStatus;
  dueMs?: number | null;
  createdAt: number;
  issuer: { handle: string; address: string; name?: string | null };
};

export const invoicesApi = {
  list: async (): Promise<Invoice[]> => {
    const r = await api<{ invoices?: Invoice[] }>("/api/invoices");
    return r.invoices ?? [];
  },

  create: (input: { amountUsd: number; customerName?: string; memo?: string }): Promise<{ invoice: Invoice; payUrl?: string }> =>
    api("/api/invoices", { method: "POST", body: input }),

  detail: (id: string): Promise<{ invoice: InvoiceDetail; owner: boolean }> => api(`/api/invoices/${id}`),

  /** Pay = gasless USDsui send to the issuer address, then settle with the digest. */
  pay: async (id: string, issuerAddress: string, amountUsd: number): Promise<{ status: string }> => {
    const { digest } = await signAndSubmitSend(issuerAddress, amountUsd);
    return api(`/api/invoices/${id}/settle`, { method: "POST", zk: true, body: { digest } });
  },
};
