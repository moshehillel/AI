"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  OrganizationSwitcher,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";

const clerkEnabled = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
);
const demoAuth = process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH === "1";
const openAccess = process.env.NEXT_PUBLIC_OPEN_ACCESS === "1";

function setDemoUser(role: string) {
  document.cookie = `demo_user=${role}; path=/; max-age=604800; SameSite=Lax`;
}

export function AppHeader({ role }: { role?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
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
        {openAccess ? null : role ? (
          <span className="status-pill">{role}</span>
        ) : null}
        {openAccess ? null : demoAuth || !clerkEnabled ? (
          <select
            className="field max-w-40 py-2"
            defaultValue={(role ?? "EMPLOYEE").toLowerCase()}
            onChange={(event) => {
              setDemoUser(event.target.value);
              router.push(pathname);
              router.refresh();
            }}
            aria-label="Demo role"
          >
            <option value="employee">Employee</option>
            <option value="developer">Developer</option>
            <option value="admin">Admin</option>
          </select>
        ) : (
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
