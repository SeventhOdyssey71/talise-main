"use client";

import { useEffect, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Eyebrow } from "./Typography";

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
};

const MAX_W = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" } as const;

/**
 * A modal surface: a centered glass dialog on lg+, a bottom sheet on mobile.
 * Backdrop blur, ESC-to-close, and backdrop-click-to-close. Locks body scroll
 * while open.
 */
export function Sheet({ open, onClose, title, children, size = "md" }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="talise-sheet-backdrop absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      {/* Panel */}
      <div
        className={`talise-glass talise-sheet-panel relative z-10 m-0 w-full ${MAX_W[size]} sm:m-4`}
        style={{ borderRadius: 24, maxHeight: "92vh" }}
      >
        {/* Mobile grab handle */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-white/15" />
        </div>
        {(title || true) && (
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 sm:pt-5">
            {title ? <Eyebrow>{title}</Eyebrow> : <span />}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-full text-fg-dim transition-colors hover:bg-white/5 hover:text-fg"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={2} />
            </button>
          </div>
        )}
        <div
          className="overflow-y-auto px-5 pb-6"
          style={{ maxHeight: "calc(92vh - 56px)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
