"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText);

/**
 * Landing page motion layer.
 *
 * Renders nothing — sits in the DOM as a mount-only useEffect that:
 *   1. Waits for fonts to settle (so SplitText measures correctly).
 *   2. Runs a single GSAP context (auto-cleans on unmount).
 *   3. Plays an initial hero reveal timeline on load.
 *   4. Wires ScrollTrigger reveals for every section below the fold.
 *
 * The target elements are tagged with `motion-*` class names on the
 * server-rendered page (`app/page.tsx`). Doing it via class selectors
 * keeps the page itself fully server-rendered — better LCP, and the
 * content is visible if JS fails to load. Animations only add polish
 * on top of an already-correct paint.
 *
 * Respects `prefers-reduced-motion: reduce` — exits early without
 * mutating any element.
 */
export function LandingMotion() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx: gsap.Context | undefined;
    let cancelled = false;

    const ready = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready
      ?? Promise.resolve();

    ready.then(() => {
      if (cancelled) return;

      ctx = gsap.context(() => {
        // ── HERO REVEAL ────────────────────────────────────────────
        // One unified timeline so the eyebrow, headline, sub-copy, CTAs,
        // tagline, and phone collage cascade in a tight, intentional
        // rhythm rather than each element appearing on its own.
        const headlineEl = document.querySelector<HTMLElement>(".motion-headline");
        const split = headlineEl
          ? new SplitText(headlineEl, { type: "words", wordsClass: "motion-headline-word" })
          : null;

        const tl = gsap.timeline({
          defaults: { ease: "power3.out", duration: 0.85 },
        });

        tl.from(".motion-topbar", {
          y: -16,
          autoAlpha: 0,
          duration: 0.55,
          ease: "power2.out",
        });

        tl.from(
          ".motion-eyebrow",
          { y: 14, autoAlpha: 0, duration: 0.5 },
          "-=0.25"
        );

        if (split && split.words.length > 0) {
          tl.from(
            split.words,
            { y: 56, autoAlpha: 0, stagger: 0.05, duration: 0.75 },
            "-=0.2"
          );
        }

        tl.from(
          ".motion-subtitle",
          { y: 18, autoAlpha: 0, duration: 0.55 },
          "-=0.45"
        );

        tl.from(
          ".motion-cta > *",
          {
            y: 16,
            autoAlpha: 0,
            stagger: 0.09,
            duration: 0.5,
            ease: "back.out(1.4)",
          },
          "-=0.35"
        );

        tl.from(
          ".motion-tagline",
          { autoAlpha: 0, y: 6, duration: 0.4 },
          "-=0.2"
        );

        tl.from(
          ".motion-collage",
          {
            y: 70,
            autoAlpha: 0,
            scale: 0.94,
            duration: 1.1,
            ease: "power4.out",
          },
          "-=0.5"
        );

        // Continuous gentle float on the phone collage — subtle, slow.
        gsap.to(".motion-collage", {
          y: "+=10",
          duration: 4.2,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        });

        // ── STAT ROW (under hero) ─────────────────────────────────
        gsap.from(".motion-stat", {
          scrollTrigger: { trigger: ".motion-stat-row", start: "top 85%" },
          y: 32,
          autoAlpha: 0,
          stagger: 0.1,
          duration: 0.8,
          ease: "power3.out",
        });

        // ── 3-CARD FEATURE GRID ───────────────────────────────────
        gsap.from(".motion-feature-card", {
          scrollTrigger: { trigger: ".motion-feature-row", start: "top 85%" },
          y: 44,
          autoAlpha: 0,
          stagger: 0.12,
          duration: 0.9,
          ease: "power3.out",
        });

        // ── DEEP FEATURE SECTIONS ─────────────────────────────────
        // Each section reveals its contents independently when scrolled
        // into view, so the user sees a fresh "page" of motion at each
        // scroll stop instead of one giant cascade.
        gsap.utils.toArray<HTMLElement>(".motion-deep-section").forEach((section) => {
          const items = section.querySelectorAll<HTMLElement>(".motion-deep-item");
          if (items.length === 0) return;
          gsap.from(items, {
            scrollTrigger: { trigger: section, start: "top 78%" },
            y: 38,
            autoAlpha: 0,
            stagger: 0.1,
            duration: 0.85,
            ease: "power3.out",
          });
        });

        // ── PERSONA CARDS ─────────────────────────────────────────
        gsap.from(".motion-persona", {
          scrollTrigger: { trigger: ".motion-persona-row", start: "top 82%" },
          y: 50,
          autoAlpha: 0,
          stagger: 0.18,
          duration: 0.95,
          ease: "power3.out",
        });

        // ── FINAL CTA ─────────────────────────────────────────────
        gsap.from(".motion-final > *", {
          scrollTrigger: { trigger: ".motion-final", start: "top 80%" },
          y: 26,
          autoAlpha: 0,
          stagger: 0.09,
          duration: 0.75,
          ease: "power3.out",
        });

        // ── FOOTER ────────────────────────────────────────────────
        gsap.from(".motion-footer-col", {
          scrollTrigger: { trigger: ".motion-footer", start: "top 90%" },
          y: 24,
          autoAlpha: 0,
          stagger: 0.08,
          duration: 0.7,
          ease: "power3.out",
        });
      });
    });

    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, []);

  return null;
}
