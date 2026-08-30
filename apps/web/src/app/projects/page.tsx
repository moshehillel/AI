export const dynamic = "force-dynamic";
import { AppHeader } from "@/components/app-header";
import { requirePageAuth } from "@/lib/page-auth";
import { db } from "@automation-studio/db";
import { STATUS_LABELS } from "@automation-studio/domain";
import Link from "next/link";
import { NewProgramForm } from "./[projectId]/new-program-form";

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
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AppHeader role={ctx.role} />

      <section className="relative overflow-hidden rise">
        <div className="hero-grid opacity-40" aria-hidden />
        <div className="relative z-10 max-w-3xl">
          <p
            className="brand-mark text-5xl leading-none md:text-6xl"
            style={{ animationDelay: "40ms" }}
          >
            Koda
          </p>
          <h1
            className="rise mt-4 text-2xl font-medium leading-snug text-[var(--accent-soft)] md:text-3xl"
            style={{ animationDelay: "100ms" }}
          >
            Customer onboarding
          </h1>
          <p
            className="muted rise mt-3 max-w-xl text-base leading-relaxed"
            style={{ animationDelay: "160ms" }}
          >
            Start a new program. Koda asks questions one at a time, drafts a
            plan with you, then a developer builds it when you&apos;re ready.
          </p>
        </div>
      </section>

      <section className="rise mt-10 grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="panel p-6 md:p-8">
          <h2 className="text-xl">New program</h2>
          <p className="muted mt-2 text-sm">
            Name what you want to automate — or leave a short note and let Koda
            lead the conversation.
          </p>
          {onboardingProject ? (
            <div className="mt-5">
              <NewProgramForm projectId={onboardingProject.id} />
            </div>
          ) : (
            <p className="muted mt-5 text-sm">
              No workspace is available yet. Ask an admin to grant access to
              customer onboarding.
            </p>
          )}
        </div>

        <div className="panel p-6">
          <h2 className="text-lg">Your programs</h2>
          <p className="muted mt-1 text-sm">
            Active plans and builds — cancelled items stay hidden.
          </p>
          <ul className="mt-4 space-y-3">
            {activePrograms.map((cr) => (
              <li key={cr.id}>
                <Link
                  href={`/change-requests/${cr.id}`}
                  className="block rounded-xl border border-[var(--line)] p-3 transition hover:bg-white/5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      #{cr.number} {cr.title}
                    </span>
                    <span className="status-pill">
                      {STATUS_LABELS[cr.status]}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
            {activePrograms.length === 0 ? (
              <li className="muted text-sm">
                No programs yet. Start one on the left.
              </li>
            ) : null}
          </ul>
        </div>
      </section>

      {isStaff ? (
        <section className="rise mt-10">
          <h2 className="text-sm uppercase tracking-[0.18em] muted">
            Staff · workspaces
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="rounded-xl border border-[var(--line)] p-4 text-sm transition hover:bg-white/5"
              >
                <span className="font-medium">{project.name}</span>
                <p className="muted mt-1 text-xs leading-relaxed">
                  {project.description ?? "Workspace"}
                </p>
              </Link>
            ))}
            {projects.length === 0 ? (
              <p className="muted text-sm">No workspaces yet.</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
