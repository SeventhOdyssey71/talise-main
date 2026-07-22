import { api, ApiError } from "@/api/client";
import { sponsorExecute } from "@/auth/zklogin";

/** Rules — money that runs itself. On-chain standing-order pot. From ios RulesView/RuleEditView. */

export type Rule = {
  id: string;
  name: string;
  amountUsd: number;
  toAddress?: string;
  toHandle?: string | null;
  trigger?: string;
  intervalMinutes?: number | null;
  dayOfMonth?: number | null;
  status?: string;
  isActive?: boolean;
  state?: string;
  nextDueAt?: number | null;
};

export type RuleCadenceKind = "daily" | "weekly" | "monthly";

/** Cadence options — exact from ios RuleEditView. Monthly uses a day-of-month, others an interval. */
export const RULE_CADENCES: { label: string; kind: RuleCadenceKind; intervalMinutes?: number }[] = [
  { label: "Every day", kind: "daily", intervalMinutes: 1440 },
  { label: "Every week", kind: "weekly", intervalMinutes: 10080 },
  { label: "Monthly (a day)", kind: "monthly" },
];

export const rulesApi = {
  /** List + the server-side feature gate (`enabled: false` → show "coming soon"). */
  list: async (): Promise<{ rules: Rule[]; enabled: boolean }> => {
    const r = await api<{ rules?: Rule[]; enabled?: boolean }>("/api/rules");
    return { rules: r.rules ?? [], enabled: r.enabled ?? false };
  },

  /**
   * Prepare funding bytes for the rule's own pot, sign once to load it, then record
   * to activate. Payouts release automatically & gaslessly thereafter.
   */
  create: async (input: {
    name: string;
    toRecipient: string;
    amountUsd: number;
    prefundUsd: number;
    intervalMinutes?: number;
    dayOfMonth?: number;
  }): Promise<{ rule: Rule }> => {
    const prep = await api<{ bytes: string; firstDueMs: number; record: Record<string, unknown> }>("/api/rules", {
      method: "POST",
      zk: true,
      body: {
        name: input.name,
        trigger: "schedule",
        action: "send",
        intervalMinutes: input.intervalMinutes,
        dayOfMonth: input.dayOfMonth,
        toRecipient: input.toRecipient,
        amountUsd: input.amountUsd,
        prefundUsd: input.prefundUsd,
      },
    });
    const { digest } = await sponsorExecute(prep.bytes, { kind: "rule-create", amountUsd: input.prefundUsd });
    return api<{ rule: Rule }>("/api/rules/record", {
      method: "POST",
      zk: true,
      body: { digest, firstDueMs: prep.firstDueMs, ...prep.record },
    });
  },

  pause: (id: string): Promise<{ rule: Rule }> => api(`/api/rules/${id}/pause`, { method: "POST", zk: true, body: {} }),
  resume: (id: string): Promise<{ rule: Rule }> => api(`/api/rules/${id}/resume`, { method: "POST", zk: true, body: {} }),

  /** Sign the pot-refund bytes (409 = no on-chain order → skip), then clear the row. */
  cancel: async (id: string): Promise<void> => {
    try {
      const r = await api<{ bytes?: string }>(`/api/rules/${id}/cancel`, { method: "POST", zk: true, body: {} });
      if (r.bytes) await sponsorExecute(r.bytes, { kind: "rule-cancel" });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409) throw e;
    }
    await api(`/api/rules/${id}`, { method: "DELETE" });
  },
};
