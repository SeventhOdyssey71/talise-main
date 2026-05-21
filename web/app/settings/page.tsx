import { redirect } from "next/navigation";
import { AppShell, navForAccount } from "@/components/AppShell";
import { userById, userTxs, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import {
  suiscanAccountUrl,
  suiscanObjectUrl,
  network,
} from "@/lib/sui";
import { CopyAddress } from "@/components/CopyAddress";
import { SettingsForm } from "@/components/SettingsForm";
import { AddBusinessForm } from "@/components/AddBusinessForm";
import { shortAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  const txs = await userTxs(user.id, 100);
  const net = network();
  const isBusiness = user.account_type === "business";
  const businessReady = hasBusiness(user);

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext={isBusiness ? "business" : "personal"}
      hasBusinessContext={businessReady}
      navItems={navForAccount(user.account_type, "/settings")}
      pageEyebrow="Settings"
      pageTitle={isBusiness ? user.business_name ?? "Your business" : "Account"}
    >
      <p className="max-w-2xl text-[13px] leading-[1.6] text-[var(--color-fg-muted)] md:text-[14px]">
        Manage your profile, payment preferences, and the on-chain artifacts
        tied to this Google account. Everything settles on Sui {net}.
      </p>

      {/* In-page section nav */}
      <nav className="mt-6 flex flex-wrap gap-2 border-y border-[var(--color-line)] py-3 text-[11px] font-mono uppercase tracking-wider text-[var(--color-fg-muted)]">
        {!businessReady && <Anchor href="#add-business">+ Business</Anchor>}
        <Anchor href="#profile">Profile</Anchor>
        <Anchor href="#sui-address">Sui address</Anchor>
        {isBusiness && <Anchor href="#payment-handle">Handle</Anchor>}
        {user.spot_bm_id && <Anchor href="#deepbook-balancemanager">BM</Anchor>}
        <Anchor href="#activity">Activity</Anchor>
        <Anchor href="#security">Security</Anchor>
      </nav>

      <div className="mt-10 max-w-3xl space-y-12">
        {!businessReady && (
          <Section
            id="add-business"
            title="Add a business"
            sub="One Google account, two contexts. Same Sui address, separate merchant identity."
          >
            <AddBusinessForm />
          </Section>
        )}

        <Section
          id="profile"
          title="Profile"
          sub="Public name shown on receipts."
        >
          <SettingsForm
            initialName={user.name ?? ""}
            initialBusinessName={user.business_name ?? ""}
            initialIndustry={user.business_industry ?? ""}
            initialCountry={user.country ?? ""}
            initialNotify={Boolean(user.notify_on_receive)}
            isBusiness={isBusiness}
          />
        </Section>

        <Section
          id="sui-address"
          title="Sui address"
          sub="Your non-custodial wallet. Same address forever, derived from your Google account and a salt we hold for you."
        >
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-4">
            <span
              className="font-mono text-[14px] text-[var(--color-fg)]"
              title={user.sui_address}
            >
              {shortAddress(user.sui_address, 8, 6)}
            </span>
            <div className="flex items-center gap-4 text-[12px]">
              <CopyAddress address={user.sui_address} />
              <a
                href={suiscanAccountUrl(user.sui_address)}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
              >
                Suiscan ↗
              </a>
            </div>
          </div>
        </Section>

        {isBusiness && (
          <Section
            id="payment-handle"
            title="Payment handle"
            sub="Your customer-facing pay URL. Once chosen, your handle cannot be changed without contacting us."
          >
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-4">
              <span className="font-mono text-[14px] text-[var(--color-fg)]">
                talise.io/p/{user.business_handle}
              </span>
              <div className="flex items-center gap-4 text-[12px]">
                <CopyAddress
                  address={`https://talise.io/p/${user.business_handle}`}
                />
                <a
                  href={`/p/${user.business_handle}`}
                  target="_blank"
                  className="text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
                >
                  Preview ↗
                </a>
              </div>
            </div>
          </Section>
        )}

        {user.spot_bm_id && (
          <Section
            id="deepbook-balancemanager"
            title="DeepBook BalanceManager"
            sub="On-chain object holding your supplied USDsui. Only you can withdraw."
          >
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-4">
              <span
                className="font-mono text-[14px] text-[var(--color-fg)]"
                title={user.spot_bm_id}
              >
                {shortAddress(user.spot_bm_id, 8, 6)}
              </span>
              <a
                href={suiscanObjectUrl(user.spot_bm_id)}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
              >
                Suiscan ↗
              </a>
            </div>
          </Section>
        )}

        <Section
          id="activity"
          title="Activity"
          sub={`${txs.length} transaction${txs.length === 1 ? "" : "s"} on record.`}
        >
          {txs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)] p-8 text-center text-[12px] text-[var(--color-fg-dim)]">
              Your sends and receives will show here.
            </div>
          ) : (
            <ul className="space-y-2">
              {txs.slice(0, 6).map((tx) => (
                <li
                  key={tx.id}
                  className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[13px]"
                >
                  <div>
                    <div className="text-[var(--color-fg)]">
                      {labelFor(tx.kind)} {tx.amount} {tx.asset}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--color-fg-dim)]">
                      {tx.recipient
                        ? `to ${tx.recipient.slice(0, 10)}…${tx.recipient.slice(-6)}`
                        : tx.memo}
                    </div>
                  </div>
                  <a
                    href={`https://suiscan.xyz/${net}/tx/${tx.digest}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
                  >
                    tx ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          id="security"
          title="Security"
          sub="Your private signing material lives in this browser session only. Sign out clears it."
        >
          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <div className="text-[13px] text-[var(--color-fg)]">
              Sign out of this device
            </div>
            <div className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
              Your Sui address survives. Sign in with the same Google account
              to get back in.
            </div>
            <form action="/auth/logout" method="POST" className="mt-4">
              <button
                type="submit"
                className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-[13px] text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}

function Section({
  id,
  title,
  sub,
  children,
}: {
  id: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
        {title}
      </div>
      {sub && (
        <p className="mt-1 max-w-2xl text-[13px] text-[var(--color-fg-muted)]">
          {sub}
        </p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Anchor({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1 transition hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
    >
      {children}
    </a>
  );
}

function labelFor(kind: string): string {
  if (kind === "send-cross-asset") return "Swapped & sent";
  if (kind === "pay-merchant") return "Paid";
  if (kind === "pay-invoice") return "Paid invoice";
  if (kind === "earn-supply") return "Supplied";
  if (kind === "spot-lp-deposit") return "Deposited to Spot";
  if (kind === "send-and-invest") return "Sent + invested";
  if (kind === "payroll") return "Payroll";
  return "Sent";
}
