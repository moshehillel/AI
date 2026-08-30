import type { Metadata } from "next";
import { Fraunces, Outfit } from "next/font/google";
import { Providers } from "@/components/providers";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Outfit({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Koda — Advanced Automations AI Builder",
  description:
    "Koda plans, builds, and ships business automations with AI — developers stay in control of production.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} studio-shell`}>
        <Providers>
          {children}
          <AiDisclaimer />
        </Providers>
      </body>
    </html>
  );
}
