import { requirePageAuth } from "@/lib/page-auth";
import { requireChangeRequestAccess } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import {
  STATUS_LABELS,
  parseBuildSetup,
  isCredentialSecretKey,
} from "@automation-studio/domain";
import { notFound, redirect } from "next/navigation";
import { ChatPanel } from "./chat-panel";
import { ActionBar } from "./action-bar";
import { LivePlanPanel } from "./live-plan-panel";
import { DeveloperWorkbench } from "./developer-workbench";
import { IdeShell, IdeSidebar } from "@/components/ide-shell";

const ONBOARDING_SLUG = "customer-onboarding";

export default async function ChangeRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePageAuth();

  let changeRequest;
  try {
    changeRequest = await requireChangeRequestAccess(ctx, id);
  } catch {
    notFound();
  }

  const full = await db.changeRequest.findFirstOrThrow({
    where: { id: changeRequest.id },
    include: {
      project: true,
      messages: { orderBy: { createdAt: "asc" } },
      plans: { orderBy: { createdAt: "desc" }, take: 1 },
      previews: { orderBy: { createdAt: "desc" }, take: 1 },
      pullRequests: { orderBy: { createdAt: "desc" }, take: 1 },
      ciChecks: { orderBy: { createdAt: "desc" }, take: 1 },
      statusEvents: { orderBy: { createdAt: "asc" } },
      secretRefs: {
        where: { purpose: "CHAT" },
        select: { keyName: true, createdAt: true },
      },
    },
  });

  const preview = full.previews[0];
  const pr = full.pullRequests[0];
  const plan = full.plans[0];
  const ci = full.ciChecks[0];
  const isProgram = full.kind === "PROGRAM";
  const isStaff = ctx.role === "DEVELOPER" || ctx.role === "ADMIN";
  if (full.status === "CANCELLED" && !isStaff) {
    redirect("/projects");
  }
  const planningMeta = (full.planningMeta ?? {}) as {
    apiDocsUrl?: string | null;
    docsText?: string | null;
    examples?: string | null;
  };
  const buildSetup = parseBuildSetup(full.buildSetup);
  const credentialSecrets = full.secretRefs.filter((s) =>
    isCredentialSecretKey(s.keyName),
  );
  const showDevWorkbench =
    isStaff &&
    isProgram &&
    [
      "AWAITING_DEV_BUILD",
      "BUILDING",
      "TESTING",
      "CHANGES_REQUESTED",
      "CLIENT_VERIFY",
      "PREVIEW_READY",
      "AWAITING_FINAL_REVIEW",
    ].includes(full.status);

  const isEmployee = ctx.role === "EMPLOYEE";
  const programs = await db.changeRequest.findMany({
    where: {
      companyId: ctx.company.id,
      kind: "PROGRAM",
      status: { not: "CANCELLED" },
      ...(isEmployee ? { createdById: ctx.user.id } : {}),
      // Prefer same project; fall back to onboarding workspace programs
      project: {
        OR: [{ id: full.projectId }, { slug: ONBOARDING_SLUG }],
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });

  const rightPanel = (
    <>
      {(isProgram || plan) && (
        <LivePlanPanel
          changeRequestId={full.id}
          initialPlan={
            plan
              ? {
                  id: plan.id,
                  content: plan.content,
                  createdAt: plan.createdAt.toISOString(),
                  updatedAt: plan.updatedAt.toISOString(),
                }
              : null
          }
          compact
        />
      )}

      <div className="ide-right-section">
        <p className="ide-right-label">Progress</p>
        <ul className="space-y-1.5 text-[12px]">
          {full.statusEvents.slice(-8).map((event) => (
            <li key={event.id} className="flex justify-between gap-2">
              <span style={{ color: "var(--ide-ink-secondary)" }}>
                {STATUS_LABELS[event.toStatus]}
              </span>
              <span className="muted shrink-0">
                {event.createdAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
          {full.statusEvents.length === 0 ? (
            <li className="muted">No events yet.</li>
          ) : null}
        </ul>
      </div>

      <div className="ide-right-section space-y-2">
        <p className="ide-right-label">Details</p>
        {isProgram && planningMeta.apiDocsUrl ? (
          <p className="text-[12px]">
            <span className="muted">API docs:</span>{" "}
            <a
              className="underline"
              href={planningMeta.apiDocsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open link
            </a>
          </p>
        ) : null}
        {credentialSecrets.length > 0 ? (
          <p className="text-[12px]">
            <span className="muted">Secure secrets:</span>{" "}
            {credentialSecrets.map((s) => s.keyName).join(", ")}
          </p>
        ) : null}
        {preview?.url ? (
          <a className="btn btn-primary w-full" href={preview.url} target="_blank">
            Open preview
          </a>
        ) : null}
        {/* Staff-only internals — never expose git/PR/vendor names to customers */}
        {isStaff && buildSetup.serverLabel ? (
          <p className="text-[12px]">
            <span className="muted">Server:</span> {buildSetup.serverLabel}
          </p>
        ) : null}
        {isStaff && ci ? (
          <p className="text-[12px]">
            <span className="muted">Checks:</span> {ci.status}
          </p>
        ) : null}
        {isStaff && full.branchName ? (
          <p className="text-[12px]">
            <span className="muted">Branch:</span> {full.branchName}
          </p>
        ) : null}
        {isStaff && pr ? (
          <a className="btn btn-ghost w-full" href={pr.url} target="_blank">
            Open review link
          </a>
        ) : null}
        <ActionBar
          changeRequestId={full.id}
          status={full.status}
          role={ctx.role}
          hasPlan={Boolean(plan)}
          kind={full.kind}
          projectId={full.projectId}
          hideProgramBuild={showDevWorkbench}
          hidePlanningSubmit
        />
      </div>

      {showDevWorkbench ? (
        <div className="ide-right-section">
          <DeveloperWorkbench
            changeRequestId={full.id}
            status={full.status}
            buildSetup={buildSetup}
            branchName={full.branchName}
            previewUrl={preview?.url}
            hasPlan={Boolean(plan)}
            initialSecrets={credentialSecrets.map((s) => ({
              keyName: s.keyName,
              createdAt: s.createdAt.toISOString(),
            }))}
          />
        </div>
      ) : null}
    </>
  );

  return (
    <IdeShell
      sidebar={
        <IdeSidebar
          programs={programs}
          activeId={full.id}
          role={ctx.role}
          newHref="/projects"
          projectName={full.project.name}
        />
      }
      right={rightPanel}
    >
      <ChatPanel
        changeRequestId={full.id}
        initialMessages={full.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        }))}
        initialPlanContent={plan?.content ?? ""}
        status={full.status}
        kind={full.kind}
        title={`#${full.number} ${full.title}`}
      />
    </IdeShell>
  );
}
