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

export function AppHeader({ role }: { role?: string | null }) {
  const isStaff = role === "DEVELOPER" || role === "ADMIN";

  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-6">
        <Link href="/projects" className="brand-mark text-2xl">
          Koda
        </Link>
        <nav className="flex flex-wrap gap-4 text-sm muted">
          <Link href="/projects">Onboarding</Link>
          {isStaff ? <Link href="/review">Review queue</Link> : null}
          {isStaff ? <Link href="/usage">Usage</Link> : null}
          {isStaff ? <Link href="/admin">Admin</Link> : null}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {hideAuthChrome || !clerkEnabled ? null : (
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
              <Link className="btn btn-ghost" href="/sign-in">
                Sign in
              </Link>
            </SignedOut>
          </>
        )}
      </div>
    </header>
  );
}
