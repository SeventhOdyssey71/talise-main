import { redirect } from "next/navigation";
import { hasBusiness, userById } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { AppShell, navForAccount } from "@/components/AppShell";
import { ClaimForm } from "@/components/ClaimForm";
import { UsernameCard } from "@/components/UsernameCard";
import { formatHandle } from "@/lib/handle";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";

export const dynamic = "force-dynamic";

export default async function ClaimPage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  const subname = await findTaliseSubnameForOwner(user.sui_address);
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
        subname ? `You're ${formatHandle(subname.username)}.` : "Claim your handle."
      }
    >
      {subname ? (
        <div className="grid gap-8 md:grid-cols-[1.1fr,1fr]">
          <UsernameCard
            username={subname.username}
            address={user.sui_address}
            size="lg"
          />
          <div className="space-y-4">
            <p className="text-[14px] text-[var(--color-fg)]">
              People can send you money at{" "}
              <span className="font-mono text-[var(--color-fg)]">
                {formatHandle(subname.username)}
              </span>
              . The NFT lives in your wallet — you own it.
            </p>
            <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-[12px] text-[var(--color-fg-muted)]">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
                NFT object id
              </div>
              <div
                className="mt-1 font-mono text-[var(--color-fg)] break-all"
                title={subname.nftId}
              >
                {subname.nftId}
              </div>
            </div>
            <p className="text-[11px] text-[var(--color-fg-dim)]">
              Want another handle? Claim it — you can hold as many{" "}
              <span className="font-mono">*.talise.sui</span> names as you like.
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-8 max-w-xl text-[14px] text-[var(--color-fg-muted)]">
            Pick a handle and people can pay you at{" "}
            <span className="font-mono text-[var(--color-fg)]">name@talise</span>
            . The handle is a SuiNS NFT minted directly to your wallet — you
            own it on chain, not us.
          </p>
          <ClaimForm address={user.sui_address} />
        </>
      )}
    </AppShell>
  );
}
