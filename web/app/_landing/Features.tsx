import { Eyebrow, Headline, SectionShell } from "./primitives";

/**
 * "How it works" — three feature cards. Preserves the original three
 * blocks verbatim (send / earn / stable). Restyled as soft-gray cards
 * with hairline borders, Xend's restrained palette.
 */
export function Features() {
  const items: Array<{
    eyebrow: string;
    title: string;
    body: string;
    glyph: "send" | "leaf" | "sui";
  }> = [
    {
      eyebrow: "01 / send",
      title: "Across borders, in seconds.",
      body:
        "Send to a phone, a username, or a wallet. Naira, cedis, shillings, rand. We settle in USDsui and land in the receiver's local currency, faster than any traditional rail.",
      glyph: "send",
    },
    {
      eyebrow: "02 / earn",
      title: "Idle money should compound.",
      body:
        "Move USDsui into NAVI lending in one tap. Watch real-time yield. Withdraw anytime. No lockups, no jargon. Just a balance that quietly grows.",
      glyph: "leaf",
    },
    {
      eyebrow: "03 / stable",
      title: "Built on the Sui Dollar.",
      body:
        "USDsui is the canonical Sui-native dollar. No bridge risk, no wrapped tokens, no off-chain custody. The same dollar your savings, payments, and yield all share.",
      glyph: "sui",
    },
  ];

  return (
    <SectionShell id="how" className="border-t border-[var(--landing-border)] py-24 md:py-32">
      <Eyebrow>how it works</Eyebrow>
      <Headline size="md" className="mt-4 max-w-[820px]">
        One app. Every corridor.{" "}
        <span
          className="text-[var(--landing-fg-muted)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          Arrives in seconds.
        </span>
      </Headline>

      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {items.map((it) => (
          <article
            key={it.eyebrow}
            className="rounded-[18px] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-7 transition hover:bg-[var(--landing-surface-2)]"
          >
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--landing-fg-muted)]">
                {it.eyebrow}
              </div>
              <FeatureGlyph kind={it.glyph} />
            </div>
            <h3 className="mt-8 text-[22px] font-semibold leading-[1.18] tracking-tight text-[var(--landing-fg)]">
              {it.title}
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--landing-fg-dim)]">
              {it.body}
            </p>
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

function FeatureGlyph({ kind }: { kind: "send" | "leaf" | "sui" }) {
  const stroke = "#0a0a0a";
  return (
    <span
      className="grid h-9 w-9 place-items-center rounded-full bg-[var(--landing-surface-2)]"
    >
      {kind === "send" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22l-4-9-9-4z" />
        </svg>
      )}
      {kind === "leaf" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill={stroke} stroke={stroke} strokeWidth="1.3">
          <path d="M20 4c-7 0-14 4-14 12 0 2 1 4 3 4 8 0 12-7 12-14a4 4 0 0 0-1-2z" />
        </svg>
      )}
      {kind === "sui" && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8" />
          <path d="M9 9c3 3 6 0 6 6" />
        </svg>
      )}
    </span>
  );
}
