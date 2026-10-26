import type { Metadata } from "next";
import { headers } from "next/headers";
import { Providers } from "@/components/providers";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import { clerkProxyUrlFromHeaders } from "@/lib/clerk-proxy-config";
import "./globals.css";

// Clerk / demo auth keys live on the host at runtime. Keep the root layout
// dynamic so Providers always receives the live publishable key (Docker builds
// may not have had NEXT_PUBLIC_CLERK_* baked in).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Koda — Advanced Automations AI Builder",
  description:
    "Koda plans, builds, and ships business automations with AI — developers stay in control of production.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const headerList = await headers();
  const proxyUrl = clerkProxyUrlFromHeaders({
    forwardedHost: headerList.get("x-forwarded-host"),
    host: headerList.get("host"),
    forwardedProto: headerList.get("x-forwarded-proto"),
  });

  return (
    <html lang="en">
      <body className="studio-shell">
        <Providers publishableKey={publishableKey} proxyUrl={proxyUrl}>
          {children}
          <AiDisclaimer />
        </Providers>
      </body>
    </html>
  );
}
