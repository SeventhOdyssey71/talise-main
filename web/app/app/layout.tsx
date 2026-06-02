import { redirect } from "next/navigation";
import { resolveAdmin } from "@/lib/admin-auth";
import { readSessionEntryId } from "@/lib/session";
import { userById } from "@/lib/db";
import { AppShell } from "@/components/app/AppShell";
import type { Me } from "@/components/app/data";

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
    }
  }

  return <AppShell me={me}>{children}</AppShell>;
}
