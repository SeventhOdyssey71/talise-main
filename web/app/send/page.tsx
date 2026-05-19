import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { getUsdsuiBalance, network } from "@/lib/sui";
import { SendForm } from "@/components/SendForm";
import { AppShell, navForAccount } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function SendPage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");

  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  const usdsui = await getUsdsuiBalance(user.sui_address);

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext={user.account_type === "business" ? "business" : "personal"}
      hasBusinessContext={hasBusiness(user)}
      navItems={navForAccount(user.account_type, "/send")}
      pageEyebrow={`Send · ${network()}`}
      pageTitle="Send money"
    >
      <p className="max-w-2xl text-[14px] text-[var(--color-fg-muted)]">
        Pick the currency you think in. We settle in dollars, gas is on us.
      </p>

      <div className="mt-8 max-w-xl">
        <SendForm
          senderAddress={user.sui_address}
          availableUsdsui={usdsui.usdsui}
        />
      </div>
    </AppShell>
  );
}
