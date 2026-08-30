export const dynamic = "force-dynamic";
import { AppHeader } from "@/components/app-header";
import { requirePageAuth } from "@/lib/page-auth";
import { db } from "@automation-studio/db";
import {
  getCompanyUsageTotals,
  parseCompanySettings,
} from "@automation-studio/domain";

export default async function UsagePage() {
  const ctx = await requirePageAuth();
  if (ctx.role === "EMPLOYEE") {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <AppHeader role={ctx.role} />
        <div className="panel p-6">
          Usage reporting is available to developers and admins.
        </div>
      </main>
    );
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [totals, byProject, byUser, recent, company] = await Promise.all([
    getCompanyUsageTotals(ctx.company.id, monthStart),
    db.usageRecord.groupBy({
      by: ["projectId"],
      where: { companyId: ctx.company.id, createdAt: { gte: monthStart } },
      _sum: { totalTokens: true, billedCents: true },
      _count: true,
    }),
    db.usageRecord.groupBy({
      by: ["userId"],
      where: { companyId: ctx.company.id, createdAt: { gte: monthStart } },
      _sum: { totalTokens: true, billedCents: true },
      _count: true,
    }),
    db.usageRecord.findMany({
      where: { companyId: ctx.company.id },
      include: {
        project: true,
        user: true,
        changeRequest: true,
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    db.company.findUniqueOrThrow({ where: { id: ctx.company.id } }),
  ]);

  const settings = parseCompanySettings(company.settings);
  const projects = await db.project.findMany({
    where: { companyId: ctx.company.id },
  });
  const users = await db.user.findMany({
    where: { memberships: { some: { companyId: ctx.company.id } } },
  });
  const projectName = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const userName = Object.fromEntries(
    users.map((u) => [u.id, u.name ?? u.email]),
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AppHeader role={ctx.role} />
      <section className="rise space-y-6">
        <div>
          <h1 className="brand-mark text-4xl">Usage</h1>
          <p className="muted mt-2">
            Koda AI and preview usage by company, workspace, and person for this
            month.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="panel p-4">
            <p className="muted text-sm">Records</p>
            <p className="mt-2 text-3xl">{totals.records}</p>
          </div>
          <div className="panel p-4">
            <p className="muted text-sm">Tokens</p>
            <p className="mt-2 text-3xl">{totals.totalTokens}</p>
          </div>
          <div className="panel p-4">
            <p className="muted text-sm">Billed (¢)</p>
            <p className="mt-2 text-3xl">{totals.billedCents}</p>
          </div>
          <div className="panel p-4">
            <p className="muted text-sm">Soft caps</p>
            <p className="mt-2 text-sm">
              {settings.usageSoftCapCents
                ? `${settings.usageSoftCapCents}¢`
                : "No $ cap"}
              {" · "}
              {settings.usageSoftCapTokens
                ? `${settings.usageSoftCapTokens} tokens`
                : "No token cap"}
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-5">
            <h2 className="text-lg">By project</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {byProject.map((row) => (
                <li
                  key={row.projectId ?? "none"}
                  className="flex justify-between gap-3 border-b border-[var(--line)] py-2"
                >
                  <span>
                    {row.projectId
                      ? projectName[row.projectId] ?? row.projectId
                      : "Unscoped"}
                  </span>
                  <span className="muted">
                    {row._sum.totalTokens ?? 0} tok · {row._count} runs
                  </span>
                </li>
              ))}
              {byProject.length === 0 ? (
                <li className="muted">No usage yet this month.</li>
              ) : null}
            </ul>
          </div>
          <div className="panel p-5">
            <h2 className="text-lg">By person</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {byUser.map((row) => (
                <li
                  key={row.userId ?? "none"}
                  className="flex justify-between gap-3 border-b border-[var(--line)] py-2"
                >
                  <span>
                    {row.userId ? userName[row.userId] ?? row.userId : "System"}
                  </span>
                  <span className="muted">
                    {row._sum.totalTokens ?? 0} tok · {row._count} runs
                  </span>
                </li>
              ))}
              {byUser.length === 0 ? (
                <li className="muted">No usage yet this month.</li>
              ) : null}
            </ul>
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="text-lg">Recent AI runs</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {recent.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] py-2"
              >
                <span>
                  {row.project?.name ?? "Project"} · #
                  {row.changeRequest?.number ?? "—"} ·{" "}
                  {row.user?.name ?? row.user?.email ?? "System"}
                </span>
                <span className="muted">
                  {row.totalTokens} tok · {row.billedCents ?? 0}¢ ·{" "}
                  {row.createdAt.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
