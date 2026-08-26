import { db } from "@automation-studio/db";
import { createTaskAgent } from "@automation-studio/cursor-adapter";
import { enqueueJob, type CursorStartJobData } from "@automation-studio/jobs";
import { writeAuditEvent } from "@automation-studio/auth";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleCursorStart(data: CursorStartJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: { project: { include: { repository: true } } },
  });

  if (cr.status === "AWAITING_HIGH_RISK_APPROVAL") {
    throw new Error("Blocked: high-risk approval required before implementation");
  }

  const repo = cr.project.repository;
  if (!repo || !cr.branchName) {
    throw new Error("Missing repository or branch");
  }

  const toStatus = data.mode === "plan" ? "PLANNING" : "IMPLEMENTING";
  await transitionChangeRequest({
    changeRequestId: cr.id,
    companyId: data.companyId,
    toStatus,
  });

  const repoUrl = `https://github.com/${repo.githubOwner}/${repo.githubRepo}`;
  const { agentId, wait } = await createTaskAgent({
    repoUrl,
    branch: cr.branchName,
    prompt: data.prompt,
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
    await db.plan.create({
      data: {
        changeRequestId: cr.id,
        content: result.text ?? "Plan generated",
      },
    });
    await transitionChangeRequest({
      changeRequestId: cr.id,
      companyId: data.companyId,
      toStatus: "AWAITING_PLAN_APPROVAL",
    });
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
  });

  await writeAuditEvent({
    companyId: data.companyId,
    action: data.mode === "plan" ? "cursor.plan_created" : "cursor.implemented",
    entityType: "change_request",
    entityId: cr.id,
    metadata: { agentId, runId: result.runId },
  });

  return { agentId, mode: data.mode };
}
