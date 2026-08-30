export const dynamic = "force-dynamic";
import { AppHeader } from "@/components/app-header";
import { requirePageAuth } from "@/lib/page-auth";
import { db } from "@automation-studio/db";
import Link from "next/link";

export default async function ProjectsPage() {
  const ctx = await requirePageAuth();
  const projects = await db.project.findMany({
    where: {
      companyId: ctx.company.id,
      status: "ACTIVE",
      ...(ctx.role === "EMPLOYEE"
        ? { members: { some: { userId: ctx.user.id } } }
        : {}),
    },
    orderBy: { name: "asc" },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AppHeader role={ctx.role} />
      <section className="rise">
        <h1 className="brand-mark text-4xl">Programs</h1>
        <p className="muted mt-2 max-w-2xl">
          Choose a workspace to start a new program with Koda, or request a
          change to an existing automation.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="panel rise block p-5 transition hover:border-[color-mix(in_oklab,var(--accent-soft)_40%,transparent)]"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <h2 className="text-xl font-medium">{project.name}</h2>
              <p className="muted mt-2 text-sm leading-relaxed">
                {project.description ?? "No description yet."}
              </p>
            </Link>
          ))}
          {projects.length === 0 ? (
            <div className="panel p-6 muted">
              No workspaces assigned yet. Ask an admin to grant access.
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
