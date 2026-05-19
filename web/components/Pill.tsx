export function Pill({ count }: { count: number }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]/80 px-3 py-1.5 backdrop-blur-md"
      style={{ fontSize: 13 }}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
      </span>
      <span className="text-[var(--color-fg-muted)]">
        <span className="font-medium text-[var(--color-fg)]">{count.toLocaleString()}</span>{" "}
        already inside
      </span>
    </div>
  );
}
