export const dynamic = "force-dynamic";
import { requirePageAuth } from "@/lib/page-auth";
import { db } from "@automation-studio/db";
import { STATUS_LABELS } from "@automation-studio/domain";
import Link from "next/link";
import { NewProgramForm } from "./[projectId]/new-program-form";
import { IdeShell, IdeSidebar } from "@/components/ide-shell";

const ONBOARDING_SLUG = "customer-onboarding";

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
    <IdeShell
      sidebar={
        <IdeSidebar
          programs={activePrograms}
          role={ctx.role}
          newHref="/projects"
          projectName={onboardingProject?.name ?? "Programs"}
        />
      }
    >
      <div className="ide-main-header">
        <div className="ide-main-title">
          <span>Koda · Customer onboarding</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-xl space-y-8">
          <section>
            <h1 className="text-[18px] font-medium tracking-tight">
              New program
            </h1>
            <p className="muted mt-2 text-[13px] leading-relaxed">
              Start a planning chat with Koda. Answer questions one at a time,
              refine the living plan, then submit when you&apos;re ready for a
              developer.
            </p>
            {onboardingProject ? (
              <div className="mt-4">
                <NewProgramForm projectId={onboardingProject.id} />
              </div>
            ) : (
              <p className="muted mt-4 text-[13px]">
                No workspace is available yet. Ask an admin to grant access to
                customer onboarding.
              </p>
            )}
          </section>

          <section>
            <h2 className="text-[13px] font-medium">Your programs</h2>
            <ul className="mt-3 divide-y" style={{ borderColor: "var(--ide-line)" }}>
              {activePrograms.map((cr) => (
                <li key={cr.id}>
                  <Link
                    href={`/change-requests/${cr.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 transition hover:bg-[var(--ide-bg-hover)]"
                  >
                    <span className="text-[13px]">
                      #{cr.number} {cr.title}
                    </span>
                    <span className="status-pill">
                      {STATUS_LABELS[cr.status]}
                    </span>
                  </Link>
                </li>
              ))}
              {activePrograms.length === 0 ? (
                <li className="muted py-3 text-[13px]">
                  No programs yet. Start one above.
                </li>
              ) : null}
            </ul>
          </section>

          {isStaff ? (
            <section>
              <h2 className="ide-right-label">Staff · workspaces</h2>
              <div className="mt-2 space-y-1">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="ide-list-item"
                  >
                    <span className="ide-list-item-title">{project.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </IdeShell>
  );
}
