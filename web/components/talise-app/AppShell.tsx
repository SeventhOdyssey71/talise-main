import type { ReactNode } from "react";
import { BottomNav, type TaliseTab } from "./BottomNav";

/**
 * Mobile-style page shell for the web app — mirrors the iOS structure.
 *
 *   ┌────────────────────────────────────────┐
 *   │  TopGlow (green horizon wash)          │
 *   │ ┌────────── 480px column ───────────┐  │
 *   │ │   page content                    │  │
 *   │ │   …                               │  │
 *   │ └───────────────────────────────────┘  │
 *   │            floating BottomNav          │
 *   └────────────────────────────────────────┘
 *
 * The CSS lives in `app/globals.css` (`.talise-app-shell`, `.talise-app-column`,
 * `.talise-top-glow`). Pass the active tab so the bottom nav highlights
 * the right slot.
 */
export function AppShell({
  active,
  children,
}: {
  active: TaliseTab;
  children: ReactNode;
}) {
  return (
    <div className="talise-app-shell">
      <div className="talise-top-glow" aria-hidden />
      <div className="talise-app-column pt-6">{children}</div>
      <BottomNav active={active} />
    </div>
  );
}
