"use client";

import { ClerkProvider } from "@clerk/nextjs";

type ProvidersProps = {
  children: React.ReactNode;
  /** Runtime publishable key from the server layout (avoids build-time NEXT_PUBLIC_ gaps). */
  publishableKey?: string | null;
};

export function Providers({ children, publishableKey }: ProvidersProps) {
  const key =
    publishableKey?.trim() ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
    "";

  if (!key) {
    return <>{children}</>;
  }

  return <ClerkProvider publishableKey={key}>{children}</ClerkProvider>;
}
