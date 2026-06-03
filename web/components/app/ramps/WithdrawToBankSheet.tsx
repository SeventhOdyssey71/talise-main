"use client";

/**
 * WithdrawToBankSheet — the live USDsui → NGN bank cash-out flow (web).
 *
 * Steps: form → review (locked quote) → send + remit → result.
 *   1. form    user enters NGN amount, bank, 10-digit account → POST /quote
 *              (Paga name-enquiry + locked USDsui price, 60s TTL).
 *   2. review  shows the resolved account holder + what they send vs receive;
 *              SlideToConfirm signs a USDsui transfer to the offramp treasury
 *              (useSignAndSend), then POST /confirm with the on-chain digest.
 *   3. result  polls /status a few times to surface settled, otherwise shows
 *              "on its way" (NIBSS settles async; the webhook/status finalize).
 *
 * The off-ramp API routes resolve the web cookie session, so no extra auth
 * wiring is needed here.
 */

import { useCallback, useState } from "react";
import {
  Sheet,
  Field,
  PrimaryButton,
  SlideToConfirm,
  Spinner,
  Eyebrow,
  StatusPill,
  useToast,
  useSignAndSend,
  api,
  ApiError,
} from "@/components/app";

// Top NIBSS banks (codes match the server static fallback; the quote route
// validates against the synced Paga registry and accepts either code or UUID).
const BANKS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "044", name: "Access Bank" },
  { code: "023", name: "Citibank" },
  { code: "050", name: "Ecobank" },
  { code: "070", name: "Fidelity Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "214", name: "First City Monument Bank" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "221", name: "Stanbic IBTC Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "033", name: "United Bank For Africa" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
];

type Quote = {
  quoteId: string;
  usdsuiAmount: number;
  ngnAmount: number;
  fxRate: number;
  accountName: string;
  expiresAt: number;
  treasury: string | null;
};

type StatusResp = { id: string; status: string; ngnAmount: number };

const ngn = (n: number) => "₦" + n.toLocaleString("en-NG", { maximumFractionDigits: 0 });
const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function WithdrawToBankSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { send } = useSignAndSend();

  const [step, setStep] = useState<"form" | "review" | "result">("form");
  const [amount, setAmount] = useState("");
  const [bankCode, setBankCode] = useState("058");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [finalStatus, setFinalStatus] = useState<"settled" | "remitting" | "failed" | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const reset = useCallback(() => {
    setStep("form");
    setAmount("");
    setAccount("");
    setError(null);
    setQuote(null);
    setFinalStatus(null);
    setBusy(false);
  }, []);

  const close = useCallback(() => {
    onClose();
    // Defer reset so the closing animation doesn't flash the form.
    setTimeout(reset, 250);
  }, [onClose, reset]);

  const ngnAmount = Math.floor(Number(amount) || 0);
  const formValid = ngnAmount >= 100 && /^\d{10}$/.test(account) && !!bankCode;

  async function getQuote() {
    setError(null);
    setBusy(true);
    try {
      const q = await api<Quote>("/api/offramp/paga/quote", {
        method: "POST",
        body: { ngnAmount, bankCode, accountNumber: account },
      });
      setQuote(q);
      setStep("review");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not build a quote. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithdraw() {
    if (!quote) return;
    if (!quote.treasury) {
      setError("Cash-out is not configured yet. Please try again later.");
      setStep("result");
      setFinalStatus("failed");
      return;
    }
    if (Date.now() > quote.expiresAt) {
      setError("That quote expired. Please get a fresh one.");
      setResetSignal((n) => n + 1);
      setStep("form");
      return;
    }
    try {
      // 1) Move USDsui to the offramp treasury (gasless/sponsored send pipeline).
      const { digest } = await send({
        to: quote.treasury,
        amountUsd: quote.usdsuiAmount,
        asset: "USDsui",
      });
      // 2) Hand the on-chain digest to the offramp confirm → Paga payout.
      await api<{ status: string }>("/api/offramp/paga/confirm", {
        method: "POST",
        body: { quoteId: quote.quoteId, txDigest: digest },
      });
      // 3) Poll a few times for NIBSS settlement; otherwise it's "on its way".
      let settled: "settled" | "remitting" | "failed" = "remitting";
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          const s = await api<StatusResp>(`/api/offramp/paga/status/${quote.quoteId}`);
          if (s.status === "settled") { settled = "settled"; break; }
          if (s.status === "failed") { settled = "failed"; break; }
        } catch {
          /* transient poll error — keep trying */
        }
      }
      setFinalStatus(settled);
      setStep("result");
      if (settled !== "failed") toast("Withdrawal submitted.", "success");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Withdrawal failed. Your funds are safe.";
      setError(msg);
      setFinalStatus("failed");
      setStep("result");
    }
  }

  const bankName = BANKS.find((b) => b.code === bankCode)?.name ?? bankCode;

  return (
    <Sheet open={open} onClose={close} title="Cash out to your bank" size="md">
      {step === "form" && (
        <div className="space-y-5">
          <Field label="Amount (NGN)" hint="They receive this amount in naira.">
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="0"
              className="w-full rounded-2xl bg-surface px-4 py-3 text-[18px] text-fg outline-none ring-1 ring-line focus:ring-accent"
            />
          </Field>
          <Field label="Bank">
            <select
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
              className="w-full rounded-2xl bg-surface px-4 py-3 text-[15px] text-fg outline-none ring-1 ring-line focus:ring-accent"
            >
              {BANKS.map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Account number" hint="10-digit NUBAN.">
            <input
              inputMode="numeric"
              value={account}
              onChange={(e) => setAccount(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
              placeholder="0123456789"
              className="w-full rounded-2xl bg-surface px-4 py-3 text-[16px] tracking-wide text-fg outline-none ring-1 ring-line focus:ring-accent"
            />
          </Field>
          {error && <p className="text-[13px] text-red-500">{error}</p>}
          <PrimaryButton full onClick={getQuote} disabled={!formValid || busy} loading={busy}>
            {busy ? "Getting quote…" : "Get quote"}
          </PrimaryButton>
        </div>
      )}

      {step === "review" && quote && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
            <Eyebrow>They receive</Eyebrow>
            <div className="mt-1 text-[30px] font-medium tracking-[-0.03em] text-fg">
              {ngn(quote.ngnAmount)}
            </div>
            <div className="mt-3 space-y-1.5 text-[14px] text-fg-muted">
              <Row k="To" v={quote.accountName} />
              <Row k="Bank" v={bankName} />
              <Row k="Account" v={`••••${account.slice(-4)}`} />
              <Row k="You send" v={usd(quote.usdsuiAmount) + " USDsui"} />
              <Row k="Rate" v={`$1 = ${ngn(quote.fxRate)}`} />
            </div>
          </div>
          <p className="text-center text-[12px] text-fg-dim">
            Quote locked for 60s. Slide to send {usd(quote.usdsuiAmount)} USDsui and pay out{" "}
            {ngn(quote.ngnAmount)}.
          </p>
          {error && <p className="text-center text-[13px] text-red-500">{error}</p>}
          <SlideToConfirm
            label="Slide to withdraw"
            onConfirm={confirmWithdraw}
            resetSignal={resetSignal}
          />
          <button
            type="button"
            onClick={() => { setStep("form"); setError(null); }}
            className="mx-auto block text-[13px] text-fg-muted underline-offset-2 hover:underline"
          >
            Edit details
          </button>
        </div>
      )}

      {step === "result" && (
        <div className="space-y-5 py-2 text-center">
          {finalStatus === "failed" ? (
            <>
              <StatusPill label="Failed" tone="pending" />
              <p className="text-[15px] text-fg">{error ?? "The payout could not be completed."}</p>
              <p className="text-[12px] text-fg-dim">
                If your USDsui left your wallet, it will be returned automatically.
              </p>
              <PrimaryButton full onClick={reset}>Try again</PrimaryButton>
            </>
          ) : (
            <>
              <div className="text-[40px]">{finalStatus === "settled" ? "✅" : "🚀"}</div>
              <h3 className="text-[20px] font-medium tracking-[-0.02em] text-fg">
                {finalStatus === "settled" ? "Paid out" : "On its way"}
              </h3>
              <p className="text-[15px] text-fg-muted">
                {quote ? ngn(quote.ngnAmount) : ""} to {quote?.accountName ?? "your bank"}
                {finalStatus === "settled" ? " has landed." : " — banks usually settle in seconds."}
              </p>
              <PrimaryButton full onClick={close}>Done</PrimaryButton>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-dim">{k}</span>
      <span className="text-right text-fg">{v}</span>
    </div>
  );
}

export default WithdrawToBankSheet;
