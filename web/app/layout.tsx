import type { Metadata } from "next";
import { JetBrains_Mono, Instrument_Serif } from "next/font/google";
// Google Sans Variable, self-hosted via @fontsource. Google's marketing
// font isn't on the public Google Fonts API, but Fontsource ships an
// OFL-1.1 build — same weights, same shapes, distributable.
import "@fontsource-variable/google-sans/index.css";
import "./globals.css";

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
      className={`${mono.variable} ${serif.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
