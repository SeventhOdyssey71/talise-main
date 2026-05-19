import { redirect } from "next/navigation";
import { hasBusiness, userById } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { AppShell, navForAccount } from "@/components/AppShell";
import { ClaimForm } from "@/components/ClaimForm";
import { UsernameCard } from "@/components/UsernameCard";
import { formatHandle } from "@/lib/handle";

export const dynamic = "force-dynamic";

export default async function ClaimPage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  const navContext = user.account_type === "business" ? "business" : "personal";

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext={navContext}
      hasBusinessContext={hasBusiness(user)}
      navItems={navForAccount(user.account_type, "/claim")}
      pageEyebrow="Talise username"
      pageTitle={
        user.talise_username
          ? `You're ${formatHandle(user.talise_username)}.`
          : "Claim your handle."
      }
    >
      {user.talise_username ? (
        <div className="grid gap-8 md:grid-cols-[1.1fr,1fr]">
          <UsernameCard
            username={user.talise_username}
            address={user.sui_address}
            size="lg"
          />
          <div className="space-y-4">
            <p className="text-[14px] text-[var(--color-fg)]">
              People can send you money at{" "}
              <span className="font-mono text-[var(--color-fg)]">
                {formatHandle(user.talise_username)}
              </span>
              . No more 64-character addresses.
            </p>
            <p className="text-[12px] text-[var(--color-fg-muted)]">
              Renames aren&apos;t supported yet. Your handle is locked in.
            </p>
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2 text-[12px] text-[var(--color-fg-dim)] opacity-60"
            >
              Edit (coming soon)
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-8 max-w-xl text-[14px] text-[var(--color-fg-muted)]">
            Pick a handle and people can pay you at{" "}
            <span className="font-mono text-[var(--color-fg)]">name@talise</span>
            . Marketing-readable, short, yours.
          </p>
          <ClaimForm address={user.sui_address} />
        </>
      )}
    </AppShell>
  );
}
