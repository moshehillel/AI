export const dynamic = 'force-dynamic';
import { AppHeader } from "@/components/app-header";
import { getRequestAuth } from "@/lib/request-auth";
import { db } from "@automation-studio/db";
import { ConnectRepoForm } from "./connect-repo-form";
import { InviteNote } from "./invite-note";

export default async function AdminPage() {
  const ctx = await getRequestAuth();

  if (ctx.role !== "ADMIN" && ctx.role !== "DEVELOPER") {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <AppHeader role={ctx.role} />
        <div className="panel p-6">Admin access required.</div>
      </main>
    );
  }

  const projects = await db.project.findMany({
    where: { companyId: ctx.company.id },
    include: { repository: true, members: { include: { user: true } } },
    orderBy: { name: "asc" },
  });

  const members = await db.companyMembership.findMany({
    where: { companyId: ctx.company.id },
    include: { user: true },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AppHeader role={ctx.role} />
      <section className="rise space-y-6">
        <div>
          <h1 className="brand-mark text-4xl">Company admin</h1>
          <p className="muted mt-2">
            Manage members, project access, and repository connections. Production
            deploy access is not granted here by default.
          </p>
        </div>

        <div className="panel p-5">
          <h2 className="text-xl">Members</h2>
          <InviteNote />
          <ul className="mt-4 space-y-2">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              >
                <span>
                  {m.user.name ?? m.user.email}{" "}
                  <span className="muted">({m.user.email})</span>
                </span>
                <span className="status-pill">{m.role}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-5">
          <h2 className="text-xl">Projects & repositories</h2>
          <div className="mt-4 space-y-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className="rounded-xl border border-[var(--line)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg">{project.name}</h3>
                    <p className="muted text-sm">
                      {project.repository
                        ? `${project.repository.githubOwner}/${project.repository.githubRepo}`
                        : "No repository connected"}
                    </p>
                  </div>
                </div>
                {!project.repository ? (
                  <div className="mt-3">
                    <ConnectRepoForm projectId={project.id} />
                  </div>
                ) : null}
                <p className="muted mt-3 text-sm">
                  Members:{" "}
                  {project.members
                    .map((m) => m.user.name ?? m.user.email)
                    .join(", ") || "None"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
