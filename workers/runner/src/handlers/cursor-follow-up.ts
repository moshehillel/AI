import { db } from "@automation-studio/db";
import { resumeAndSend } from "@automation-studio/cursor-adapter";
import { enqueueJob, type CursorFollowUpJobData } from "@automation-studio/jobs";
import {
  isProgramPlanOnly,
  planningAgentInstructions,
  type PlanningMeta,
} from "@automation-studio/domain";
import { transitionChangeRequest } from "../lib/transition.js";
import { loadPlanningAttachmentsForAgent } from "../lib/planning-attachment.js";
import { persistPlanModeReply, clearLiveProgress } from "../lib/planning-persist.js";
import { mirrorPlanningStream } from "../lib/planning-stream.js";

function normalizeAttachmentRefs(data: {
  attachmentRef?: string;
  attachmentRefs?: string[];
}): string[] {
  const refs = [
    ...(data.attachmentRefs ?? []),
    ...(data.attachmentRef ? [data.attachmentRef] : []),
  ].filter(Boolean);
  return [...new Set(refs)];
}

export async function handleCursorFollowUp(data: CursorFollowUpJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: { project: { include: { repository: true } } },
  });

  if (!cr.cursorAgentId) {
    throw new Error("No AI build session associated with this program");
  }

  const forcePlan = cr.kind === "PROGRAM" && isProgramPlanOnly(cr.status);
  const mode = forcePlan ? "plan" : (data.mode ?? "agent");

  let prompt =
    mode === "plan"
      ? `${planningAgentInstructions()}\n\nClient message:\n${data.prompt}`
      : data.prompt;
  let images: Array<{ data: string; mimeType: string }> | undefined;

  const attachmentRefs = normalizeAttachmentRefs(data);
  const repo = cr.project.repository;
  const branchName = cr.branchName;
  if (attachmentRefs.length) {
    const attached = await loadPlanningAttachmentsForAgent({
      companyId: data.companyId,
      projectId: cr.projectId,
      attachmentRefs,
      repoWrite:
        repo && branchName
          ? {
              installationId: repo.installationId ?? "0",
              owner: repo.githubOwner,
              repo: repo.githubRepo,
              branch: branchName,
            }
          : null,
    });
    if (attached.promptSection) {
      prompt = `${prompt}\n\n${attached.promptSection}`;
    }
    images = attached.images.length ? attached.images : undefined;
  }

  console.info(
    `[cursor-follow-up] mode=${mode} cr=${cr.id} agentId=${cr.cursorAgentId} attachmentRefs=${attachmentRefs.join(",") || "none"} images=${images?.length ?? 0}`,
  );

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

  // After Interrupt, a prior wait may still be winding down. Wait briefly for
  // RUNNING rows to clear so we do not race two Cursor sends on one agent.
  for (let i = 0; i < 25; i += 1) {
    const stillRunning = await db.agentRun.count({
      where: { changeRequestId: cr.id, status: "RUNNING" },
    });
    if (stillRunning === 0) break;
    await new Promise((r) => setTimeout(r, 200));
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

  const priorMeta = (cr.planningMeta ?? {}) as PlanningMeta;

  const { wait, run, runId: immediateRunId } = await resumeAndSend({
    agentId: cr.cursorAgentId,
    prompt,
    mode,
    images,
  });

  if (immediateRunId) {
    await db.agentRun.update({
      where: { id: agentRun.id },
      data: { cursorRunId: immediateRunId },
    });
  }

  if (mode === "plan") {
    await db.changeRequest.update({
      where: { id: cr.id },
      data: {
        planningMeta: {
          ...priorMeta,
          liveProgress: "Starting…",
          liveDraft: null,
        },
        updatedAt: new Date(),
      },
    });
  }

  const streamMirror =
    mode === "plan"
      ? mirrorPlanningStream({
          changeRequestId: cr.id,
          priorMeta,
          stream: run,
        })
      : Promise.resolve();

  let result: Awaited<ReturnType<typeof wait>>;
  try {
    [result] = await Promise.all([wait(), streamMirror]);
  } catch (error) {
    const current = await db.agentRun.findUnique({ where: { id: agentRun.id } });
    if (current?.status === "CANCELLED") {
      console.info(`[cursor-follow-up] cancelled mid-wait cr=${cr.id}`);
      if (mode === "plan") await clearLiveProgress(cr.id, priorMeta);
      return { cancelled: true };
    }
    await db.agentRun.update({
      where: { id: agentRun.id },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    if (mode === "plan") await clearLiveProgress(cr.id, priorMeta);
    throw error;
  }

  const afterWait = await db.agentRun.findUnique({ where: { id: agentRun.id } });
  if (afterWait?.status === "CANCELLED") {
    console.info(`[cursor-follow-up] cancelled after wait cr=${cr.id}`);
    if (mode === "plan") await clearLiveProgress(cr.id, priorMeta);
    return { cancelled: true };
  }

  await db.agentRun.update({
    where: { id: agentRun.id },
    data: {
      cursorRunId: result.runId ?? immediateRunId,
      status: "SUCCEEDED",
      finishedAt: new Date(),
    },
  });

  if (mode === "agent") {
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
    if (result.text) {
      await persistPlanModeReply({
        changeRequestId: cr.id,
        priorMeta,
        rawText: result.text,
        cursorRunId: result.runId,
        model: result.model,
      });
    } else {
      await clearLiveProgress(cr.id, priorMeta);
    }
    if (cr.kind !== "PROGRAM") {
      await transitionChangeRequest({
        changeRequestId: cr.id,
        companyId: data.companyId,
        toStatus: "AWAITING_PLAN_APPROVAL",
      });
    }
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
