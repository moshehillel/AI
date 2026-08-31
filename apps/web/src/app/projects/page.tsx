export const dynamic = "force-dynamic";
import { requirePageAuth } from "@/lib/page-auth";
import { db } from "@automation-studio/db";
import { STATUS_LABELS } from "@automation-studio/domain";
import Link from "next/link";
import { Space_Grotesk, Manrope } from "next/font/google";
import { NewProgramForm } from "./[projectId]/new-program-form";

const ONBOARDING_SLUG = "customer-onboarding";

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
  const isStaff = ctx.role === "DEVELOPER" || ctx.role === "ADMIN";
  const isEmployee = ctx.role === "EMPLOYEE";

  const projectFilter = {
    companyId: ctx.company.id,
    status: "ACTIVE" as const,
    ...(isEmployee
      ? { members: { some: { userId: ctx.user.id } } }
      : {}),
  };

  const projects = await db.project.findMany({
    where: projectFilter,
    orderBy: { name: "asc" },
  });

  const onboardingProject =
    projects.find((p) => p.slug === ONBOARDING_SLUG) ?? projects[0] ?? null;

  const activePrograms = onboardingProject
    ? await db.changeRequest.findMany({
        where: {
          companyId: ctx.company.id,
          projectId: onboardingProject.id,
          kind: "PROGRAM",
          status: { not: "CANCELLED" },
          ...(isEmployee ? { createdById: ctx.user.id } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
      })
    : [];

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
        {isStaff ? (
          <nav className="onboard-top-nav">
            <Link href="/admin">Admin</Link>
            <Link href="/staff">Staff</Link>
          </nav>
        ) : null}
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
            Plan your next automation with Advanced Automations.
          </h1>
          <p className="onboard-lead rise" style={{ animationDelay: "220ms" }}>
            Tell Koda what to build. Answer a few questions, refine the plan,
            then ship with developer approval.
          </p>

          <div className="onboard-cta rise" style={{ animationDelay: "280ms" }}>
            {onboardingProject ? (
              <NewProgramForm projectId={onboardingProject.id} variant="hero" />
            ) : (
              <p className="onboard-empty">
                No workspace is available yet. Ask an admin to grant access to
                customer onboarding.
              </p>
            )}
          </div>
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
                  </span>
                  <span className="onboard-program-status">
                    {STATUS_LABELS[cr.status]}
                  </span>
                </Link>
              </li>
            ))}
            {activePrograms.length === 0 ? (
              <li className="onboard-empty">
                No programs yet. Start one above to open the planning chat.
              </li>
            ) : null}
          </ul>

          {isStaff ? (
            <div className="onboard-staff">
              <h2 className="onboard-below-title">Staff · workspaces</h2>
              <div className="onboard-staff-list">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="onboard-program-link"
                  >
                    <span>{project.name}</span>
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
