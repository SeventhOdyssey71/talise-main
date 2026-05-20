import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { suiscanAccountUrl } from "@/lib/sui";
import { ReceiveQR, ReceiveShare } from "@/components/ReceiveCard";
import { UsernameCard } from "@/components/UsernameCard";
import { AppShell, navForAccount } from "@/components/AppShell";
import { PageIntro } from "@/components/PageIntro";
import { formatHandle } from "@/lib/handle";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";

export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  const subname = await findTaliseSubnameForOwner(user.sui_address);
  const handle = subname?.username ?? null;

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext={user.account_type === "business" ? "business" : "personal"}
      hasBusinessContext={hasBusiness(user)}
      navItems={navForAccount(user.account_type, "/receive")}
      pageEyebrow="Receive"
      pageTitle="Get paid in seconds"
    >
      {handle ? (
        <>
          <PageIntro>
            Share your handle. Senders just type{" "}
            <span className="font-mono text-[var(--color-fg)]">
              {formatHandle(handle)}
            </span>
            . No long addresses, no copy-paste mistakes.
          </PageIntro>

          {/* Hero row: UsernameCard (for screenshots/sharing the handle)
              + QR (for in-person scans) side-by-side. Stacks on mobile. */}
          <div className="mt-8 grid items-stretch gap-5 md:grid-cols-2">
            <UsernameCard
              username={handle}
              address={user.sui_address}
              size="lg"
            />
            <ReceiveQR
              address={user.sui_address}
              displayName={
                user.business_name ?? user.name ?? "Talise wallet"
              }
              handle={handle}
            />
          </div>

          <div className="mt-5">
            <ReceiveShare
              address={user.sui_address}
              suiscanUrl={suiscanAccountUrl(user.sui_address)}
              handle={handle}
            />
          </div>
        </>
      ) : (
        <>
          <PageIntro>
            Share your address or QR code. Sender pays in USDsui, SUI, or any
            asset they hold; settlement is sub-second, fees are sub-cent.
          </PageIntro>

          <a
            href="/claim"
            className="mt-6 flex max-w-xl items-center justify-between rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-4 transition hover:border-[var(--color-fg)]"
          >
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
                Skip the long address
              </div>
              <div className="mt-1 text-[13px] text-[var(--color-fg)]">
                Claim a <span className="font-mono">name@talise</span> handle.
              </div>
            </div>
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              claim →
            </span>
          </a>

          <div className="mt-8 grid items-stretch gap-5 md:grid-cols-2">
            <ReceiveQR
              address={user.sui_address}
              displayName={
                user.business_name ?? user.name ?? "Talise wallet"
              }
              handle={user.business_handle ?? null}
            />
            <ReceiveShare
              address={user.sui_address}
              suiscanUrl={suiscanAccountUrl(user.sui_address)}
              handle={user.business_handle ?? null}
            />
          </div>
        </>
      )}
    </AppShell>
  );
}
