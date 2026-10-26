export const dynamic = "force-dynamic";
import { requirePageAuth } from "@/lib/page-auth";
import { db } from "@automation-studio/db";
import { STATUS_LABELS } from "@automation-studio/domain";
import Link from "next/link";
import { Space_Grotesk, Manrope } from "next/font/google";
import { AccountSignOut } from "@/components/account-sign-out";
import { OnboardAuth } from "@/components/onboard-auth";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-onboard-display",
});

const body = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-onboard-body",
});

export default async function ProjectsPage() {
  const ctx = await requirePageAuth();
  const isAdmin = ctx.role === "ADMIN";
  const isStaff = ctx.role === "DEVELOPER" || ctx.role === "ADMIN";
  const isEmployee = ctx.role === "EMPLOYEE";

  const assignedProjects = await db.project.findMany({
    where: {
      companyId: ctx.company.id,
      status: "ACTIVE",
      members: { some: { userId: ctx.user.id } },
    },
    include: { repository: true },
    orderBy: { name: "asc" },
  });

  const staffProjects = isStaff
    ? await db.project.findMany({
        where: { companyId: ctx.company.id, status: "ACTIVE" },
        include: { repository: true },
        orderBy: { name: "asc" },
      })
    : [];

  const visibleProjects = isEmployee ? assignedProjects : staffProjects;
  const waitingForAssignment = isEmployee && assignedProjects.length === 0;

  const activePrograms = await db.changeRequest.findMany({
    where: {
      companyId: ctx.company.id,
      kind: "PROGRAM",
      status: { not: "CANCELLED" },
      projectId: { in: visibleProjects.map((project) => project.id) },
    },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return (
    <div className={`onboard ${display.variable} ${body.variable}`}>
      <div className="onboard-atmosphere" aria-hidden>
        <div className="onboard-glow onboard-glow-a" />
        <div className="onboard-glow onboard-glow-b" />
        <div className="onboard-grid" />
        <div className="onboard-cubes" />
      </div>

      <header className="onboard-top">
        <div className="onboard-top-brand">
          <picture>
            <source srcSet="/brand/AA-Logo.webp" type="image/webp" />
            <img
              src="/brand/AA-Logo.png"
              alt="Advanced Automations"
              className="onboard-top-logo"
              width={48}
              height={48}
            />
          </picture>
          <span className="onboard-top-name">Advanced Automations</span>
        </div>
        <div className="onboard-top-actions">
          <AccountSignOut />
          <nav className="onboard-top-nav">
            {isStaff ? (
              <>
                <Link href="/admin">Admin</Link>
                <Link href="/staff">Staff</Link>
              </>
            ) : null}
            <OnboardAuth />
          </nav>
        </div>
      </header>

      <section className="onboard-hero">
        <div className="onboard-hero-visual rise" style={{ animationDelay: "40ms" }}>
          <picture>
            <source srcSet="/brand/AA-Logo.webp" type="image/webp" />
            <img
              src="/brand/AA-Logo.png"
              alt="Advanced Automations"
              className="onboard-hero-logo"
              width={720}
              height={720}
              fetchPriority="high"
            />
          </picture>
        </div>

        <div className="onboard-hero-copy">
          <p className="onboard-koda rise" style={{ animationDelay: "100ms" }}>
            Koda
          </p>
          <h1
            className="onboard-headline rise"
            style={{ animationDelay: "160ms" }}
          >
            {isAdmin
              ? "Open a project, then assign who builds it."
              : waitingForAssignment
                ? "A project has not been opened for you yet."
                : "Your projects"}
          </h1>
          <p className="onboard-lead rise" style={{ animationDelay: "220ms" }}>
            {isAdmin
              ? "Only an admin can open a project and assign a user. They chat with Koda there to plan and build it."
              : waitingForAssignment
                ? "Ask an admin to open a project for you. After you are assigned, you can chat there to plan and build it."
                : "Open a project below and chat there to change it. You stay in the project an admin opened for you."}
          </p>

          {isAdmin ? (
            <div className="onboard-cta rise" style={{ animationDelay: "280ms" }}>
              <Link className="onboard-btn" href="/admin#open-project">
                Open a project and assign a user
              </Link>
            </div>
          ) : null}
          <p className="onboard-teaser rise" style={{ animationDelay: "320ms" }}>
            <span className="onboard-teaser-label">Coming soon</span>
            — a full version of Koda: build your own advanced automations without
            knowing anything.
          </p>
        </div>
      </section>

      <section className="onboard-below" id="programs">
        <div className="onboard-below-inner">
          <h2 className="onboard-below-title">Your programs</h2>
          <ul className="onboard-program-list">
            {activePrograms.map((cr) => (
              <li key={cr.id}>
                <Link
                  href={`/change-requests/${cr.id}`}
                  className="onboard-program-link"
                >
                  <span>
                    #{cr.number} {cr.title}
                    {cr.project?.name ? ` · ${cr.project.name}` : ""}
                  </span>
                  <span className="onboard-program-status">
                    {STATUS_LABELS[cr.status]}
                  </span>
                </Link>
              </li>
            ))}
            {activePrograms.length === 0 ? (
              <li className="onboard-empty">
                {waitingForAssignment
                  ? "Ask an admin to open a project for you."
                  : "No chats yet. An admin has to open the chat inside your project."}
              </li>
            ) : null}
          </ul>

          {isEmployee && assignedProjects.length > 0 ? (
            <div className="onboard-staff">
              <h2 className="onboard-below-title">Your workspaces</h2>
              <p className="onboard-empty" style={{ marginBottom: "0.75rem" }}>
                Projects an admin opened for you. Open one and use its chat to change it.
              </p>
              <div className="onboard-staff-list">
                {assignedProjects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="onboard-program-link"
                  >
                    <span>{project.name}</span>
                    <span className="onboard-program-status">
                      {project.repository
                        ? `${project.repository.githubOwner}/${project.repository.githubRepo}`
                        : "Planning"}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {waitingForAssignment ? (
            <p className="onboard-empty" style={{ marginTop: "1.5rem" }}>
              Ask an admin to open a project for you. You will see it here, and
              then you can chat there to plan and build it.
            </p>
          ) : null}

          {isStaff ? (
            <div className="onboard-staff">
              <h2 className="onboard-below-title">Staff · workspaces</h2>
              <div className="onboard-staff-list">
                {staffProjects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="onboard-program-link"
                  >
                    <span>{project.name}</span>
                    <span className="onboard-program-status">
                      {project.repository
                        ? `${project.repository.githubOwner}/${project.repository.githubRepo}`
                        : "No repo"}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
