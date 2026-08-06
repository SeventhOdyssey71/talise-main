"use client";

/**
 * BeneficiaryPicker — saved cash-out destinations, above the bank form.
 *
 * The cash-out form asked for a bank and ten digits every single time, then
 * waited on a name enquiry, for an account most people pay repeatedly. This
 * puts what they've already paid at the top: one tap fills the form and the
 * name is already verified, so "Continue" is live immediately.
 *
 * Deliberately NOT a modal or a separate screen. A picker that hides the
 * manual fields makes a first-time payout feel blocked behind a list that is
 * empty for everyone at first; the fields stay visible underneath, and saved
 * targets are a shortcut past them rather than a gate in front of them.
 */

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { api, ApiError, Field, PrimaryButton, useToast } from "@/components/app";
import { BankSelect } from "@/components/app/ui/BankSelect";
import { LINQ_BANKS } from "@/lib/linq-banks";

export type Beneficiary = {
  id: string;
  bankCode: string;
  bankName: string;
  accountName: string | null;
  last4: string;
  kind: "self" | "beneficiary";
  label: string | null;
  lastUsedAt: number | null;
};

/** Initials for the avatar chip, from the verified account name. */
function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function BeneficiaryPicker({
  selectedId,
  onPick,
  disabled,
}: {
  selectedId: string | null;
  /** Fires with the full details the form needs, or null when cleared. */
  onPick: (
    b: { id: string; bankCode: string; accountName: string | null } | null
  ) => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [list, setList] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Add-form state.
  const [bankCode, setBankCode] = useState("");
  const [account, setAccount] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ beneficiaries: Beneficiary[] }>(
        "/api/me/beneficiaries"
      );
      setList(r.beneficiaries ?? []);
    } catch {
      // A picker that can't load is a missing shortcut, not a broken page —
      // the manual fields below still work.
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setAddErr(null);
    setSaving(true);
    try {
      const r = await api<{ beneficiary: Beneficiary }>("/api/me/beneficiaries", {
        method: "POST",
        body: { bankCode, accountNumber: account, label: label || undefined },
      });
      setList((cur) => [r.beneficiary, ...cur.filter((b) => b.id !== r.beneficiary.id)]);
      onPick({
        id: r.beneficiary.id,
        bankCode: r.beneficiary.bankCode,
        accountName: r.beneficiary.accountName,
      });
      setAdding(false);
      setBankCode("");
      setAccount("");
      setLabel("");
      toast("Beneficiary saved", "success");
    } catch (e) {
      setAddErr(
        e instanceof ApiError ? e.message : "Couldn't save that beneficiary."
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(b: Beneficiary) {
    // Own linked accounts aren't removable here — the server refuses too.
    if (b.kind !== "beneficiary") return;
    const before = list;
    setList((cur) => cur.filter((x) => x.id !== b.id));
    if (selectedId === b.id) onPick(null);
    try {
      await api(`/api/me/beneficiaries/${b.id}`, { method: "DELETE" });
    } catch {
      setList(before); // put it back, nothing was actually removed
      toast("Couldn't remove that one", "danger");
    }
  }

  if (loading) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#3d7a29]">
          {list.length > 0 ? "Send to" : "Beneficiary"}
        </span>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={disabled}
            className="flex items-center gap-1 rounded-full border border-[#15300c]/12 bg-white/70 px-3 py-1.5 text-[12px] font-medium text-[#15300c] transition-colors hover:bg-[#CAFFB8] disabled:opacity-50"
          >
            <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2.2} />
            Add beneficiary
          </button>
        )}
      </div>

      {list.length > 0 && (
        <div className="space-y-1.5">
          {list.map((b) => {
            const active = selectedId === b.id;
            return (
              <div
                key={b.id}
                className={`group flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${
                  active
                    ? "border-[#3d7a29] bg-[#CAFFB8]"
                    : "border-[#15300c]/10 bg-white/60 hover:border-[#15300c]/20"
                }`}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onPick(
                      active
                        ? null
                        : { id: b.id, bankCode: b.bankCode, accountName: b.accountName }
                    )
                  }
                  className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                      active ? "bg-[#15300c] text-[#CAFFB8]" : "bg-[#15300c]/8 text-[#15300c]"
                    }`}
                  >
                    {initials(b.accountName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-medium text-[#15300c]">
                        {b.label || b.accountName || "Saved account"}
                      </span>
                      {b.kind === "self" && (
                        <span className="shrink-0 rounded-full bg-[#15300c]/8 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-[#3a5230]">
                          You
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[12px] tabular-nums text-[#3a5230]">
                      {b.bankName} · ••••{b.last4}
                    </span>
                  </span>
                  {active && (
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon}
                      size={17}
                      strokeWidth={2}
                      color="#15300c"
                    />
                  )}
                </button>
                {b.kind === "beneficiary" && (
                  <button
                    type="button"
                    aria-label={`Remove ${b.accountName ?? "beneficiary"}`}
                    onClick={() => void remove(b)}
                    disabled={disabled}
                    className="shrink-0 rounded-full p-1.5 text-[#3a5230] opacity-0 transition-opacity hover:text-[#c0532f] focus:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={15} strokeWidth={1.8} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {list.length === 0 && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={disabled}
          className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-[#15300c]/20 bg-white/40 px-3 py-3 text-left transition-colors hover:border-[#3d7a29] hover:bg-[#f0f8ea] disabled:opacity-50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#15300c]/8">
            <HugeiconsIcon icon={UserIcon} size={16} strokeWidth={1.8} color="#15300c" />
          </span>
          <span>
            <span className="block text-[14px] font-medium text-[#15300c]">
              Add a beneficiary
            </span>
            <span className="block text-[12px] text-[#3a5230]">
              Save a bank account once, pay it in one tap after that.
            </span>
          </span>
        </button>
      )}

      {adding && (
        <div className="space-y-4 rounded-2xl border border-[#15300c]/10 bg-white/60 p-4">
          <Field label="Bank">
            <BankSelect banks={LINQ_BANKS} value={bankCode} onChange={setBankCode} />
          </Field>
          <Field label="Account number">
            <input
              inputMode="numeric"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value.replace(/[^\d]/g, "").slice(0, 10));
                setAddErr(null);
              }}
              placeholder="0123456789"
              className="w-full rounded-xl border border-[#15300c]/15 bg-white/70 px-4 py-3 text-[16px] tracking-wide text-[#15300c] placeholder:text-[#3d7a29] outline-none focus:border-[#3d7a29] focus:ring-1 focus:ring-[#3d7a29]"
            />
          </Field>
          <Field label="Nickname" hint="Optional. Shown next to the verified name.">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 40))}
              placeholder="Mum"
              className="w-full rounded-xl border border-[#15300c]/15 bg-white/70 px-4 py-3 text-[16px] text-[#15300c] placeholder:text-[#3d7a29] outline-none focus:border-[#3d7a29] focus:ring-1 focus:ring-[#3d7a29]"
            />
          </Field>
          {addErr && <p className="text-[13px] text-[#c0532f]">{addErr}</p>}
          <div className="flex gap-2">
            <PrimaryButton
              full
              onClick={() => void save()}
              disabled={!bankCode || !/^\d{10}$/.test(account) || saving}
              loading={saving}
            >
              {saving ? "Checking account…" : "Save beneficiary"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setAddErr(null);
              }}
              className="shrink-0 rounded-full px-4 text-[13px] font-medium text-[#3a5230] hover:text-[#15300c]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
