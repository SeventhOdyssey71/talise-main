import { notFound } from "next/navigation";
import { userByBusinessHandle, userById } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { suiscanAccountUrl, network } from "@/lib/sui";
import { PayMerchantForm } from "@/components/PayMerchantForm";
import { SignInButton } from "@/components/SignInButton";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ amount?: string; memo?: string; invoice?: string }>;
}) {
  const { handle } = await params;
  const { amount, memo, invoice } = await searchParams;
  const merchant = await userByBusinessHandle(handle);
  if (!merchant || merchant.account_type !== "business") notFound();

  const sessionId = await readSessionEntryId();
  const me = sessionId ? await userById(sessionId) : null;
  const signedIn = !!me;
  const isSelf = me?.id === merchant.id;
  const presetAmount = amount && /^\d+(\.\d+)?$/.test(amount) ? amount : "";

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl">
        <header className="border-b border-[var(--color-line)]">
          <div className="flex items-center justify-between px-6 py-4 md:px-10">
            <Logo size={26} href="/" />
            <div className="text-[12px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
              Pay merchant · {network()}
            </div>
          </div>
        </header>

        <main className="px-6 pt-12 pb-24 md:px-10">
          <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
            Pay
          </div>
          <h1 className="mt-2 font-display text-[44px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
            {merchant.business_name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
            <span className="font-mono">talise.io/p/{merchant.business_handle}</span>
            <span className="text-[var(--color-fg-dim)]">·</span>
            <a
              href={suiscanAccountUrl(merchant.sui_address)}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
            >
              Verify on Suiscan ↗
            </a>
            <span className="text-[var(--color-fg-dim)]">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#21A179]" />
              accepts USDsui + SUI
            </span>
          </div>

          <div className="mt-10">
            {isSelf ? (
              <SelfPayNotice handle={merchant.business_handle ?? ""} />
            ) : signedIn ? (
              <PayMerchantForm
                senderAddress={me!.sui_address}
                recipientAddress={merchant.sui_address}
                merchantName={merchant.business_name ?? ""}
                presetAmount={presetAmount}
                presetMemo={memo ?? ""}
                invoiceSlug={invoice ?? null}
                paymentRegistryId={merchant.payment_registry_id ?? null}
              />
            ) : (
              <SignInToPay handle={handle} amount={presetAmount} />
            )}
          </div>

          <p className="mt-12 max-w-md text-[11px] leading-relaxed text-[var(--color-fg-dim)]">
            This payment is non-custodial. Your funds move directly from your
            Sui address to {merchant.business_name}&apos;s Sui address in one
            atomic transaction. Talise never touches the money.
          </p>
        </main>
      </div>
    </div>
  );
}

function SelfPayNotice({ handle }: { handle: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-6">
      <div className="text-[13px] text-[var(--color-fg)]">
        This is your own payment link.
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
        Share <span className="font-mono">talise.io/p/{handle}</span> with
        customers, and they&apos;ll see this exact page and can pay you in three
        taps.
      </p>
      <div className="mt-4 flex gap-3">
        <a
          href="/business"
          className="rounded-md bg-[var(--color-fg)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)]"
        >
          Back to dashboard →
        </a>
      </div>
    </div>
  );
}

function SignInToPay({
  handle,
  amount,
}: {
  handle: string;
  amount: string;
}) {
  const returnTo = `/p/${handle}${amount ? `?amount=${amount}` : ""}`;
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-8">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
        Sign in to pay
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-fg)]">
        Sign in with Google to send USDsui or SUI in seconds. We mint you a
        non-custodial Sui address on the spot.
      </p>
      <p className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
        No bank. No seed phrase. Sub-cent fees. Sub-second settlement.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <SignInButton variant="primary" returnTo={returnTo} />
        </div>
        <a
          href="/"
          className="text-[13px] text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
        >
          What is Talise?
        </a>
      </div>
    </div>
  );
}
