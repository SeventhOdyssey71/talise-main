import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

// DM Sans drives the entire site — body, headings, and CTAs.
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

// Mono for addresses, code, and stat values.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Instrument Serif (italic) — used sparingly for emphasis inside headlines.
// e.g. "Send money home. Almost <em>free</em>." The italic style is what
// gives Reflect-style hero copy its premium feel.
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["italic", "normal"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Talise - Smart Payments",
  description:
    "Smart payments on Sui. Send USDsui and SUI in one tap. Pay merchants. Earn yield on DeepBook. Sign in with Google. No bank. No seed phrase.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"),
  icons: { icon: "/icon.png" },
  openGraph: {
    title: "Talise - Smart Payments",
    description:
      "Smart payments on Sui. USDsui and SUI in one account. Pay merchants. Earn on DeepBook.",
    type: "website",
    siteName: "Talise",
  },
  twitter: {
    card: "summary_large_image",
    title: "Talise - Smart Payments",
    description:
      "Smart payments on Sui. Sign in with Google. No bank. No seed phrase.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${mono.variable} ${serif.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
