"use client";

import { Eyebrow } from "@/components/app";
import { ContractsTab } from "@/components/app/work/ContractsTab";

/** /business/team — pay contractors + employees with streamed USDsui. */
export default function BusinessTeamPage() {
  return (
    <div className="space-y-6">
      <header>
        <Eyebrow>Team</Eyebrow>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-fg">
          Pay your whole team
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] text-fg-muted">
          Set up recurring pay for contractors and employees — funded once,
          released automatically, every second.
        </p>
      </header>
      <ContractsTab />
    </div>
  );
}
