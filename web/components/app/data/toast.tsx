"use client";

/**
 * Lightweight toast system. <ToastProvider> is mounted by AppShell; any
 * client component calls `useToast().toast(msg, tone)` to surface a brief
 * glass pill at the bottom of the screen. Tones map to the brand mint
 * (success), danger red, or a neutral hairline.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Cancel01Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";

export type ToastTone = "success" | "danger" | "neutral";
type ToastItem = { id: number; message: string; tone: ToastTone };

type ToastCtx = { toast: (message: string, tone?: ToastTone) => void };

const Ctx = createContext<ToastCtx | null>(null);

const TONE_ICON = {
  success: CheckmarkCircle02Icon,
  danger: Cancel01Icon,
  neutral: InformationCircleIcon,
} as const;

const TONE_COLOR = {
  success: "var(--color-accent)",
  danger: "var(--color-danger)",
  neutral: "var(--color-fg-muted)",
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const toast = useCallback((message: string, tone: ToastTone = "neutral") => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[120] flex flex-col items-center gap-2 px-4 lg:bottom-8"
        aria-live="polite"
        aria-atomic="false"
      >
        {/* `app-clean` ON each pill: this stack renders OUTSIDE the themed
            page wrapper, so without it the pills inherit the dark-root
            tokens — near-white text + pale mint icon on a white glass pill
            (the invisible "Pay link copied" bug). The combined
            `.app-clean.talise-glass` selector in globals.css handles exactly
            this portaled-panel case. */}
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className="app-clean talise-glass talise-toast-in pointer-events-auto flex max-w-[92vw] items-center gap-2.5 rounded-full px-4 py-2.5 text-sm text-fg shadow-2xl sm:max-w-md"
            style={{ borderRadius: 999 }}
          >
            <HugeiconsIcon
              icon={TONE_ICON[t.tone]}
              size={18}
              color={TONE_COLOR[t.tone]}
              strokeWidth={2}
            />
            <span className="truncate font-medium">{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider> (mounted by AppShell)");
  }
  return ctx;
}
