import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { getSuiBalance, getUsdsuiBalance, network } from "@/lib/sui";
import { PayrollForm } from "@/components/PayrollForm";
import { AppShell, navForAccount } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");
  if (user.account_type !== "business") redirect("/home");

  const [sui, usdsui] = await Promise.all([
    getSuiBalance(user.sui_address),
    getUsdsuiBalance(user.sui_address),
  ]);

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext="business"
      hasBusinessContext={hasBusiness(user)}
      navItems={navForAccount(user.account_type, "/business/payroll")}
      pageEyebrow={`Payroll · ${network()}`}
      pageTitle="Pay contractors instantly"
    >
      <p className="max-w-2xl text-[14px] text-[var(--color-fg-muted)]">
        One signed transaction, N recipients, USDsui settlement in under a
        second. Everyone gets paid in the same block, or no one does. Sub-cent
        fee per recipient.
      </p>

      <div className="mt-10">
        <PayrollForm
          senderAddress={user.sui_address}
          availableUsdsui={usdsui.usdsui}
          availableSui={sui.sui}
        />
      </div>

      <p className="mt-12 max-w-md text-[11px] leading-relaxed text-[var(--color-fg-dim)]">
        Atomic settlement: if any recipient address fails validation on-chain,
        the entire transaction reverts. No partial payouts.
      </p>
    </AppShell>
  );
}
