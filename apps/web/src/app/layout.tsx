import type { Metadata } from "next";
import { Fraunces, Outfit } from "next/font/google";
import { Providers } from "@/components/providers";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import "./globals.css";

// Clerk / demo auth keys live on the host at runtime. Keep the root layout
// dynamic so Providers always receives the live publishable key (Docker builds
// may not have had NEXT_PUBLIC_CLERK_* baked in).
export const dynamic = "force-dynamic";

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
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} studio-shell`}>
        <Providers publishableKey={publishableKey}>
          {children}
          <AiDisclaimer />
        </Providers>
      </body>
    </html>
  );
}
