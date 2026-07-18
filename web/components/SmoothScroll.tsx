"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * App-wide smooth (momentum) scrolling via Lenis. Mounted once in the app shell.
 *
 * Only the main window scroll is smoothed — any element (or ancestor) marked
 * `data-lenis-prevent` scrolls natively, so bottom sheets, dialogs, and the
 * perps terminal's inner panels keep their own scroll untouched. Honours
 * prefers-reduced-motion (falls back to native scroll).
 */
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Touch devices (phones/tablets) already have great native momentum
    // scrolling; Lenis only smooths the mouse WHEEL and on iOS/touch it makes
    // scrolling feel janky or broken. Desktop-only.
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const lenis = new Lenis({ duration: 1.05, smoothWheel: true, syncTouch: false, anchors: true });
    let id = requestAnimationFrame(function raf(time: number) {
      lenis.raf(time);
      id = requestAnimationFrame(raf);
    });

    return () => {
      cancelAnimationFrame(id);
      lenis.destroy();
    };
  }, []);

  return null;
}
