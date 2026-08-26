"use client";

import { ClerkProvider } from "@clerk/nextjs";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function Providers({ children }: { children: React.ReactNode }) {
  if (!clerkEnabled) {
    return <>{children}</>;
  }
  return <ClerkProvider>{children}</ClerkProvider>;
}
