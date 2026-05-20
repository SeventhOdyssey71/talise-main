import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { suiscanAccountUrl } from "@/lib/sui";
import { ReceiveCard } from "@/components/ReceiveCard";
import { UsernameCard } from "@/components/UsernameCard";
import { CopyAddress } from "@/components/CopyAddress";
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

          <div className="mt-8 grid gap-5 md:grid-cols-[1.4fr,1fr]">
            <UsernameCard
              username={handle}
              address={user.sui_address}
              size="lg"
            />
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
                  Your handle
                </div>
                <div className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 font-mono text-[14px] text-[var(--color-fg)]">
                  {formatHandle(handle)}
                </div>
                <div className="mt-3">
                  <CopyAddress address={formatHandle(handle)} />
                </div>
              </div>

              <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
                  Payment link
                </div>
                <div className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 font-mono text-[13px] text-[var(--color-fg)] break-all">
                  talise.io/p/{handle}
                </div>
                <a
                  href={`/p/${handle}`}
                  className="mt-3 inline-block rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-fg-muted)] transition hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
                >
                  Open link ↗
                </a>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <ReceiveCard
              address={user.sui_address}
              suiscanUrl={suiscanAccountUrl(user.sui_address)}
              displayName={
                user.business_name ?? user.name ?? "Talise wallet"
              }
              handle={user.business_handle ?? null}
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

          <div className="mt-8">
            <ReceiveCard
              address={user.sui_address}
              suiscanUrl={suiscanAccountUrl(user.sui_address)}
              displayName={
                user.business_name ?? user.name ?? "Talise wallet"
              }
              handle={user.business_handle ?? null}
            />
          </div>
        </>
      )}
    </AppShell>
  );
}
