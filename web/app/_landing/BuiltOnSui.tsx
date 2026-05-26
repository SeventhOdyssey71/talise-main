import { SectionShell } from "./primitives";

/**
 * "Built on Sui" chip. Mirrors Xend's "Built on Solana" placement —
 * sits as its own slim section between StatsStrip and Features so the
 * provenance reads on first scroll. Links out to sui.io.
 */
export function BuiltOnSui() {
  return (
    <SectionShell className="pb-12 md:pb-16">
      <div className="flex justify-center">
        <a
          href="https://sui.io"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2.5 rounded-full border border-[var(--landing-border)] bg-[var(--landing-surface)] px-4 py-2 text-[13px] font-medium text-[var(--landing-fg)] transition hover:bg-[var(--landing-surface-2)]"
        >
          <SuiLogo />
          <span>Built on Sui</span>
          <span aria-hidden className="text-[var(--landing-fg-muted)]">
            →
          </span>
        </a>
      </div>
    </SectionShell>
  );
}

/**
 * Sui drop logomark — pulled from sui.io's brand. Uses the canonical
 * cyan fill (#4DA2FF) so it reads as the official Sui mark even on a
 * white background.
 */
function SuiLogo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 300 384"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M240.1 168.9c15.7 19.7 25.1 44.7 25.1 71.8 0 27.7-9.8 53.1-26.1 73-1.1 1.3-2.8 2.1-4.6 2-1.8-.1-3.4-1-4.4-2.5l-.7-1.1c-1.6-2.5-3.2-5-4.8-7.4l-.4-.6c-.7-1.2-.8-2.7-.2-4 8.8-19.9 12.7-31.1 12.5-49-.4-31.9-18.4-58.6-65.8-95.2-32.1-24.7-49.5-58.5-49.7-95-.1 36.5-17.5 70.3-49.7 95-47.4 36.6-65.4 63.3-65.8 95.2-.2 17.9 3.7 29.1 12.5 49 .6 1.3.5 2.8-.2 4l-.4.6c-1.6 2.5-3.2 5-4.8 7.4l-.7 1.1c-1 1.5-2.6 2.4-4.4 2.5-1.8.1-3.5-.7-4.6-2C9.8 294.4 0 269 0 240.7c0-27.1 9.4-52.1 25.1-71.8L131.4 41.5c1.1-1.3 2.8-2.1 4.6-2 1.8.1 3.4 1 4.4 2.5l.7 1.1 1.5 2.3 99.5 123.5z"
        fill="#4DA2FF"
      />
    </svg>
  );
}
