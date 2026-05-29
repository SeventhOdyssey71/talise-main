"use client";

import { motion, useInView, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useRef } from "react";

export function AnimatedNumber({
  to,
  suffix = "",
  prefix = "",
  decimals = 0,
  durationMs = 1400,
}: {
  to: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  durationMs?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const v = useMotionValue(0);
  const display = useTransform(v, (n) => {
    const fixed = n.toFixed(decimals);
    const [whole, frac] = fixed.split(".");
    const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${prefix}${frac !== undefined ? `${withCommas}.${frac}` : withCommas}${suffix}`;
  });

  useEffect(() => {
    if (!inView) return;
    const controls = animate(v, to, {
      duration: durationMs / 1000,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [inView, to, durationMs, v]);

  return <motion.span ref={ref}>{display}</motion.span>;
}
