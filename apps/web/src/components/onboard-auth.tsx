"use client";

import Link from "next/link";
import {
  OrganizationSwitcher,
  SignedIn,
  SignedOut,
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
    <>
      <SignedIn>
        <OrganizationSwitcher
          hidePersonal
          afterCreateOrganizationUrl="/projects"
          afterSelectOrganizationUrl="/projects"
        />
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
      <SignedOut>
        <Link className="onboard-btn onboard-btn-compact" href="/sign-in">
          Sign in
        </Link>
      </SignedOut>
    </>
  );
}
