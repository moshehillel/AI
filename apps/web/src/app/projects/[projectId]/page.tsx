import { AppHeader } from "@/components/app-header";
import { requirePageAuth } from "@/lib/page-auth";
import { requireProjectAccess } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { STATUS_LABELS } from "@automation-studio/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewChangeForm } from "./new-change-form";
import { NewProgramForm } from "./new-program-form";

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

  const project = await db.project.findFirstOrThrow({
    where: { id: projectId, companyId: ctx.company.id },
    include: {
      repository: true,
      changeRequests: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  const isStaff = ctx.role === "DEVELOPER" || ctx.role === "ADMIN";

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AppHeader role={ctx.role} />
      <section className="rise grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="muted text-sm uppercase tracking-[0.18em]">Workspace</p>
          <h1 className="brand-mark mt-2 text-4xl">{project.name}</h1>
          <p className="muted mt-3 max-w-xl">{project.description}</p>

          <div className="mt-8 panel p-6">
            <h2 className="text-xl">New program</h2>
            <p className="muted mt-2 text-sm">
              Start a back-and-forth with Koda. Answer questions as they come —
              attach docs in chat when ready — then submit to a developer for
              building.
            </p>
            <div className="mt-4">
              <NewProgramForm projectId={project.id} />
            </div>
          </div>

          <div className="mt-6 panel p-6">
            <h2 className="text-lg">Or request a small change</h2>
            <p className="muted mt-2 text-sm">
              For tweaks to an existing automation.
            </p>
            <div className="mt-4">
              <NewChangeForm projectId={project.id} />
            </div>
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="text-lg">Recent work</h2>
          <ul className="mt-4 space-y-3">
            {project.changeRequests.map((cr) => (
              <li key={cr.id}>
                <Link
                  href={`/change-requests/${cr.id}`}
                  className="block rounded-xl border border-[var(--line)] p-3 hover:bg-white/5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      #{cr.number} {cr.title}
                    </span>
                    <span className="status-pill">
                      {STATUS_LABELS[cr.status]}
                    </span>
                  </div>
                  <p className="muted mt-1 text-xs">
                    {cr.kind === "PROGRAM" ? "Program" : "Change"}
                  </p>
                </Link>
              </li>
            ))}
            {project.changeRequests.length === 0 ? (
              <li className="muted text-sm">No programs yet.</li>
            ) : null}
          </ul>
          {isStaff ? (
            !project.repository ? (
              <p className="mt-6 text-sm text-[var(--warn)]">
                Repository not connected. Link one under Admin before live
                builds.
              </p>
            ) : (
              <p className="muted mt-6 text-sm">
                Connected repository: {project.repository.githubOwner}/
                {project.repository.githubRepo}
              </p>
            )
          ) : null}
        </div>
      </section>
    </main>
  );
}
