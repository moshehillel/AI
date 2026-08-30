import { db, ensurePlanningRepository } from "@automation-studio/db";
import { createTaskAgent } from "@automation-studio/cursor-adapter";
import { enqueueJob, type CursorStartJobData } from "@automation-studio/jobs";
import { writeAuditEvent } from "@automation-studio/auth";
import {
  assertUnderUsageSoftCap,
  getDefaultGithubRepoConfig,
  planningAgentInstructions,
  type PlanningMeta,
} from "@automation-studio/domain";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleCursorStart(data: CursorStartJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: { project: { include: { repository: true } } },
  });

  if (cr.status === "AWAITING_HIGH_RISK_APPROVAL") {
    throw new Error("Blocked: high-risk approval required before implementation");
  }

  const cap = await assertUnderUsageSoftCap(data.companyId);
  if (!cap.ok) {
    await transitionChangeRequest({
      changeRequestId: cr.id,
      companyId: data.companyId,
      toStatus: "FAILED",
      reason: cap.reason,
    });
    await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        role: "SYSTEM",
        content: cap.reason,
      },
    });
    return { blocked: true, reason: cap.reason };
  }

  let repo = cr.project.repository;
  if (!repo) {
    repo = await ensurePlanningRepository(db, {
      projectId: cr.projectId,
      companyId: data.companyId,
      defaults: getDefaultGithubRepoConfig(),
    });
  }

  // Plan mode can start on the default branch when no feature branch exists yet.
  let branchName = cr.branchName;
  if (!branchName && data.mode === "plan" && repo) {
    branchName = repo.defaultBranch || "main";
    await db.changeRequest.update({
      where: { id: cr.id },
      data: { branchName },
    });
  }

  if (!repo || !branchName) {
    throw new Error("Missing repository or branch");
  }

  // Reuse the existing plan-mode session instead of spawning a second agent.
  if (data.mode === "plan" && cr.cursorAgentId) {
    console.info(
      `[cursor-start] plan session exists — follow-up agentId=${cr.cursorAgentId} cr=${cr.id}`,
    );
    await enqueueJob("cursor.follow-up", {
      changeRequestId: cr.id,
      companyId: data.companyId,
      prompt: data.prompt,
      mode: "plan",
    });
    return { agentId: cr.cursorAgentId, mode: data.mode, resumed: true };
  }

  const toStatus =
    data.mode === "plan"
      ? "PLANNING"
      : cr.kind === "PROGRAM"
        ? "BUILDING"
        : "IMPLEMENTING";
  await transitionChangeRequest({
    changeRequestId: cr.id,
    companyId: data.companyId,
    toStatus,
  });

  const repoUrl = `https://github.com/${repo.githubOwner}/${repo.githubRepo}`;
  const prompt =
    data.mode === "plan" && !data.prompt.includes("PLANNING mode")
      ? `${planningAgentInstructions()}\n\n${data.prompt}`
      : data.prompt;

  console.info(
    `[cursor-start] LIVE start mode=${data.mode} cr=${cr.id} kind=${cr.kind}`,
  );

  const { agentId, wait } = await createTaskAgent({
    repoUrl,
    branch: branchName,
    prompt,
    mode: data.mode,
    metadata: {
      company_id: data.companyId,
      project_id: cr.projectId,
      change_request_id: cr.id,
    },
  });

  const agentRun = await db.agentRun.create({
    data: {
      changeRequestId: cr.id,
      cursorAgentId: agentId,
      mode: data.mode === "plan" ? "PLAN" : "AGENT",
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  await db.changeRequest.update({
    where: { id: cr.id },
    data: { cursorAgentId: agentId },
  });

  const result = await wait();

  await db.agentRun.update({
    where: { id: agentRun.id },
    data: {
      cursorRunId: result.runId,
      status: "SUCCEEDED",
      finishedAt: new Date(),
    },
  });

  if (result.text) {
    await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        role: "ASSISTANT",
        content: result.text,
        cursorRunId: result.runId,
        model: result.model,
      },
    });
  }

  if (data.mode === "plan") {
    const planContent = result.text ?? "Plan generated";
    await db.plan.create({
      data: {
        changeRequestId: cr.id,
        content: planContent,
      },
    });
    const priorMeta = (cr.planningMeta ?? {}) as PlanningMeta;
    await db.changeRequest.update({
      where: { id: cr.id },
      data: {
        planningMeta: {
          ...priorMeta,
          planMarkdown: planContent,
        },
        updatedAt: new Date(),
      },
    });
    if (cr.kind === "PROGRAM") {
      // Stay in planning until client submits to developer
      await transitionChangeRequest({
        changeRequestId: cr.id,
        companyId: data.companyId,
        toStatus: "PLANNING",
        reason: "Plan updated — still in program planning",
      });
    } else {
      await transitionChangeRequest({
        changeRequestId: cr.id,
        companyId: data.companyId,
        toStatus: "AWAITING_PLAN_APPROVAL",
      });
    }
  } else {
    await transitionChangeRequest({
      changeRequestId: cr.id,
      companyId: data.companyId,
      toStatus: "TESTING",
    });
    await enqueueJob("github.ensure-pr", {
      changeRequestId: cr.id,
      companyId: data.companyId,
    });
  }

  await enqueueJob("usage.record", {
    changeRequestId: cr.id,
    companyId: data.companyId,
    agentRunId: agentRun.id,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    totalTokens: result.usage?.totalTokens,
  });

  await writeAuditEvent({
    companyId: data.companyId,
    action: data.mode === "plan" ? "koda.plan_created" : "koda.implemented",
    entityType: "change_request",
    entityId: cr.id,
    metadata: { agentId, runId: result.runId },
  });

  return { agentId, mode: data.mode };
}
