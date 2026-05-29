import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { PayLookup } from "@/components/PayLookup";
import { AppShell, navForAccount } from "@/components/AppShell";
import { PageIntro } from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default async function PayLanding() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext={user.account_type === "business" ? "business" : "personal"}
      hasBusinessContext={hasBusiness(user)}
      navItems={navForAccount(user.account_type, "/pay")}
      pageEyebrow="Pay"
      pageTitle="Pay a merchant"
    >
      <PageIntro>
        Type the handle or paste a payment link. We resolve it on-chain and
        take you to the payment page.
      </PageIntro>

      <div className="mt-8 max-w-md">
        <PayLookup />
      </div>
    </AppShell>
  );
}
