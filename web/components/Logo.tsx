import Image from "next/image";

export function Logo({
  size = 28,
  showWordmark = true,
  href = "/",
  className,
}: {
  size?: number;
  showWordmark?: boolean;
  href?: string;
  className?: string;
}) {
  const inner = (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <Image
        src="/logo.png"
        alt="Talise"
        width={size}
        height={size}
        priority
        className="block"
      />
      {showWordmark && (
        <span className="font-display text-[20px] tracking-tight text-[var(--color-fg)]">
          talise
        </span>
      )}
    </span>
  );
  if (!href) return inner;
  return (
    <a href={href} className="inline-block">
      {inner}
    </a>
  );
}
