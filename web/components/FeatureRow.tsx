"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  FlashFreeIcons,
  CoinsDollarFreeIcons,
  GiftCardFreeIcons,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Reveal } from "./Reveal";

const FEATURES: Array<{
  icon: IconSvgElement;
  name: string;
  body: string;
}> = [
  {
    icon: FlashFreeIcons,
    name: "Instant settlement",
    body: "Money arrives in your family's account in seconds, not days. No three-day bank holds. No \"pending compliance review.\"",
  },
  {
    icon: CoinsDollarFreeIcons,
    name: "Free.",
    body: "We don't charge a transfer fee. Western Union charges 6–7%. On £500 that's about £30 back in your pocket every month.",
  },
  {
    icon: GiftCardFreeIcons,
    name: "First send is on us",
    body: "Pay zero in fees on your first transfer. No promo code, no fine print — we cover it so you can see how it feels.",
  },
];

export function FeatureRow() {
  return (
    <section id="features" className="bg-[#fafaf7] py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6 md:px-8">
        <Reveal>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-[#e8e1cf] bg-[#e8e1cf] md:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.name}
                className="flex h-full flex-col bg-white p-7"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fafaf7] text-[#c08a3e]">
                  <HugeiconsIcon
                    icon={f.icon}
                    size={20}
                    strokeWidth={1.6}
                    color="currentColor"
                  />
                </div>
                <div className="mt-5 text-[19px] font-medium tracking-[-0.01em] text-[#111]">
                  {f.name}
                </div>
                <p className="mt-2 flex-1 text-[14px] leading-[1.6] text-[#5a554a]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
