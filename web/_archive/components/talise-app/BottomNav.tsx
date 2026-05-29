import Link from "next/link";

export type TaliseTab = "home" | "invest" | "rewards" | "profile";

/**
 * Floating bottom nav pill — mirrors the iOS `BottomNavPill`. Four tabs:
 * Home / Invest / Rewards / Profile. The active tab gets a filled disc
 * with the foreground icon; inactives are dim and label-only.
 */
export function BottomNav({ active }: { active: TaliseTab }) {
  const tabs: Array<{ id: TaliseTab; href: string; label: string; icon: string }> = [
    { id: "home",    href: "/home",     label: "Home",    icon: "house.fill" },
    { id: "invest",  href: "/earn",     label: "Invest",  icon: "leaf.fill" },
    { id: "rewards", href: "/rewards",  label: "Rewards", icon: "gift.fill" },
    { id: "profile", href: "/settings", label: "Profile", icon: "person.fill" },
  ];

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <nav
        className="talise-glass flex items-center gap-1 rounded-full px-3 py-2"
        aria-label="Primary"
      >
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={active === t.id ? "page" : undefined}
            className={[
              "group flex flex-col items-center gap-0.5 rounded-full px-4 py-2 transition",
              active === t.id
                ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
            ].join(" ")}
          >
            <NavGlyph icon={t.icon} active={active === t.id} />
            <span className="text-[10px] tracking-wide">{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/**
 * Renders the iOS SF Symbol equivalent as a small SVG. We don't have
 * SF Symbols on the web, so each glyph is an inline mini-icon shaped
 * to roughly match the iOS counterpart. Single source of truth so
 * we can swap them in one place if we adopt a richer icon set later.
 */
function NavGlyph({ icon, active }: { icon: string; active: boolean }) {
  const stroke = active ? "var(--color-fg)" : "var(--color-fg-muted)";
  const fill = active ? "var(--color-fg)" : "transparent";
  switch (icon) {
    case "house.fill":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="1.7">
          <path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
        </svg>
      );
    case "leaf.fill":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="1.7">
          <path d="M20 4c-7 0-14 4-14 12 0 2 1 4 3 4 8 0 12-7 12-14a4 4 0 0 0-1-2z" />
          <path d="M6 18C9 14 12 12 18 8" stroke={active ? "var(--color-bg)" : stroke} fill="none" strokeLinecap="round" />
        </svg>
      );
    case "gift.fill":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="1.7">
          <rect x="3" y="9" width="18" height="12" rx="1.5" />
          <path d="M3 13h18M12 9v12" stroke={active ? "var(--color-bg)" : stroke} />
          <path d="M8 9a3 3 0 1 1 4-4 3 3 0 1 1 4 4" />
        </svg>
      );
    case "person.fill":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="1.7">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.5 3.5-8 8-8s8 3.5 8 8" />
        </svg>
      );
    default:
      return <span className="w-4 h-4" />;
  }
}
