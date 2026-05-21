import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { userById } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { OnboardingFlow } from "@/components/OnboardingFlow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (user.account_type === "personal") redirect("/home");
  if (user.account_type === "business") redirect("/business");

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--color-line)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5 md:px-10">
          <Logo size={26} />
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="text-[12px] text-[var(--color-fg-dim)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
            >
              sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 pt-16 pb-24 md:px-10">
        <div className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
          Welcome, {displayName(user.name)}
        </div>
        <h1 className="mt-2 text-[32px] font-medium leading-[1.05] tracking-[-0.03em] md:text-[44px]">
          How will you use Talise?
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-[1.6] text-[var(--color-fg-muted)] md:text-[14px]">
          One pick. You can&apos;t change it without contacting us, so think
          for a second. The interface is built differently for each.
        </p>

        <div className="mt-12">
          <OnboardingFlow />
        </div>
      </section>
    </main>
  );
}

function displayName(raw: string | null | undefined): string {
  const n = (raw ?? "").trim().split(/\s+/)[0];
  if (!n) return "friend";
  return n[0].toUpperCase() + n.slice(1).toLowerCase();
}
