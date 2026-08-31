import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  requireChangeRequestAccess,
  requirePermission,
  writeAuditEvent,
  AuthError,
} from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { enqueueJob } from "@automation-studio/jobs";
import { mergePullRequest } from "@automation-studio/github";
import {
  assertTransition,
  programSubmittedEmail,
  finalReviewEmail,
  resolveDeveloperNotifyEmails,
  parseBuildSetup,
  developerPlanReviewPrompt,
  developerBuildPrompt,
  developerTestImprovePrompt,
  agentOpenUrls,
  isCredentialSecretKey,
  type ProgramBuildSetup,
} from "@automation-studio/domain";
import { getAppBaseUrl } from "@/lib/app-url";
import { queueAndMaybeSendEmail } from "@/lib/notify";
import { getStaffPassword } from "@/lib/staff-access";

const bodySchema = z.object({
  action: z.enum([
    "approve_plan",
    "approve_high_risk",
    "submit_review",
    "submit_to_dev",
    "reopen_planning",
    "open_in_cursor",
    "start_build",
    "grant_test_improve",
    "submit_final_review",
    "approve_deploy",
    "approve",
    "request_changes",
    "reject",
    "merge",
    "cancel",
    "interrupt",
    "retry",
  ]),
  /** Required for submit_to_dev — blocks accidental one-click submits. */
  confirmSubmit: z.boolean().optional(),
  /** Required for grant_test_improve — explicit permission step. */
  confirmGrant: z.boolean().optional(),
  serverLabel: z.string().max(200).optional(),
  autoDeploy: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
});

async function notifyDevelopers(input: {
  companyId: string;
  changeRequestId: string;
  subject: string;
  body: string;
  metadataKind: string;
}) {
  const developers = await db.companyMembership.findMany({
    where: {
      companyId: input.companyId,
      role: { in: ["DEVELOPER", "ADMIN"] },
    },
    include: { user: true },
  });
  const recipients = resolveDeveloperNotifyEmails(
    developers.map((m) => m.user.email),
  );
  if (recipients.length === 0) {
    // Still record that notify failed so Admin inbox / logs show the gap.
    await queueAndMaybeSendEmail({
      companyId: input.companyId,
      toEmail: "unconfigured@notify.local",
      subject: input.subject,
      body: `${input.body}\n\n(Not delivered: set NOTIFY_EMAIL or DEVELOPER_NOTIFY_EMAIL, and RESEND_API_KEY.)`,
      entityType: "change_request",
      entityId: input.changeRequestId,
      metadata: {
        kind: input.metadataKind,
        error: "no_notify_recipients",
      },
    });
    return { recipients: [] as string[], queued: 1 };
  }
  for (const toEmail of recipients) {
    await queueAndMaybeSendEmail({
      companyId: input.companyId,
      toEmail,
      subject: input.subject,
      body: input.body,
      entityType: "change_request",
      entityId: input.changeRequestId,
      metadata: { kind: input.metadataKind },
    });
  }
  return { recipients, queued: recipients.length };
}

async function transition(
  changeRequestId: string,
  companyId: string,
  from: Parameters<typeof assertTransition>[0],
  to: Parameters<typeof assertTransition>[0],
  actorId: string,
  reason?: string,
) {
  assertTransition(from, to);
  await db.changeRequest.update({
    where: { id: changeRequestId },
    data: { status: to },
  });
  await db.changeRequestStatusEvent.create({
    data: {
      changeRequestId,
      fromStatus: from,
      toStatus: to,
      actorId,
      reason,
    },
  });
  await writeAuditEvent({
    companyId,
    actorId,
    action: "change_request.status_changed",
    entityType: "change_request",
    entityId: changeRequestId,
    metadata: { from, to, reason },
  });
}


async function loadProgramPlanText(changeRequestId: string) {
  const full = await db.changeRequest.findFirstOrThrow({
    where: { id: changeRequestId },
    include: {
      plans: { orderBy: { createdAt: "desc" }, take: 1 },
      project: { include: { repository: true } },
      secretRefs: {
        where: { purpose: "CHAT", ciphertext: { not: null } },
        select: { keyName: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const planText =
    full.plans[0]?.content ??
    (full.planningMeta as { planMarkdown?: string } | null)?.planMarkdown ??
    full.description;
  const secretKeyNames = full.secretRefs
    .map((s) => s.keyName)
    .filter(isCredentialSecretKey);
  return { full, planText, secretKeyNames };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    const cr = await requireChangeRequestAccess(ctx, id);
    const body = bodySchema.parse(await request.json());
    const { action } = body;

    switch (action) {
      case "submit_to_dev": {
        await requirePermission(ctx, "program:submit_to_dev");
        if (cr.kind !== "PROGRAM") {
          throw new AuthError("Only programs can be submitted to developers", 400);
        }
        if (cr.status !== "PLANNING" && cr.status !== "AWAITING_PLAN_APPROVAL") {
          throw new AuthError("Program is not in planning", 400);
        }
        if (body.confirmSubmit !== true) {
          throw new AuthError(
            "Confirm submit required — this handoff notifies a developer",
            400,
          );
        }
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "AWAITING_DEV_BUILD",
          ctx.user.id,
          "Submitted to developer for building",
        );

        await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            authorId: ctx.user.id,
            content:
              "Submitted to a developer for building. You'll be notified when a preview is ready to verify. You can reopen planning if this was accidental.",
          },
        });

        const reviewUrl = `${getAppBaseUrl()}/change-requests/${cr.id}`;
        // Never put the password in email/URL — login form at /staff sets httpOnly cookie.
        const staffUnlockUrl = getStaffPassword()
          ? `${getAppBaseUrl()}/staff?next=${encodeURIComponent(`/change-requests/${cr.id}`)}`
          : null;
        const emailContent = programSubmittedEmail({
          programTitle: cr.title,
          programNumber: cr.number,
          requesterName: ctx.user.name ?? ctx.user.email,
          reviewUrl,
          staffUnlockUrl,
        });
        await notifyDevelopers({
          companyId: ctx.company.id,
          changeRequestId: cr.id,
          subject: emailContent.subject,
          body: emailContent.body,
          metadataKind: "program_submit_to_dev",
        });
        break;
      }
      case "reopen_planning": {
        await requirePermission(ctx, "program:reopen_planning");
        if (cr.kind !== "PROGRAM") {
          throw new AuthError("Only programs can reopen planning", 400);
        }
        if (cr.status !== "AWAITING_DEV_BUILD") {
          throw new AuthError(
            "Only submitted programs waiting for a developer can reopen planning",
            400,
          );
        }
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "PLANNING",
          ctx.user.id,
          "Reopened planning",
        );
        await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            authorId: ctx.user.id,
            content:
              "Planning reopened. Continue refining with Koda — submit again only when the plan is ready for a developer.",
          },
        });
        break;
      }

      case "open_in_cursor": {
        await requirePermission(ctx, "program:open_in_cursor");
        if (cr.kind !== "PROGRAM") {
          throw new AuthError("Only programs support Open in Cursor", 400);
        }
        if (
          ![
            "AWAITING_DEV_BUILD",
            "BUILDING",
            "TESTING",
            "CHANGES_REQUESTED",
            "CLIENT_VERIFY",
            "PREVIEW_READY",
            "AWAITING_FINAL_REVIEW",
          ].includes(cr.status)
        ) {
          throw new AuthError(
            "Program must be submitted before opening in Cursor",
            400,
          );
        }

        const { full, planText, secretKeyNames } = await loadProgramPlanText(cr.id);
        const prior = parseBuildSetup(full.buildSetup);
        let agentId = full.cursorAgentId ?? prior.planAgentId ?? null;
        const reviewPrompt = developerPlanReviewPrompt({
          title: full.title,
          planMarkdown: planText,
          description: full.description,
          secretKeyNames,
        });

        if (agentId) {
          await enqueueJob("cursor.follow-up", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
            mode: "plan",
            prompt: reviewPrompt,
          });
        } else {
          if (!full.project.repository) {
            throw new AuthError(
              "No repository linked — connect a repo in Admin, then retry Open in Cursor",
              400,
            );
          }
          // Worker creates the Cursor agent (keeps @cursor/sdk off the Next bundle).
          await enqueueJob("cursor.start-agent", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
            mode: "plan",
            prompt: reviewPrompt,
          });
        }

        // Refresh in case the worker already persisted an id from planning.
        const refreshed = await db.changeRequest.findFirst({
          where: { id: cr.id },
          select: { cursorAgentId: true, buildSetup: true },
        });
        agentId =
          refreshed?.cursorAgentId ??
          parseBuildSetup(refreshed?.buildSetup).planAgentId ??
          agentId;

        if (!agentId) {
          await writeAuditEvent({
            companyId: ctx.company.id,
            actorId: ctx.user.id,
            action: "program.open_in_cursor_pending",
            entityType: "change_request",
            entityId: cr.id,
            metadata: {},
          });
          return NextResponse.json({
            ok: true,
            pending: true,
            message:
              "Starting Cursor plan session — click Open in Cursor again in a few seconds.",
          });
        }

        const urls = agentOpenUrls(agentId);
        const nextSetup: ProgramBuildSetup = {
          ...prior,
          planAgentId: agentId,
          openInWebUrl: urls.openInWebUrl,
          openInCursorUrl: urls.openInCursorUrl,
          lastOpenedInCursorAt: new Date().toISOString(),
        };
        await db.changeRequest.update({
          where: { id: cr.id },
          data: { buildSetup: nextSetup },
        });
        await writeAuditEvent({
          companyId: ctx.company.id,
          actorId: ctx.user.id,
          action: "program.opened_in_cursor",
          entityType: "change_request",
          entityId: cr.id,
          metadata: { agentId },
        });

        return NextResponse.json({
          ok: true,
          ...urls,
          resumed: Boolean(full.cursorAgentId ?? prior.planAgentId),
        });
      }

      case "start_build": {
        await requirePermission(ctx, "program:start_build");
        if (cr.status !== "AWAITING_DEV_BUILD" && cr.status !== "CHANGES_REQUESTED") {
          throw new AuthError("Program is not waiting for a build", 400);
        }
        const fromStatus =
          cr.status === "CHANGES_REQUESTED" ? "CHANGES_REQUESTED" : "AWAITING_DEV_BUILD";
        const {
          full: buildFull,
          planText: buildPlanText,
          secretKeyNames: buildSecretKeys,
        } = await loadProgramPlanText(cr.id);
        const priorBuild = parseBuildSetup(buildFull.buildSetup);
        const nextBuildSetup: ProgramBuildSetup = {
          ...priorBuild,
          serverLabel: body.serverLabel ?? priorBuild.serverLabel ?? "default",
          autoDeploy: body.autoDeploy ?? priorBuild.autoDeploy ?? true,
          notes: body.notes ?? priorBuild.notes ?? null,
          startedAt: new Date().toISOString(),
          startedBy: ctx.user.id,
          testImproveGranted: false,
        };
        await db.changeRequest.update({
          where: { id: cr.id },
          data: {
            assignedDeveloperId: ctx.user.id,
            buildSetup: nextBuildSetup,
          },
        });
        await transition(
          cr.id,
          ctx.company.id,
          fromStatus,
          "BUILDING",
          ctx.user.id,
          "Developer started build",
        );
        await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            authorId: ctx.user.id,
            content: `Developer started the build${body.serverLabel ? ` on ${body.serverLabel}` : ""}. Auto-deploy on push: ${body.autoDeploy === false ? "off" : "on"}.`,
          },
        });

        const full = buildFull;
        const planText = buildPlanText;
        const buildPrompt = developerBuildPrompt({
          title: full.title,
          planMarkdown: planText,
          serverLabel: nextBuildSetup.serverLabel,
          secretKeyNames: buildSecretKeys,
        });
        if (full.project.repository) {
          if (!full.branchName) {
            await enqueueJob("github.ensure-branch", {
              changeRequestId: cr.id,
              companyId: ctx.company.id,
            });
          } else if (full.cursorAgentId) {
            await enqueueJob("cursor.follow-up", {
              changeRequestId: cr.id,
              companyId: ctx.company.id,
              mode: "agent",
              prompt: buildPrompt,
            });
          } else {
            await enqueueJob("cursor.start-agent", {
              changeRequestId: cr.id,
              companyId: ctx.company.id,
              mode: "agent",
              prompt: buildPrompt,
            });
          }
        } else {
          // Mock build path when no repo connected yet
          await db.changeRequestMessage.create({
            data: {
              changeRequestId: cr.id,
              role: "ASSISTANT",
              content:
                "Build started in mock mode (no repository connected yet). Connect a repository in Admin to enable live builds. Preparing a preview stub…",
            },
          });
          await transition(
            cr.id,
            ctx.company.id,
            "BUILDING",
            "CLIENT_VERIFY",
            ctx.user.id,
            "Mock preview ready",
          );
          await db.previewEnvironment.create({
            data: {
              changeRequestId: cr.id,
              provider: "MOCK",
              url: `${getAppBaseUrl()}/projects/${full.projectId}`,
              status: "READY",
              externalId: `mock-preview-${cr.id}`,
            },
          });
          await db.changeRequestMessage.create({
            data: {
              changeRequestId: cr.id,
              role: "SYSTEM",
              content:
                "Preview is ready for verification. Ask Koda how things work, request test scripts, or request changes until you're satisfied — then submit for final review.",
            },
          });
        }
        break;
      }

      case "grant_test_improve": {
        await requirePermission(ctx, "program:grant_test_improve");
        if (cr.kind !== "PROGRAM") {
          throw new AuthError("Only programs support Test & Improve", 400);
        }
        if (body.confirmGrant !== true) {
          throw new AuthError(
            "Confirm required — granting Test & Improve opens a workspace with code edit and deploy access",
            400,
          );
        }
        if (
          cr.status !== "BUILDING" &&
          cr.status !== "TESTING" &&
          cr.status !== "CHANGES_REQUESTED"
        ) {
          throw new AuthError(
            "Start Build first, then grant Test & Improve",
            400,
          );
        }

        const { full, planText, secretKeyNames } = await loadProgramPlanText(cr.id);
        const prior = parseBuildSetup(full.buildSetup);
        const agentId =
          full.cursorAgentId ?? prior.buildAgentId ?? prior.planAgentId;
        const urls = agentId ? agentOpenUrls(agentId) : null;
        const nextSetup: ProgramBuildSetup = {
          ...prior,
          testImproveGranted: true,
          testImproveGrantedAt: new Date().toISOString(),
          testImproveGrantedBy: ctx.user.id,
          buildAgentId: agentId ?? prior.buildAgentId,
          openInWebUrl: urls?.openInWebUrl ?? prior.openInWebUrl,
          openInCursorUrl: urls?.openInCursorUrl ?? prior.openInCursorUrl,
        };
        await db.changeRequest.update({
          where: { id: cr.id },
          data: { buildSetup: nextSetup },
        });

        if (cr.status === "BUILDING" || cr.status === "CHANGES_REQUESTED") {
          await transition(
            cr.id,
            ctx.company.id,
            cr.status,
            "TESTING",
            ctx.user.id,
            "Test & Improve workspace granted",
          );
        }

        const testPrompt = developerTestImprovePrompt({
          title: full.title,
          planMarkdown: planText,
          secretKeyNames,
        });
        if (agentId) {
          await enqueueJob("cursor.follow-up", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
            mode: "agent",
            prompt: testPrompt,
          });
        } else if (full.project.repository) {
          await enqueueJob("cursor.start-agent", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
            mode: "agent",
            prompt: testPrompt,
          });
        }

        await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            authorId: ctx.user.id,
            content:
              "Developer opened the Test & Improve workspace. Preview updates will appear here for you to verify — you stay in Koda.",
          },
        });
        await writeAuditEvent({
          companyId: ctx.company.id,
          actorId: ctx.user.id,
          action: "program.test_improve_granted",
          entityType: "change_request",
          entityId: cr.id,
          metadata: { agentId },
        });

        return NextResponse.json({
          ok: true,
          testImproveGranted: true,
          ...(urls ?? {}),
          workspace: "test-improve",
        });
      }

      case "submit_final_review": {
        await requirePermission(ctx, "change_request:submit_review");
        const from =
          cr.status === "CLIENT_VERIFY" || cr.status === "PREVIEW_READY"
            ? cr.status
            : null;
        if (!from) {
          throw new AuthError("Preview must be ready before final review", 400);
        }
        await transition(
          cr.id,
          ctx.company.id,
          from,
          "AWAITING_FINAL_REVIEW",
          ctx.user.id,
          "Submitted for final review",
        );
        await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            authorId: ctx.user.id,
            content: "Submitted for final developer review and deploy approval.",
          },
        });
        const reviewUrl = `${getAppBaseUrl()}/change-requests/${cr.id}`;
        const emailContent = finalReviewEmail({
          programTitle: cr.title,
          programNumber: cr.number,
          reviewUrl,
        });
        await notifyDevelopers({
          companyId: ctx.company.id,
          changeRequestId: cr.id,
          subject: emailContent.subject,
          body: emailContent.body,
          metadataKind: "program_final_review",
        });
        break;
      }
      case "approve_deploy": {
        await requirePermission(ctx, "program:final_approve");
        if (
          cr.status !== "AWAITING_FINAL_REVIEW" &&
          cr.status !== "APPROVED" &&
          cr.status !== "DEVELOPER_REVIEW" &&
          cr.status !== "TESTING"
        ) {
          throw new AuthError("Not awaiting final deploy approval", 400);
        }
        let from = cr.status;
        if (
          from === "AWAITING_FINAL_REVIEW" ||
          from === "DEVELOPER_REVIEW" ||
          from === "TESTING"
        ) {
          await transition(
            cr.id,
            ctx.company.id,
            from,
            "APPROVED",
            ctx.user.id,
            "Approved for deploy",
          );
          from = "APPROVED";
        }
        await transition(
          cr.id,
          ctx.company.id,
          from,
          "DEPLOYING",
          ctx.user.id,
          "Deploy started",
        );
        await enqueueJob("merge.prepare", {
          changeRequestId: cr.id,
          companyId: ctx.company.id,
        });
        const full = await db.changeRequest.findFirst({
          where: { id: cr.id },
          include: {
            pullRequests: true,
            project: { include: { repository: true } },
          },
        });
        const pr = full?.pullRequests[0];
        const repo = full?.project.repository;
        if (pr && repo) {
          await mergePullRequest({
            installationId: repo.installationId ?? "0",
            owner: repo.githubOwner,
            repo: repo.githubRepo,
            pullNumber: pr.githubPrNumber,
          });
          await db.pullRequest.update({
            where: { id: pr.id },
            data: { status: "MERGED" },
          });
        }
        await transition(
          cr.id,
          ctx.company.id,
          "DEPLOYING",
          "DONE",
          ctx.user.id,
          "Deploy complete",
        );
        await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            authorId: ctx.user.id,
            content: "Program approved and deployed. Status: Complete.",
          },
        });
        break;
      }
      case "approve_plan": {
        await requirePermission(ctx, "change_request:approve_plan");
        const plan = await db.plan.findFirst({
          where: { changeRequestId: cr.id },
          orderBy: { createdAt: "desc" },
        });
        if (plan) {
          await db.plan.update({
            where: { id: plan.id },
            data: { approvedAt: new Date(), approvedById: ctx.user.id },
          });
        }
        if (cr.kind === "PROGRAM") {
          await transition(
            cr.id,
            ctx.company.id,
            cr.status,
            "AWAITING_DEV_BUILD",
            ctx.user.id,
            "Plan approved — awaiting developer build",
          );
          break;
        }
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "IMPLEMENTING",
          ctx.user.id,
          "Plan approved",
        );
        await enqueueJob("cursor.start-agent", {
          changeRequestId: cr.id,
          companyId: ctx.company.id,
          mode: "agent",
          prompt: `Implement the approved plan for: ${cr.title}\n\n${cr.description}`,
        });
        break;
      }
      case "approve_high_risk": {
        await requirePermission(ctx, "change_request:high_risk_approve");
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "ANALYZING",
          ctx.user.id,
          "High-risk approved by developer",
        );
        await enqueueJob("github.ensure-branch", {
          changeRequestId: cr.id,
          companyId: ctx.company.id,
        });
        break;
      }
      case "submit_review": {
        await requirePermission(ctx, "change_request:submit_review");
        await enqueueJob("merge.prepare", {
          changeRequestId: cr.id,
          companyId: ctx.company.id,
        });
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "READY_FOR_REVIEW",
          ctx.user.id,
          "Submitted for developer review",
        );
        await transition(
          cr.id,
          ctx.company.id,
          "READY_FOR_REVIEW",
          "DEVELOPER_REVIEW",
          ctx.user.id,
        );
        break;
      }
      case "approve": {
        await requirePermission(ctx, "change_request:review");
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "APPROVED",
          ctx.user.id,
          "Developer approved",
        );
        break;
      }
      case "request_changes": {
        await requirePermission(ctx, "change_request:review");
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "CHANGES_REQUESTED",
          ctx.user.id,
          "Developer requested changes",
        );
        break;
      }
      case "reject": {
        await requirePermission(ctx, "change_request:review");
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "REJECTED",
          ctx.user.id,
          "Developer rejected",
        );
        break;
      }
      case "merge": {
        await requirePermission(ctx, "change_request:merge");
        await enqueueJob("merge.prepare", {
          changeRequestId: cr.id,
          companyId: ctx.company.id,
        });
        const full = await db.changeRequest.findFirstOrThrow({
          where: { id: cr.id },
          include: {
            pullRequests: true,
            project: { include: { repository: true } },
          },
        });
        const pr = full.pullRequests[0];
        const repo = full.project.repository;
        if (pr && repo) {
          await mergePullRequest({
            installationId: repo.installationId ?? "0",
            owner: repo.githubOwner,
            repo: repo.githubRepo,
            pullNumber: pr.githubPrNumber,
          });
          await db.pullRequest.update({
            where: { id: pr.id },
            data: { status: "MERGED" },
          });
        }
        let from = full.status;
        if (from !== "APPROVED") {
          await transition(
            cr.id,
            ctx.company.id,
            from,
            "APPROVED",
            ctx.user.id,
          );
          from = "APPROVED";
        }
        await transition(
          cr.id,
          ctx.company.id,
          from,
          "MERGED",
          ctx.user.id,
          "Merged",
        );
        break;
      }
      case "retry": {
        if (cr.status !== "FAILED") {
          throw new AuthError("Only failed requests can be retried", 400);
        }
        if (cr.kind === "PROGRAM") {
          await transition(
            cr.id,
            ctx.company.id,
            cr.status,
            "BUILDING",
            ctx.user.id,
            "Retry build",
          );
          await enqueueJob("cursor.start-agent", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
            mode: "agent",
            prompt: `${cr.title}\n\n${cr.description}`.trim(),
          });
          break;
        }
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "ANALYZING",
          ctx.user.id,
          "Retry requested",
        );
        await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            authorId: ctx.user.id,
            content: "Retrying this request…",
          },
        });
        if (cr.branchName) {
          await enqueueJob("cursor.start-agent", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
            mode:
              cr.classification === "COMPLEX" || cr.classification === "HIGH_RISK"
                ? "plan"
                : "agent",
            prompt: `${cr.title}\n\n${cr.description}`.trim(),
          });
        } else {
          await enqueueJob("github.ensure-branch", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
          });
        }
        break;
      }
      case "interrupt": {
        // Soft-stop the current agent turn only — do not cancel the change request.
        const latestRun = await db.agentRun.findFirst({
          where: { changeRequestId: cr.id, status: "RUNNING" },
          orderBy: { createdAt: "desc" },
        });
        const agentId = latestRun?.cursorAgentId ?? cr.cursorAgentId;

        // Mark locally first so the waiting worker can exit without posting a reply.
        if (latestRun) {
          await db.agentRun.updateMany({
            where: { id: latestRun.id, status: "RUNNING" },
            data: { status: "CANCELLED", finishedAt: new Date() },
          });
        }

        if (agentId) {
          await enqueueJob("cursor.cancel", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
            agentId,
            runId: latestRun?.cursorRunId,
            agentRunId: latestRun?.id,
          });
        }

        await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            authorId: ctx.user.id,
            content: "Interrupted — stopped the current response.",
          },
        });

        await writeAuditEvent({
          companyId: ctx.company.id,
          actorId: ctx.user.id,
          action: "koda.turn_interrupted",
          entityType: "change_request",
          entityId: cr.id,
          metadata: {
            agentId: agentId ?? null,
            runId: latestRun?.cursorRunId ?? null,
          },
        });

        return NextResponse.json({
          ok: true,
          interrupted: true,
          cancelledRun: Boolean(agentId || latestRun),
        });
      }
      case "cancel": {
        const latestRun = await db.agentRun.findFirst({
          where: { changeRequestId: cr.id, status: "RUNNING" },
          orderBy: { createdAt: "desc" },
        });
        if (latestRun || cr.cursorAgentId) {
          await enqueueJob("cursor.cancel", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
            agentId: latestRun?.cursorAgentId ?? cr.cursorAgentId!,
            runId: latestRun?.cursorRunId,
            agentRunId: latestRun?.id,
          });
        }
        await transition(
          cr.id,
          ctx.company.id,
          cr.status,
          "CANCELLED",
          ctx.user.id,
          "Cancelled by user",
        );
        // Soft-delete from dashboards; client redirects off this page
        return NextResponse.json({
          ok: true,
          cancelled: true,
          projectId: cr.projectId,
          redirectTo: `/projects/${cr.projectId}`,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
