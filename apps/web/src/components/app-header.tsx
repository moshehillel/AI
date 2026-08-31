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

/** Compact top bar for staff/admin pages outside the IDE shell. */
export function AppHeader({ role }: { role?: string | null }) {
  const isStaff = role === "DEVELOPER" || role === "ADMIN";

  return (
    <header
      className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-3"
      style={{ borderColor: "var(--ide-line)" }}
    >
      <div className="flex items-center gap-5">
        <Link href="/projects" className="ide-brand">
          Koda
        </Link>
        <nav className="flex flex-wrap gap-3 text-[13px]" style={{ color: "var(--ide-muted)" }}>
          <Link href="/projects">Programs</Link>
          {isStaff ? <Link href="/review">Review</Link> : null}
          {isStaff ? <Link href="/usage">Usage</Link> : null}
          {isStaff ? <Link href="/admin">Admin</Link> : null}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {isStaff ? <span className="status-pill">Developer mode</span> : null}
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
