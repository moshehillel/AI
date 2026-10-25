"use client";

import { useClerk } from "@clerk/nextjs";
import { useState } from "react";

const clerkEnabled = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
);
const hideAuthChrome = process.env.NEXT_PUBLIC_OPEN_ACCESS === "1";

/**
 * Text Sign out control. Rendered outside Clerk's SignedIn gate so the
 * button is in the page even before the avatar menu hydrates.
 */
export function AccountSignOut({
  className = "onboard-signout",
}: {
  className?: string;
}) {
  if (hideAuthChrome || !clerkEnabled) return null;
  return <AccountSignOutButton className={className} />;
}

function AccountSignOutButton({ className }: { className: string }) {
  const { signOut } = useClerk();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signOut({ redirectUrl: "/sign-in" }).catch(() => {
          setPending(false);
        });
      }}
    >
      Sign out
    </button>
  );
}
