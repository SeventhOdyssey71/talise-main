import { api, ApiError } from "@/api/client";

/**
 * Cross-border rail — server-authoritative. DTOs + endpoints verbatim from ios
 * Network/CrossBorderAPI.swift. The client does NO FX math and never signs a PTB;
 * the server runs the on-chain settle + fiat-out.
 */

export type CorridorEntry = {
  id: string;
  fromCountry: string;
  fromCcy: string;
  toCountry: string;
  toCcy: string;
  status: "live" | "partner" | "planned" | string;
  spreadBps: number;
  perTxCapUsd?: number | null;
};

export type CrossBorderQuote = {
  transferId: string;
  corridor: { id: string; fromCcy: string; toCcy: string; status: string; spreadBps: number; perTxCapUsd?: number | null };
  quote: { rate: number; spreadBps: number; toAmount: number; expiresAt: number };
  amountUsd: number;
  tier: number;
  recipientGets: { amount: number; currency: string };
};

export type CrossBorderConfirm = { state: string; transferId: string };

export function isBookable(status: string): boolean {
  return status === "live" || status === "partner";
}

/** Committed states → success; "settled" → payout landed. */
export function isCommitted(state: string): boolean {
  return ["onchain_settling", "onchain_settled", "fiat_out_pending", "settled"].includes(state);
}

/** Maps a 4xx code to the exact iOS failure copy. */
export function crossBorderErrorCopy(code: string | null, fallback: string): { headline: string; message: string; retry: boolean } {
  switch (code) {
    case "UNKNOWN_CORRIDOR":
      return { headline: "Route not open", message: "We don't have a route to that country yet.", retry: false };
    case "NOT_BOOKABLE":
      return { headline: "Route not open", message: "This corridor isn't open yet — we're onboarding the local payout partner.", retry: false };
    case "OVER_CAP":
      return { headline: "Over the transfer cap", message: "That's over the single-transfer cap for this corridor. Try a smaller amount.", retry: true };
    case "TIER_BLOCKED":
      return { headline: "Verify your identity", message: "Cross-border sends need a verified account. Finish identity verification to unlock.", retry: false };
    case "LIMIT_EXCEEDED":
      return { headline: "Over your limit", message: "This would put you over your transfer limit. Upgrade your tier or send less.", retry: false };
    case "FX":
      return { headline: "Transfer didn't go through", message: "Couldn't lock an exchange rate right now. Try again in a moment.", retry: true };
    case "BAD_INPUT":
      return { headline: "Transfer didn't go through", message: "Something about that transfer didn't check out. Double-check the amount and try again.", retry: true };
    default:
      return { headline: "Transfer didn't go through", message: fallback, retry: true };
  }
}

export const crossBorderApi = {
  corridors: async (): Promise<CorridorEntry[]> => {
    const r = await api<{ corridors?: CorridorEntry[] }>("/api/corridors");
    return r.corridors ?? [];
  },

  quote: (fromCountry: string, toCountry: string, amount: number): Promise<CrossBorderQuote> =>
    api<CrossBorderQuote>("/api/transfers/cross-border/quote", {
      method: "POST",
      zk: true,
      body: { fromCountry, toCountry, amount },
    }),

  confirm: (transferId: string): Promise<CrossBorderConfirm> =>
    api<CrossBorderConfirm>("/api/transfers/cross-border/confirm", {
      method: "POST",
      zk: true,
      body: { transferId },
    }),
};

export { ApiError };

/** Static catalogue — origins + destinations with ISO ccy + flag code. */
export const ORIGINS: { code: string; name: string; ccy: string; flag: string }[] = [
  { code: "US", name: "United States", ccy: "USD", flag: "us" },
  { code: "JP", name: "Japan", ccy: "JPY", flag: "jp" },
  { code: "SG", name: "Singapore", ccy: "SGD", flag: "sg" },
];

export const DESTINATIONS: { code: string; name: string; ccy: string; flag: string }[] = [
  { code: "NG", name: "Nigeria", ccy: "NGN", flag: "ng" },
  { code: "KE", name: "Kenya", ccy: "KES", flag: "ke" },
  { code: "GH", name: "Ghana", ccy: "GHS", flag: "gh" },
  { code: "ZA", name: "South Africa", ccy: "ZAR", flag: "za" },
  { code: "JP", name: "Japan", ccy: "JPY", flag: "jp" },
  { code: "PH", name: "Philippines", ccy: "PHP", flag: "ph" },
  { code: "ID", name: "Indonesia", ccy: "IDR", flag: "id" },
  { code: "VN", name: "Vietnam", ccy: "VND", flag: "vn" },
  { code: "US", name: "United States", ccy: "USD", flag: "us" },
];

const ZERO_DECIMAL = new Set(["JPY", "VND", "IDR", "KRW", "NGN", "KES"]);
const SYMBOLS: Record<string, string> = { USD: "$", NGN: "₦", KES: "KSh", GHS: "₵", ZAR: "R", JPY: "¥", PHP: "₱", IDR: "Rp", VND: "₫", SGD: "S$", EUR: "€", GBP: "£" };

/** Payout formatting — 0 or 2 decimals by currency, with the ISO symbol. */
export function payout(amount: number, ccy: string): string {
  const digits = ZERO_DECIMAL.has(ccy) ? 0 : 2;
  return `${SYMBOLS[ccy] ?? ""}${amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
