import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import {
  getSuiBalance,
  getUsdsuiBalance,
  suiscanAccountUrl,
} from "@/lib/sui";
import { getSuiUsdcPrice } from "@/lib/deepbook";
import { CopyAddress } from "@/components/CopyAddress";
import { AppShell, NavIcons } from "@/components/AppShell";
import { NetworkBanner } from "@/components/NetworkBanner";
import { shortAddress } from "@/lib/format";
import { BusinessRevenueCard } from "@/components/BusinessRevenueCard";
import { PaymentLinkCard } from "@/components/PaymentLinkCard";
import { BusinessStatsRow } from "@/components/BusinessStatsRow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BusinessDashboard() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");

  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");
  if (user.account_type === "personal") redirect("/home");

  const [sui, usdsui, suiPrice] = await Promise.all([
    getSuiBalance(user.sui_address),
    getUsdsuiBalance(user.sui_address),
    getSuiUsdcPrice(),
  ]);

  const usdsuiRevenue = usdsui.usdsui;
  const suiUsd = sui.sui * (suiPrice || 0);
  const totalUsd = usdsuiRevenue + suiUsd;
  const handle = user.business_handle ?? "your-handle";

  const nav = [
    { href: "/business", label: "Dashboard", icon: NavIcons.home, active: true },
    { href: "/business/invoice", label: "Invoices", icon: NavIcons.invoice },
    { href: "/business/payroll", label: "Payroll", icon: NavIcons.payroll },
    { href: "/receive", label: "Receive", icon: NavIcons.receive },
    { href: "/earn", label: "Earn", icon: NavIcons.earn },
  ];

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext="business"
      hasBusinessContext={hasBusiness(user)}
      navItems={nav}
      pageEyebrow="Business"
      pageTitle={user.business_name ?? "Your business"}
      pageHeaderRight={
        <div className="flex flex-col items-end gap-1 text-[12px] text-[var(--color-fg-muted)]">
          <a
            href={`/p/${handle}`}
            target="_blank"
            className="font-mono underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
          >
            talise.io/p/{handle}
          </a>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#21A179]" />
            live
          </span>
        </div>
      }
    >
      <NetworkBanner />

      <div className="grid items-stretch gap-5 md:grid-cols-[1.6fr,1fr]">
            <BusinessRevenueCard
              usdsuiRevenue={usdsuiRevenue}
              totalUsd={totalUsd}
              suiPrice={suiPrice}
            />
            <PaymentLinkCard handle={handle} businessName={user.business_name ?? "Pay"} />
          </div>

          <BusinessStatsRow
            todayCount={0}
            customers={0}
            avgTicket={0}
          />

          <section className="mt-12">
            <SectionRow title="Where customers pay" />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-[var(--color-fg)]">
                  talise.io/p/{handle}
                </span>
                <span className="hidden text-[11px] text-[var(--color-fg-dim)] md:inline">
                  share this link to get paid
                </span>
              </div>
              <div className="flex items-center gap-3">
                <CopyAddress address={user.sui_address} />
                <a
                  href={suiscanAccountUrl(user.sui_address)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-[var(--color-fg-dim)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
                  title={user.sui_address}
                >
                  {shortAddress(user.sui_address, 4, 4)}
                </a>
              </div>
            </div>
          </section>

          <section className="mt-12">
            <SectionRow title="Recent payments" />
            <div className="mt-4 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)] p-12 text-center">
              <div className="mx-auto h-9 w-9 rounded-full border border-[var(--color-line)]" />
              <p className="mt-4 text-[13px] text-[var(--color-fg-muted)]">
                No customer payments yet.
              </p>
              <p className="mt-1 text-[12px] text-[var(--color-fg-dim)]">
                Share your payment link or QR. Every payment will show here
                with the customer&apos;s note and a receipt.
              </p>
            </div>
          </section>

          <section className="mt-12 grid gap-5 md:grid-cols-3">
            <FeatureTile
              tag="Invoices"
              title="Send an invoice"
              body="Generate a payment link with a fixed amount and reference. Customer pays in 3 taps; the invoice closes automatically."
              href="/business/invoice"
            />
            <FeatureTile
              tag="Subscriptions"
              title="Recurring billing"
              body="Set a cadence and amount once. Talise handles the rest. No card networks, no chargebacks, no 3% middleman."
            />
            <FeatureTile
              tag="Payroll"
              title="Pay contractors instantly"
              body="Pay a whole team in one click. Everyone gets paid in the same moment, with no delays."
              href="/business/payroll"
            />
          </section>

      <footer className="mt-16 border-t border-[var(--color-line)] pt-6 text-[11px] text-[var(--color-fg-dim)]">
        Your money. Always yours.
      </footer>
    </AppShell>
  );
}

function SectionRow({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        {title}
      </h2>
      {right}
    </div>
  );
}

function FeatureTile({
  tag,
  title,
  body,
  href,
}: {
  tag: string;
  title: string;
  body: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
        {tag}
      </div>
      <div className="mt-3 font-display text-[20px] leading-[1.15] tracking-[-0.02em] text-[var(--color-fg)]">
        {title}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
        {body}
      </p>
      <div className="mt-5 inline-flex items-center gap-2 text-[11px] uppercase tracking-wider">
        <span className={href ? "text-[var(--color-fg)]" : "text-[var(--color-fg-dim)]"}>
          {href ? "Open →" : "soon"}
        </span>
      </div>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="block h-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 transition hover:border-[var(--color-fg)]"
      >
        {inner}
      </a>
    );
  }
  return (
    <div className="h-full rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)] p-6">
      {inner}
    </div>
  );
}
