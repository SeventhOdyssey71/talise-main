"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Invoice01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Eyebrow } from "@/components/app";
import { InvoicesTab } from "@/components/app/work/InvoicesTab";
import { ContractsTab } from "@/components/app/work/ContractsTab";

type Tab = "invoices" | "contracts";

/**
 * /app/work — the Work hub: get paid for work (Invoices) and pay your team
 * (Contracts, recurring streamed pay). Two tabs over a shared header.
 */
export default function WorkPage() {
  const [tab, setTab] = useState<Tab>("invoices");

  return (
    <div className="space-y-6">
      <header>
        <Eyebrow>Work</Eyebrow>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-fg">
          Get paid. Pay your team.
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] text-fg-muted">
          Send a clean invoice that anyone can pay with a tap, or set up recurring
          pay for contractors and employees — funded once, released automatically.
        </p>
      </header>

      {/* Tab switch */}
      <div
        className="talise-glass inline-flex gap-1 rounded-full p-1"
        role="tablist"
        aria-label="Work sections"
      >
        <TabButton
          active={tab === "invoices"}
          onClick={() => setTab("invoices")}
          icon={<HugeiconsIcon icon={Invoice01Icon} size={16} strokeWidth={1.8} />}
          label="Invoices"
        />
        <TabButton
          active={tab === "contracts"}
          onClick={() => setTab("contracts")}
          icon={<HugeiconsIcon icon={UserGroupIcon} size={16} strokeWidth={1.8} />}
          label="Contracts"
        />
      </div>

      {tab === "invoices" ? <InvoicesTab /> : <ContractsTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${
        active ? "bg-accent-deep text-white" : "text-fg-muted hover:text-fg"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
