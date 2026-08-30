import { db } from "@automation-studio/db";
import { resumeAndSend } from "@automation-studio/cursor-adapter";
import { enqueueJob, type CursorFollowUpJobData } from "@automation-studio/jobs";
import { isProgramPlanOnly } from "@automation-studio/domain";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleCursorFollowUp(data: CursorFollowUpJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
  });

  if (!cr.cursorAgentId) {
    throw new Error("No AI build session associated with this program");
  }

  const forcePlan = cr.kind === "PROGRAM" && isProgramPlanOnly(cr.status);
  const mode = forcePlan ? "plan" : (data.mode ?? "agent");

  if (mode === "agent" && cr.status !== "BUILDING" && cr.status !== "IMPLEMENTING") {
    const next =
      cr.kind === "PROGRAM"
        ? cr.status === "CLIENT_VERIFY" ||
          cr.status === "PREVIEW_READY" ||
          cr.status === "CHANGES_REQUESTED"
          ? ("BUILDING" as const)
          : null
        : ("IMPLEMENTING" as const);
    if (next) {
      await transitionChangeRequest({
        changeRequestId: cr.id,
        companyId: data.companyId,
        toStatus: next,
      });
    }
  }

  const agentRun = await db.agentRun.create({
    data: {
      changeRequestId: cr.id,
      cursorAgentId: cr.cursorAgentId,
      mode: mode === "plan" ? "PLAN" : "AGENT",
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  const { wait } = await resumeAndSend({
    agentId: cr.cursorAgentId,
    prompt: data.prompt,
    mode,
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

  if (mode === "agent") {
    await transitionChangeRequest({
      changeRequestId: cr.id,
      companyId: data.companyId,
      toStatus: "TESTING",
    });
    await enqueueJob("github.ensure-pr", {
      changeRequestId: cr.id,
      companyId: data.companyId,
    });
  } else {
    await db.plan.create({
      data: {
        changeRequestId: cr.id,
        content: result.text ?? "Updated plan",
      },
    });
    if (cr.kind !== "PROGRAM") {
      await transitionChangeRequest({
        changeRequestId: cr.id,
        companyId: data.companyId,
        toStatus: "AWAITING_PLAN_APPROVAL",
      });
    }
    // Programs remain in PLANNING / AWAITING_DEV_BUILD
  }

  await enqueueJob("usage.record", {
    changeRequestId: cr.id,
    companyId: data.companyId,
    agentRunId: agentRun.id,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    totalTokens: result.usage?.totalTokens,
  });

  return { ok: true };
}
