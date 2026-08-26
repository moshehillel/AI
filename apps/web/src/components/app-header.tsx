"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const demoAuth = process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH === "1";

function setDemoUser(role: string) {
  document.cookie = `demo_user=${role}; path=/; max-age=604800; SameSite=Lax`;
}

export function AppHeader({ role }: { role?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-6">
        <Link href="/projects" className="brand-mark text-2xl">
          Automation Studio
        </Link>
        <nav className="flex gap-4 text-sm muted">
          <Link href="/projects">Projects</Link>
          <Link href="/review">Review queue</Link>
          <Link href="/usage">Usage</Link>
          <Link href="/admin">Admin</Link>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {role ? <span className="status-pill">{role}</span> : null}
        {demoAuth || !clerkEnabled ? (
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
          <span className="status-pill">Signed in</span>
        )}
      </div>
    </header>
  );
}
