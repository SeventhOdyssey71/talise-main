import { redirect } from "next/navigation";
import { invoicesFor, userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { network } from "@/lib/sui";
import { InvoiceForm } from "@/components/InvoiceForm";
import { InvoiceList } from "@/components/InvoiceList";
import { AppShell, navForAccount } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function InvoicePage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");
  if (user.account_type !== "business") redirect("/home");

  const invoices = await invoicesFor(user.id);
  const handle = user.business_handle ?? "";

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext="business"
      hasBusinessContext={hasBusiness(user)}
      navItems={navForAccount(user.account_type, "/business/invoice")}
      pageEyebrow={`Invoices · ${network()}`}
      pageTitle="Send a USDsui invoice"
    >
      <p className="max-w-2xl text-[14px] text-[var(--color-fg-muted)]">
        Fixed-amount payment link with a memo and reference. Customer pays in
        three taps; you get an on-chain receipt instantly. No card fees, no
        chargebacks, no middleman.
      </p>

      <div className="mt-10 grid gap-10 md:grid-cols-[1.1fr,1.6fr]">
        <InvoiceForm handle={handle} />
        <InvoiceList invoices={invoices} handle={handle} />
      </div>
    </AppShell>
  );
}
