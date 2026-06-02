import { redirect } from "next/navigation";
import { resolveAdmin } from "@/lib/admin-auth";
import { readSessionEntryId } from "@/lib/session";
import { userById } from "@/lib/db";
import { readBalanceSnapshot } from "@/lib/snapshots";
import { AppShell } from "@/components/app/AppShell";
import type { Me, Balances } from "@/components/app/data";

export const dynamic = "force-dynamic";

/**
 * /app shell + gate.
 *
 * Same posture as /admin: admin-only in production, open in local dev (the
 * `resolveAdmin` dev-open escape hatch). Non-admins are bounced to the admin
 * login. Inside the gate we resolve the signed-in user (if any) into the
 * `Me` shape AppShell expects; a null `me` makes AppShell render its
 * Continue-with-Google sign-in screen.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await resolveAdmin())) {
    redirect("/admin/login");
  }

  let me: Me | null = null;
  let initialBalances: Balances | null = null;
  const id = await readSessionEntryId();
  if (id != null) {
    const u = await userById(id).catch(() => null);
    if (u) {
      me = {
        id: String(u.id),
        email: u.email,
        name: u.name,
        picture: u.picture,
        country: u.country,
        suiAddress: u.sui_address,
        taliseHandle: u.talise_username,
        accountType: u.account_type ?? "personal",
      };
      // Seed the balance from the display snapshot so the dashboard paints the
      // real number on first byte — no client round-trip, no skeleton flash.
      // (Display-only; the client still revalidates fresh against chain.)
      const snap = await readBalanceSnapshot(id).catch(() => null);
      if (snap) {
        initialBalances = {
          address: snap.suiAddress,
          usdsui: snap.usdsui,
          sui: snap.sui,
          suiPriceUsd: snap.suiPriceUsd,
          totalUsd: snap.totalUsd,
          refreshedAt: snap.refreshedAt,
          stale: true,
        };
      }
    }
  }

  return (
    <AppShell me={me} initialBalances={initialBalances}>
      {children}
    </AppShell>
  );
}
