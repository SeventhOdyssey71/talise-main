import { api } from "@/api/client";
import { sponsorExecute } from "@/auth/zklogin";
import { signPersonalMessage } from "@/sui/sign";

/** Bank accounts — link NIBSS payout banks. Endpoints from ios BankAccountsView.swift. */

export type BankAccount = {
  id: string;
  bankCode: string;
  bankName: string;
  accountName: string;
  last4: string;
  attested: boolean;
};

export type BankLinkPrepare = {
  bytes?: string | null;
  attestMessage?: string | null;
  accountName: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  last4: string;
};

export const bankApi = {
  list: (): Promise<BankAccount[]> => api("/api/me/bank"),

  /** Resolve an account number to the holder name + an attestation to sign. */
  prepare: (bankCode: string, accountNumber: string): Promise<BankLinkPrepare> =>
    api("/api/me/bank/link/prepare", { method: "POST", zk: true, body: { bankCode, accountNumber } }),

  /** Sign the attestation (sponsor-ready bytes → sponsor-execute, else a personal message), then confirm. */
  confirm: async (p: BankLinkPrepare): Promise<BankAccount> => {
    let digest = "";
    if (p.bytes) digest = (await sponsorExecute(p.bytes, { kind: "bank-link" })).digest;
    else if (p.attestMessage) digest = await signPersonalMessage(p.attestMessage);
    return api("/api/me/bank/link/confirm", {
      method: "POST",
      zk: true,
      body: { bankCode: p.bankCode, accountNumber: p.accountNumber, accountName: p.accountName, digest },
    });
  },

  remove: (id: string): Promise<{ ok: boolean }> => api(`/api/me/bank/${id}`, { method: "DELETE" }),
};

export type NibssBank = { name: string; bankCode: string };

/** Hardcoded NIBSS banks + fintechs — verbatim from ios NIBSSBanks.all. */
export const NIBSS_BANKS: NibssBank[] = [
  { name: "Access Bank", bankCode: "044" },
  { name: "Guaranty Trust Bank", bankCode: "058" },
  { name: "First Bank of Nigeria", bankCode: "011" },
  { name: "Zenith Bank", bankCode: "057" },
  { name: "United Bank For Africa", bankCode: "033" },
  { name: "Wema Bank", bankCode: "035" },
  { name: "Sterling Bank", bankCode: "232" },
  { name: "Fidelity Bank", bankCode: "070" },
  { name: "First City Monument Bank", bankCode: "214" },
  { name: "Stanbic IBTC Bank", bankCode: "039" },
  { name: "Union Bank", bankCode: "032" },
  { name: "Polaris Bank", bankCode: "076" },
  { name: "Ecobank", bankCode: "050" },
  { name: "Keystone Bank", bankCode: "082" },
  { name: "Heritage Bank", bankCode: "030" },
  { name: "Unity Bank", bankCode: "215" },
  { name: "Providus Bank", bankCode: "101" },
  { name: "Kuda", bankCode: "090267" },
  { name: "OPay", bankCode: "100004" },
  { name: "PalmPay", bankCode: "100033" },
  { name: "Moniepoint", bankCode: "090405" },
];
