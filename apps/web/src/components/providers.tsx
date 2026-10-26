"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { BlockedRequestNotice } from "@/components/blocked-request-notice";
import { clerkScriptUrl } from "@/lib/clerk-proxy-config";
import { hideCreateOrganizationAppearance } from "@/lib/clerk-org-ui";
import { installBlockedRequestGuard } from "@/lib/blocked-request-guard";

installBlockedRequestGuard();

type ProvidersProps = {
  children: React.ReactNode;
  /** Runtime publishable key from the server layout (avoids build-time NEXT_PUBLIC_ gaps). */
  publishableKey?: string | null;
  /** Same-origin Frontend API proxy, for example https://koda.advancedautomations.net/__clerk */
  proxyUrl?: string | null;
};

export function Providers({ children, publishableKey, proxyUrl }: ProvidersProps) {
  const key =
    publishableKey?.trim() ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
    "";

  if (!key) {
    return <>{children}</>;
  }

  const proxy =
    proxyUrl?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim().replace(/\/+$/, "") ||
    "";

  return (
    <ClerkProvider
      publishableKey={key}
      {...(proxy
        ? { proxyUrl: proxy, clerkJSUrl: clerkScriptUrl(proxy) }
        : {})}
      appearance={hideCreateOrganizationAppearance}
    >
      <BlockedRequestNotice />
      {children}
    </ClerkProvider>
  );
}
