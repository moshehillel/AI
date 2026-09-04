import type { ReactNode } from "react";
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

export type IdeNavProgram = {
  id: string;
  number: number;
  title: string;
  updatedAt: string | Date;
  status: string;
};

function relativeTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function IconPlus() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.5 10.5L13.5 13.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconList() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.5h10M3 8h10M3 11.5h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IdeSidebar({
  programs,
  activeId,
  role,
  newHref = "/projects",
  projectName = "Programs",
}: {
  programs: IdeNavProgram[];
  activeId?: string | null;
  role?: string | null;
  newHref?: string;
  projectName?: string;
}) {
  const isStaff = role === "DEVELOPER" || role === "ADMIN";

  return (
    <aside className="ide-sidebar" aria-label="Programs">
      <div className="ide-sidebar-top">
        <Link href={newHref} className="ide-nav-item">
          <IconPlus />
          New program
        </Link>
        <Link href="/projects" className="ide-nav-item">
          <IconSearch />
          Search
        </Link>
        {isStaff ? (
          <>
            <Link href="/review" className="ide-nav-item">
              <IconList />
              Review queue
            </Link>
            <Link href="/admin" className="ide-nav-item">
              <IconList />
              Admin
            </Link>
          </>
        ) : null}
      </div>

      <div className="ide-nav-section">
        <div className="ide-nav-label">{projectName}</div>
        {programs.map((program) => (
          <Link
            key={program.id}
            href={`/change-requests/${program.id}`}
            className={`ide-list-item ${
              program.id === activeId ? "is-active" : ""
            }`}
          >
            <span className="ide-list-item-title">
              #{program.number} {program.title}
            </span>
            <span className="ide-list-item-meta">
              {relativeTime(program.updatedAt)}
            </span>
          </Link>
        ))}
        {programs.length === 0 ? (
          <p className="muted px-2 py-2 text-xs">No programs yet.</p>
        ) : null}
      </div>

      <div className="ide-sidebar-foot">
        <Link href="/projects" className="ide-brand">
          Koda
        </Link>
        <div className="flex items-center gap-2">
          {isStaff ? <span className="status-pill">Dev</span> : null}
          {hideAuthChrome || !clerkEnabled ? null : (
            <>
              <SignedIn>
                <OrganizationSwitcher
                  hidePersonal
                  afterCreateOrganizationUrl="/projects"
                  afterSelectOrganizationUrl="/projects"
                  appearance={{
                    elements: {
                      rootBox: { flexShrink: 0, maxWidth: "7.5rem" },
                      organizationSwitcherTrigger: { maxWidth: "7.5rem" },
                    },
                  }}
                />
                <UserButton
                  afterSignOutUrl="/"
                  appearance={{
                    elements: {
                      rootBox: { flexShrink: 0 },
                      avatarBox: {
                        width: "1.75rem",
                        height: "1.75rem",
                        outline: "1px solid var(--ide-chrome-line)",
                      },
                    },
                  }}
                />
              </SignedIn>
              <SignedOut>
                <Link className="btn btn-ghost" href="/sign-in">
                  Sign in
                </Link>
              </SignedOut>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

export function IdeShell({
  sidebar,
  children,
  right,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      className={right ? "ide-shell ide-shell-with-right" : "ide-shell"}
    >
      {sidebar}
      <div className="ide-main">{children}</div>
      {right ? (
        <aside className="ide-right" aria-label="Plan and context">
          {right}
        </aside>
      ) : null}
    </div>
  );
}
