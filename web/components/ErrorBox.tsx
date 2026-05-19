"use client";

/**
 * One-stop error display: red border, alert glyph, humanized message,
 * optional details + retry callback.
 */
export function ErrorBox({
  message,
  hint,
  onRetry,
  className,
}: {
  message: string;
  hint?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { headline, detail } = humanizeError(message);

  return (
    <div
      role="alert"
      className={`rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/[0.06] p-4 ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#e5484d]/40 text-[12px] font-medium text-[#c92a2a]"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#c92a2a]">
            {headline}
          </div>
          {detail && (
            <div className="mt-1 break-words text-[12px] leading-relaxed text-[#9b2c2c]/85">
              {detail}
            </div>
          )}
          {hint && (
            <div className="mt-2 text-[11px] text-[#9b2c2c]/75">{hint}</div>
          )}
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-3 rounded-md border border-[#e5484d]/30 bg-white px-3 py-1.5 text-[12px] text-[#c92a2a] transition hover:border-[#c92a2a]"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Translate known cryptic backend errors into something humans can read.
 * Falls back to the raw message as detail.
 */
export function humanizeError(raw: string): { headline: string; detail?: string } {
  if (!raw) return { headline: "Something went wrong." };

  // Shinami / prover rate limit
  if (raw.includes("-32012") || raw.toLowerCase().includes("rate limit")) {
    return {
      headline: "Too many requests in a minute.",
      detail: "Give it 60 seconds and try again.",
    };
  }
  // Generic prover failure
  if (
    raw.startsWith("prover ") ||
    raw.startsWith("shinami ") ||
    raw.includes("InputValidationError")
  ) {
    return {
      headline: "Couldn't get a sign-in proof.",
      detail: raw.replace(/^(prover|shinami) [^:]+:\s*/, ""),
    };
  }
  // Sign-in dropped
  if (raw.includes("No active sign-in") || raw.includes("session expired")) {
    return {
      headline: "Your session expired.",
      detail: "Sign in again and your wallet will be ready in a few seconds.",
    };
  }
  // Wallet empty
  if (raw.includes("No USDsui") || raw.includes("No USDC")) {
    return {
      headline: "No USDsui in your wallet.",
      detail: "Fund this address with USDsui first, then try the transaction again.",
    };
  }
  if (raw.includes("Need ~0.01 SUI") || raw.includes("Need a small SUI balance")) {
    return {
      headline: "Need a bit of SUI for gas.",
      detail: raw,
    };
  }
  if (raw.includes("Insufficient")) {
    return { headline: "Not enough balance.", detail: raw };
  }
  // Tx failed on-chain
  if (raw.startsWith("transaction failed")) {
    return {
      headline: "Transaction reverted on Sui.",
      detail: raw.replace(/^transaction failed:\s*/, ""),
    };
  }
  return { headline: raw };
}
