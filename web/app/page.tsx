import { redirect } from "next/navigation";
import { userById } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";

import { TopBar } from "./_landing/TopBar";
import { Hero } from "./_landing/Hero";
import { StatsStrip } from "./_landing/StatsStrip";
import { BuiltOnSui } from "./_landing/BuiltOnSui";
import { Features } from "./_landing/Features";
import { HowItWorks } from "./_landing/HowItWorks";
import { CheckingAccount } from "./_landing/CheckingAccount";
import { Closer } from "./_landing/Closer";
import { LandingFooter } from "./_landing/LandingFooter";

export const dynamic = "force-dynamic";

/**
 * Talise marketing landing — Xend-inspired light mode.
 *
 * Wraps everything in `.landing-light` so the marketing CSS variables
 * shadow the dark app shell only on this page. The in-app routes
 * (/home, /earn, /send, …) keep using the dark `:root` defaults.
 *
 * Signed-in users are redirected to their app surface before render.
 */
async function bootstrap() {
  const id = await readSessionEntryId();
  if (id) {
    const u = await userById(id);
    if (u) {
      const dest =
        u.account_type === "business"
          ? "/business"
          : u.account_type === "personal"
            ? "/home"
            : "/onboarding";
      return { signedIn: true as const, dest };
    }
  }
  return { signedIn: false as const };
}

export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const params = await searchParams;
  const state = await bootstrap();
  if (state.signedIn) redirect(state.dest);

  return (
    <div className="landing-light relative min-h-screen overflow-hidden">
      <TopBar />
      <main>
        <Hero err={params.err} />
        <StatsStrip />
        <BuiltOnSui />
        <Features />
        <HowItWorks />
        <CheckingAccount />
        <Closer />
      </main>
      <LandingFooter />
    </div>
  );
}
