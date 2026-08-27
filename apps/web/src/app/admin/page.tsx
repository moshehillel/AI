export const dynamic = 'force-dynamic';
import { AppHeader } from "@/components/app-header";
import { getRequestAuth } from "@/lib/request-auth";
import { db } from "@automation-studio/db";
import { parseCompanySettings } from "@automation-studio/domain";
import { ConnectRepoForm } from "./connect-repo-form";
import { InviteNote } from "./invite-note";
import { ProjectMembersForm } from "./project-members-form";
import { VerifyProtectionButton } from "./verify-protection-button";
import { CompanySettingsForm } from "./company-settings-form";
import Link from "next/link";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getRequestAuth();
  const params = await searchParams;

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

  const installations = await db.githubInstallation.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { createdAt: "desc" },
  });

  const company = await db.company.findUniqueOrThrow({
    where: { id: ctx.company.id },
  });
  const settings = parseCompanySettings(company.settings);
  const githubNotice = typeof params.github === "string" ? params.github : null;
  const installationId =
    typeof params.installation_id === "string" ? params.installation_id : null;
  const githubNoticeMessage =
    githubNotice === "installed"
      ? installationId
        ? params.manual === "1"
          ? `GitHub App installed (ID ${installationId}). Paste this installation ID when connecting a repository below.`
          : `GitHub App installed successfully (ID ${installationId}).`
        : "GitHub App installed."
      : githubNotice === "pending_approval"
        ? "Install request sent — a GitHub org admin must approve before you get an installation ID."
      : githubNotice === "missing_params"
        ? "GitHub redirect was missing installation_id. Retry from Admin → Install / manage GitHub App on the production URL (not localhost)."
      : githubNotice === "bad_state"
        ? "Install session expired or invalid. Retry from Admin → Install / manage GitHub App."
      : githubNotice;

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
          {githubNoticeMessage ? (
            <p className="mt-3 text-sm text-[var(--accent-soft)]">
              {githubNoticeMessage}
              {typeof params.error === "string" ? ` — ${params.error}` : ""}
            </p>
          ) : null}
        </div>

        <div className="panel p-5">
          <h2 className="text-xl">GitHub App</h2>
          <p className="muted mt-2 text-sm">
            Install the Automation Studio GitHub App into your organization, then
            connect individual repositories to projects.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {!process.env.GITHUB_APP_ID ? (
              <Link
                className="btn btn-primary"
                href="/api/github/app-manifest/start"
              >
                Register GitHub App (one-time)
              </Link>
            ) : null}
            <Link className="btn btn-primary" href="/api/github/install">
              Install / manage GitHub App
            </Link>
          </div>
          {!process.env.GITHUB_APP_ID ? (
            <p className="muted mt-3 text-sm">
              First-time setup: click Register to create the GitHub App on your
              account (requires GitHub login). Credentials are saved to Railway
              automatically when <code>RAILWAY_API_TOKEN</code> is configured.
              If Railway is blocked (NetFree), run{" "}
              <code>pnpm register:github-app</code> locally — see{" "}
              <code>docs/github-app-setup.md</code> (Option A).
            </p>
          ) : null}
          <ul className="mt-4 space-y-2 text-sm">
            {installations.map((install) => (
              <li key={install.id} className="status-pill">
                Installation {install.installationId} · {install.accountLogin}
              </li>
            ))}
            {installations.length === 0 ? (
              <li className="muted">No installations recorded yet.</li>
            ) : null}
          </ul>
        </div>

        {ctx.role === "ADMIN" ? (
          <div className="panel p-5">
            <h2 className="text-xl">Company settings</h2>
            <CompanySettingsForm initial={settings} />
          </div>
        ) : null}

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
                  {project.repository ? (
                    <VerifyProtectionButton projectId={project.id} />
                  ) : null}
                </div>
                {!project.repository ? (
                  <div className="mt-3">
                    <ConnectRepoForm
                      projectId={project.id}
                      defaultInstallationId={installations[0]?.installationId}
                    />
                  </div>
                ) : null}
                {ctx.role === "ADMIN" ? (
                  <div className="mt-4">
                    <ProjectMembersForm
                      projectId={project.id}
                      members={project.members.map((m) => ({
                        userId: m.userId,
                        label: m.user.name ?? m.user.email,
                      }))}
                      candidates={members.map((m) => ({
                        userId: m.userId,
                        label: `${m.user.name ?? m.user.email} (${m.role})`,
                      }))}
                    />
                  </div>
                ) : (
                  <p className="muted mt-3 text-sm">
                    Members:{" "}
                    {project.members
                      .map((m) => m.user.name ?? m.user.email)
                      .join(", ") || "None"}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
