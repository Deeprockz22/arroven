import type { Metadata } from "next";
import { Barlow_Condensed, JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

const barlow = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow" });
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public" });
const jet = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jet" });

export const metadata: Metadata = {
  title: { default: "ARROVEN", template: "%s · ARROVEN" },
  description: "Engineer-controlled investigation workspace for recurring and unresolved aircraft technical faults.",
  // A private workspace: keep every page out of search engines.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${publicSans.variable} ${jet.variable}`}>
      <body>{children}</body>
    </html>
  );
}
