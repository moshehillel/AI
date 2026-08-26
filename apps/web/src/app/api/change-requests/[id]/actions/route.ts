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
import { assertTransition } from "@automation-studio/domain";

const bodySchema = z.object({
  action: z.enum([
    "approve_plan",
    "approve_high_risk",
    "submit_review",
    "approve",
    "request_changes",
    "reject",
    "merge",
    "cancel",
    "retry",
  ]),
});

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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    const cr = await requireChangeRequestAccess(ctx, id);
    const { action } = bodySchema.parse(await request.json());

    switch (action) {
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
          "Merged to main",
        );
        break;
      }
      case "retry": {
        if (cr.status !== "FAILED") {
          throw new AuthError("Only failed requests can be retried", 400);
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
            content: "Retrying this change request…",
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
        break;
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
