import { Eyebrow, Headline, SectionShell } from "./primitives";

/**
 * "Use it like a checking account" — persona stories section. Preserves
 * the original "Built for the diaspora" copy plus the two persona cards
 * (Chiamaka in London, Mama Adaeze in Lagos). Restyled in light mode
 * with soft-gray cards and a black "with talise" emphasis block.
 */
export function CheckingAccount() {
  return (
    <SectionShell id="who" className="border-t border-[var(--landing-border)] py-24 md:py-32">
      <Eyebrow>who it's for</Eyebrow>
      <Headline size="md" className="mt-4 max-w-[820px]">
        Built for the{" "}
        <span
          className="text-[var(--landing-accent)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          diaspora.
        </span>
      </Headline>
      <p className="mt-5 max-w-[620px] text-[16px] leading-relaxed text-[var(--landing-fg-dim)]">
        Every month, millions of Africans abroad send a piece of their salary
        home. Talise is for the person sending it, and the family waiting on
        it.
      </p>

      <div className="mt-14 grid gap-4 md:grid-cols-2">
        <PersonaCard
          name="Chiamaka"
          eyebrow="London → Lagos · NHS Nurse, sending home"
          chip="£500 → ₦1,050,000"
          before="Sends £500 home every month. Western Union takes around £32 in fees plus a poor exchange rate, roughly £45 lost per transfer."
          after="With Talise, the fee on £500 is near zero. She saves about £40 a month, £480 a year, and her mum gets the cash in under 5 seconds."
        />
        <PersonaCard
          name="Mama Adaeze"
          eyebrow="Lagos · Receives · The family back home"
          chip="₦1,050,000 received"
          before="Used to spend a half-day on the bus to collect cash from an agent. Sometimes the agent was out of naira and she'd come back the next day."
          after="Now the naira lands in her mobile money in seconds. She buys yams from the market on the same phone. No queue, no agent, no come-back-tomorrow."
        />
      </div>
    </SectionShell>
  );
}

function PersonaCard({
  name,
  eyebrow,
  chip,
  before,
  after,
}: {
  name: string;
  eyebrow: string;
  chip: string;
  before: string;
  after: string;
}) {
  return (
    <article className="rounded-[20px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[20px] font-semibold tracking-tight text-[var(--landing-fg)]">
            {name}
          </h3>
          <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--landing-fg-muted)]">
            {eyebrow}
          </div>
        </div>
        <div
          className="rounded-full border border-[var(--landing-border)] bg-[var(--landing-bg)] px-3 py-1 text-[12px] font-medium text-[var(--landing-fg)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {chip}
        </div>
      </div>
      <div className="mt-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--landing-fg-muted)]">
          before
        </div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--landing-fg-dim)]">
          {before}
        </p>
      </div>
      <div className="mt-4 rounded-2xl border border-black/10 bg-black p-5 text-white">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          with talise
        </div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-white">
          {after}
        </p>
      </div>
    </article>
  );
}
