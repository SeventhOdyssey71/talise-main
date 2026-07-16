import { Hanken_Grotesk, DM_Sans } from "next/font/google";
import { readSessionEntryId } from "@/lib/session";
import { userById, isAppAccessAllowed } from "@/lib/db";
import { PerpsChrome } from "@/components/app/markets/PerpsChrome";
import { PerpsGate } from "@/components/app/markets/PerpsGate";

export const dynamic = "force-dynamic";

// Same type system as the app / v2 landing so Perps reads as one product.
const display = Hanken_Grotesk({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display-v2", display: "swap" });
const sans = DM_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-sans-v2", display: "swap" });

/**
 * /perps — dedicated Talise Perps surface (served at perps.talise.io via
 * middleware host-routing). Its own focused chrome + the same access gate as
 * /app: signed-in + beta-allowed users get the terminal; everyone else gets the
 * sign-in / waiting screen.
 */
export default async function PerpsLayout({ children }: { children: React.ReactNode }) {
  let me: { name: string | null; picture: string | null } | null = null;
  let blocked = false;

  const id = await readSessionEntryId();
  if (id != null) {
    const u = await userById(id).catch(() => null);
    if (u) {
      if (await isAppAccessAllowed(u.email)) {
        me = { name: u.name, picture: u.picture };
      } else {
        blocked = true;
        me = { name: u.name, picture: u.picture };
      }
    }
  }

  return (
    <div
      className={`${display.variable} ${sans.variable} relative min-h-screen overflow-x-hidden`}
      style={{
        fontFamily: "var(--font-sans-v2), system-ui, sans-serif",
        color: "#15300c",
        background: "radial-gradient(120% 90% at 12% -5%, #e6f9d6 0%, #f7fcf2 46%, #ffeede 100%)",
      }}
    >
      {me && !blocked ? (
        <PerpsChrome me={me}>{children}</PerpsChrome>
      ) : (
        <PerpsGate blocked={blocked} name={me?.name ?? null} />
      )}
    </div>
  );
}
