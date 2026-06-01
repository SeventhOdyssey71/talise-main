import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { AppShell, navForAccount } from "@/components/AppShell";
import { ChatView } from "@/components/ChatView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /chat — full-page conversational view of the Talise agent.
 *
 * Lives in the sidebar nav as "Talise". Replaces the older floating chat
 * pill on /home — there's now exactly one place to find the agent, and
 * it gets the full viewport (with the sidebar still visible for context
 * switching).
 */
export default async function ChatPage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext={user.account_type === "business" ? "business" : "personal"}
      hasBusinessContext={hasBusiness(user)}
      navItems={navForAccount(user.account_type, "/chat")}
      pageEyebrow="Assistant"
      pageTitle="Talise"
      pageHeaderRight={
        <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)] md:flex">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#21A179]" />
          DeepSeek · Memwal
        </div>
      }
    >
      <ChatView />
    </AppShell>
  );
}
