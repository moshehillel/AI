"use client";

import Link from "next/link";
import {
  OrganizationSwitcher,
  SignedIn,
  SignedOut,
  SignOutButton,
  UserButton,
} from "@clerk/nextjs";

const clerkEnabled = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
);
const hideAuthChrome = process.env.NEXT_PUBLIC_OPEN_ACCESS === "1";

/** Clerk user menu for the onboard /projects chrome (all roles, including EMPLOYEE). */
export function OnboardAuth() {
  if (hideAuthChrome || !clerkEnabled) return null;

  return (
    <div className="onboard-auth">
      <SignedIn>
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/projects"
          appearance={{
            elements: {
              rootBox: { flexShrink: 0 },
              organizationSwitcherTrigger: {
                color: "#e8eef7",
                backgroundColor: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(232,238,247,0.18)",
                borderRadius: "10px",
                padding: "0.35rem 0.55rem",
                maxWidth: "11rem",
              },
              organizationSwitcherPopoverActionButton__createOrganization: {
                display: "none",
              },
            },
          }}
        />
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              rootBox: { flexShrink: 0 },
              avatarBox: {
                width: "2rem",
                height: "2rem",
                outline: "2px solid rgba(232,238,247,0.35)",
              },
              userButtonPopoverCard: { zIndex: 100 },
            },
          }}
        />
        <SignOutButton>
          <button type="button" className="onboard-signout">
            Sign out
          </button>
        </SignOutButton>
      </SignedIn>
      <SignedOut>
        <Link className="onboard-btn onboard-btn-compact" href="/sign-in">
          Sign in
        </Link>
      </SignedOut>
    </div>
  );
}
