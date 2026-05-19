import { Reveal } from "./Reveal";

const FEATURES = [
  {
    glyph: "◐",
    name: "Instant settlement",
    body: "Money arrives in your family's account in seconds, not days. No three-day bank holds. No \"pending compliance review.\"",
  },
  {
    glyph: "◇",
    name: "Almost free",
    body: "We charge around 1% per transfer. Western Union charges 6–7%. On £500, that's about £30 back in your pocket every month.",
  },
  {
    glyph: "★",
    name: "First send is on us",
    body: "Pay zero in fees on your first transfer. No promo code, no fine print — we cover it so you can see how it feels.",
  },
];

export function FeatureRow() {
  return (
    <section id="features" className="bg-[var(--color-bg)] py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6 md:px-8">
        <Reveal>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.name}
                className="flex h-full flex-col bg-[var(--color-surface)] p-7"
              >
                <div className="text-[24px] text-[var(--color-fg)]">{f.glyph}</div>
                <div className="mt-5 text-[18px] font-semibold tracking-tight text-[var(--color-fg)]">
                  {f.name}
                </div>
                <p className="mt-2 flex-1 text-[13px] leading-[1.6] text-[var(--color-fg-muted)]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
