"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  CheckmarkCircle02Icon,
  Share08Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { GlassCard, MicroLabel, PrimaryButton, useToast } from "@/components/app";

/** Build the shareable invite URL for a code, using the live origin. */
function inviteUrl(code: string): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://talise.io";
  return `${origin}/r/${code}`;
}

/**
 * Referral card: the code in mono with a Copy action, a friend-count line,
 * and a "Share Talise" button that uses the Web Share API where available
 * and falls back to copying the invite link. Mirrors iOS `referralCard`.
 */
export function ReferralCard({
  code,
  referralCount,
}: {
  code: string;
  referralCount: number;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!code) return null;
  const url = inviteUrl(code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("Invite link copied", "success");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Couldn't copy — long-press the code to copy it", "danger");
    }
  }

  async function share() {
    const data = {
      title: "Talise",
      text: "Join me on Talise — send and save money across borders.",
      url,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {
        // User dismissed the share sheet, or it's unsupported — fall through
        // to copy so the action always does *something*.
      }
    }
    await copy();
  }

  return (
    <GlassCard className="space-y-4 p-6">
      <MicroLabel>Your referral code</MicroLabel>

      <button
        type="button"
        onClick={copy}
        className="talise-glass flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left transition-[border-color] hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
      >
        <span className="truncate font-mono text-[16px] tracking-wide text-fg">{code}</span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-accent">
          <HugeiconsIcon
            icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
            size={15}
            strokeWidth={1.8}
          />
          {copied ? "Copied" : "Copy"}
        </span>
      </button>

      {referralCount > 0 && (
        <div className="flex items-center gap-2 text-[13px] text-accent">
          <HugeiconsIcon icon={UserMultiple02Icon} size={15} strokeWidth={1.8} />
          <span>
            {referralCount} {referralCount === 1 ? "friend" : "friends"} joined with your code
          </span>
        </div>
      )}

      <PrimaryButton onClick={share} full>
        <HugeiconsIcon icon={Share08Icon} size={17} strokeWidth={1.9} />
        Share Talise
      </PrimaryButton>

      <p className="text-[12px] leading-snug text-fg-dim">
        Earn points when friends join and start sending with Talise.
      </p>
    </GlassCard>
  );
}
