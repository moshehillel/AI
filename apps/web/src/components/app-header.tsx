"use client";

import Link from "next/link";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function AppHeader({ role }: { role?: string | null }) {
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-6">
        <Link href="/projects" className="brand-mark text-2xl">
          Automation Studio
        </Link>
        <nav className="flex gap-4 text-sm muted">
          <Link href="/projects">Projects</Link>
          <Link href="/review">Review queue</Link>
          <Link href="/admin">Admin</Link>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {role ? <span className="status-pill">{role}</span> : null}
        <span className="status-pill">
          {clerkEnabled ? "Signed in" : "Demo mode"}
        </span>
      </div>
    </header>
  );
}
