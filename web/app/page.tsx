import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { FeatureRow } from "@/components/FeatureRow";
import { PartnerStrip } from "@/components/PartnerStrip";
import { StatStrip } from "@/components/StatStrip";
import { ProblemSection } from "@/components/ProblemSection";
import { PillarCards } from "@/components/PillarCards";
import { PersonaCards } from "@/components/PersonaCards";
import { FinalCTA } from "@/components/FinalCTA";
import { SiteFooter } from "@/components/SiteFooter";
import { userById } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";

export const dynamic = "force-dynamic";

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
    <>
      <Nav />
      <main>
        <Hero errorCode={params.err} />
        <FeatureRow />
        <PartnerStrip />
        <PillarCards />
        <StatStrip />
        <PersonaCards />
        <ProblemSection />
        <FinalCTA />
      </main>
      <SiteFooter />
    </>
  );
}
