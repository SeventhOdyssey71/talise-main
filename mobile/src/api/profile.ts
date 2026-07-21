import { api } from "@/api/client";
import type { UserDTO } from "@/auth/zklogin";

/** Profile/settings API — /api/me, Bridge KYC status, account deletion. */

export type MeDTO = UserDTO & {
  taliseHandle?: string | null;
  taliseSubname?: string | null;
  businessName?: string | null;
  features?: { cashout?: boolean; scanToPay?: boolean } | null;
};

export type KycStatus = "unverified" | "pending" | "approved" | "rejected" | "expired";
export type BridgeKycStatus = {
  started: boolean;
  status: KycStatus;
  kycStatus?: string | null;
  tosStatus?: string | null;
  kycUrl?: string | null;
  tosUrl?: string | null;
};

/** KYCStatus → display label. */
export function kycLabel(s: KycStatus): string {
  switch (s) {
    case "approved": return "Verified";
    case "pending": return "In review";
    case "rejected": return "Not approved";
    case "expired": return "Expired";
    default: return "Not verified";
  }
}

export const profileApi = {
  me: () => api<MeDTO>("/api/me"),
  kycStatus: () => api<BridgeKycStatus>("/api/kyc/bridge/status"),
  kycStart: (email?: string) =>
    api<{ status: string; kycUrl?: string; tosUrl?: string }>("/api/kyc/bridge/start", { method: "POST", body: { email } }),
  deleteAccount: () => api<{ ok: boolean }>("/api/account/delete", { method: "POST", body: {} }),
};
