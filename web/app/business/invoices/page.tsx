"use client";

import { Eyebrow } from "@/components/app";
import { InvoicesTab } from "@/components/app/work/InvoicesTab";

/** /business/invoices — bill clients and get paid by link. */
export default function BusinessInvoicesPage() {
  return (
    <div className="space-y-6">
      <header>
        <Eyebrow>Invoices</Eyebrow>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-fg">
          Get paid for your work
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] text-fg-muted">
          Send a clean invoice anyone can pay with a tap — the money lands as
          USDsui in your account, instantly.
        </p>
      </header>
      <InvoicesTab />
    </div>
  );
}
