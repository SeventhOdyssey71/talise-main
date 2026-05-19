"use client";

import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { SignInButton } from "./SignInButton";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-200 ${
        scrolled
          ? "border-b border-[#e8e1cf] bg-[#fafaf7]/80 backdrop-blur-md"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 md:px-8">
        <Logo size={28} />

        <nav className="hidden items-center gap-8 text-[13px] text-[#5a554a] md:flex">
          <a href="#how" className="hover:text-[#111]">
            How it works
          </a>
          <a href="#personas" className="hover:text-[#111]">
            Who it&apos;s for
          </a>
        </nav>

        <SignInButton variant="ghost" label="Sign in" />
      </div>
    </header>
  );
}
