import { requirePageAuth } from "@/lib/page-auth";
import { requireProjectAccess } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { STATUS_LABELS } from "@automation-studio/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewChangeForm } from "./new-change-form";
import { NewProgramForm } from "./new-program-form";
import { IdeShell, IdeSidebar } from "@/components/ide-shell";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const ctx = await requirePageAuth();

  try {
    await requireProjectAccess(ctx, projectId);
  } catch {
    notFound();
  }

  const isStaff = ctx.role === "DEVELOPER" || ctx.role === "ADMIN";

  const project = await db.project.findFirstOrThrow({
    where: { id: projectId, companyId: ctx.company.id },
    include: {
      repository: true,
      changeRequests: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  const cancelledArchive = isStaff
    ? await db.changeRequest.findMany({
        where: {
          projectId: project.id,
          companyId: ctx.company.id,
          status: "CANCELLED",
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
      })
    : [];

  const visibleWork = isStaff
    ? project.changeRequests
    : project.changeRequests.filter((cr) => cr.kind === "PROGRAM");

  const sidebarPrograms = visibleWork
    .filter((cr) => cr.kind === "PROGRAM")
    .map((cr) => ({
      id: cr.id,
      number: cr.number,
      title: cr.title,
      updatedAt: cr.updatedAt,
      status: cr.status,
    }));

  return (
    <IdeShell
      sidebar={
        <IdeSidebar
          programs={sidebarPrograms}
          role={ctx.role}
          newHref={`/projects/${project.id}`}
          projectName={project.name}
        />
      }
    >
      <div className="ide-main-header">
        <div className="ide-main-title">
          <span>{project.name}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-xl space-y-8">
          <section>
            <p className="muted text-[11px] uppercase tracking-[0.08em]">
              Workspace
            </p>
            <h1 className="mt-1 text-[18px] font-medium tracking-tight">
              {project.name}
            </h1>
            {project.description ? (
              <p className="muted mt-2 text-[13px] leading-relaxed">
                {project.description}
              </p>
            ) : null}

            <div className="mt-6">
              {project.repository ? (
                <>
                  <h2 className="text-[13px] font-medium">
                    Chat on this codebase
                  </h2>
                  <p className="muted mt-1 text-[12px] leading-relaxed">
                    Linked repository: {project.repository.githubOwner}/
                    {project.repository.githubRepo}. Describe what to improve;
                    Koda plans against that existing code (not an empty planning
                    repo).
                  </p>
                  <div className="mt-3">
                    <NewProgramForm
                      projectId={project.id}
                      intent="iterate"
                    />
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-[13px] font-medium">New program</h2>
                  <p className="muted mt-1 text-[12px] leading-relaxed">
                    Start a back-and-forth with Koda. Attach docs in chat when
                    ready, then submit to a developer for building.
                  </p>
                  <div className="mt-3">
                    <NewProgramForm projectId={project.id} />
                  </div>
                </>
              )}
            </div>

            {isStaff ? (
              <div className="mt-6">
                <h2 className="text-[13px] font-medium">
                  Request a small change
                </h2>
                <p className="muted mt-1 text-[12px]">
                  Staff only — tweaks to an existing automation.
                </p>
                <div className="mt-3">
                  <NewChangeForm projectId={project.id} />
                </div>
              </div>
            ) : null}
          </section>

          <section>
            <h2 className="text-[13px] font-medium">Your programs</h2>
            <ul className="mt-2 divide-y" style={{ borderColor: "var(--ide-line)" }}>
              {visibleWork.map((cr) => (
                <li key={cr.id}>
                  <Link
                    href={`/change-requests/${cr.id}`}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span className="text-[13px]">
                      #{cr.number} {cr.title}
                      {isStaff ? (
                        <span className="muted ml-2 text-[11px]">
                          {cr.kind === "PROGRAM" ? "Program" : "Change"}
                        </span>
                      ) : null}
                    </span>
                    <span className="status-pill">
                      {STATUS_LABELS[cr.status]}
                    </span>
                  </Link>
                </li>
              ))}
              {visibleWork.length === 0 ? (
                <li className="muted py-3 text-[13px]">No programs yet.</li>
              ) : null}
            </ul>
            {cancelledArchive.length > 0 ? (
              <details className="mt-4">
                <summary className="muted cursor-pointer text-[12px]">
                  Cancelled archive ({cancelledArchive.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {cancelledArchive.map((cr) => (
                    <li key={cr.id}>
                      <Link
                        href={`/change-requests/${cr.id}`}
                        className="ide-list-item opacity-70"
                      >
                        <span className="ide-list-item-title">
                          #{cr.number} {cr.title}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {isStaff && !project.repository ? (
              <p className="mt-4 text-[12px]" style={{ color: "var(--ide-warn)" }}>
                Repository not connected. Link one under Admin before live
                builds or iterate chat.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </IdeShell>
  );
}
