import type { PaymentIntent, IntentLeg } from "@/lib/intents";

/**
 * Payment Intent preview — the "Plan" phase made visible. Renders each leg of
 * the bundled PTB above the sign button so the user knows exactly what one
 * signature will do.
 *
 * Per Sui's payment-intents doc: "the compiled payment intent is the source
 * of truth. The natural-language intent is a convenience." This component
 * IS the natural-language intent.
 */
export function IntentPreview({
  intent,
  className,
}: {
  intent: PaymentIntent;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-5 " +
        (className ?? "")
      }
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
          Payment intent · {intent.legs.length} step
          {intent.legs.length === 1 ? "" : "s"} · one signature
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
          atomic
        </div>
      </div>

      <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-fg)]">
        {intent.summary}
      </p>

      <ol className="mt-4 space-y-2.5">
        {intent.legs.map((leg, i) => (
          <Leg key={i} index={i + 1} leg={leg} />
        ))}
      </ol>

      <div className="mt-4 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-fg-dim)]">
        All steps settle together or none do. You sign once; gas is on us.
      </div>
    </div>
  );
}

function Leg({ index, leg }: { index: number; leg: IntentLeg }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] font-mono text-[10px] text-[var(--color-fg-muted)]">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-[13px] text-[var(--color-fg)]">{leg.title}</span>
          {leg.detail && (
            <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
              {leg.detail}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
