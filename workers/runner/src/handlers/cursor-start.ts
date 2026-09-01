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
import { loadPlanningAttachmentsForAgent } from "../lib/planning-attachment.js";
import { clearLiveProgress } from "../lib/planning-persist.js";
import { mirrorPlanningStream } from "../lib/planning-stream.js";
import { scheduleEmptyReplyRetry } from "../lib/planning-empty-retry.js";
import {
  flushQueuedFollowUp,
  markTurnInFlight,
  startPlanningHeartbeat,
} from "../lib/planning-heartbeat.js";
import {
  AGENT_TURN_TIMEOUT_MS,
  attachmentLoadFailureMessage,
  failPlanningTurn,
  finalizePlanModeTurn,
  isEmptyAgentReply,
  planningTurnErrorMessage,
  postTurnMessage,
  withTimeout,
  writeLiveProgress,
} from "../lib/planning-turn.js";

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

export async function handleCursorStart(data: CursorStartJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: { project: { include: { repository: true } } },
  });

  if (cr.status === "AWAITING_HIGH_RISK_APPROVAL") {
    throw new Error("Blocked: high-risk approval required before implementation");
  }

  const runningTurn = await db.agentRun.count({
    where: { changeRequestId: cr.id, status: "RUNNING" },
  });
  if (runningTurn > 0 && !data.isEmptyReplyRetry) {
    console.info(
      `[cursor-start] defer — turn in flight cr=${cr.id}`,
    );
    await enqueueJob("cursor.start-agent", data, {
      delay: 5000,
      jobId: `cursor-start-${cr.id}`,
    });
    return { deferred: true, reason: "turn_in_flight" };
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
      attachmentRef: data.attachmentRef,
      attachmentRefs: data.attachmentRefs,
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
  let prompt =
    data.mode === "plan" && !data.prompt.includes("PLANNING mode")
      ? `${planningAgentInstructions()}\n\n${data.prompt}`
      : data.prompt;
  let images: Array<{ data: string; mimeType: string }> | undefined;

  const attachmentRefs = normalizeAttachmentRefs(data);
  const priorMeta = (cr.planningMeta ?? {}) as PlanningMeta;
  if (attachmentRefs.length) {
    if (data.mode === "plan") {
      await writeLiveProgress(cr.id, priorMeta, "Reading your attached files…");
    }
    const attached = await loadPlanningAttachmentsForAgent({
      companyId: data.companyId,
      projectId: cr.projectId,
      attachmentRefs,
      repoWrite: {
        installationId: repo.installationId ?? "0",
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        branch: branchName,
      },
      onProgress:
        data.mode === "plan"
          ? (label) => writeLiveProgress(cr.id, priorMeta, label)
          : undefined,
    });
    const attachError = attachmentLoadFailureMessage(
      attachmentRefs,
      attached.fileNames.length,
    );
    if (attachError) {
      if (data.mode === "plan") {
        await failPlanningTurn({
          changeRequestId: cr.id,
          priorMeta,
          reason: attachError,
        });
        return { ok: false, reason: attachError };
      }
      throw new Error(attachError);
    }
    if (attached.promptSection) {
      prompt = `${prompt}\n\n${attached.promptSection}`;
    }
    images = attached.images.length ? attached.images : undefined;
  }

  console.info(
    `[cursor-start] LIVE start mode=${data.mode} cr=${cr.id} kind=${cr.kind} attachmentRefs=${attachmentRefs.join(",") || "none"} images=${images?.length ?? 0}`,
  );

  const { agentId, wait, run, runId: immediateRunId } = await createTaskAgent({
    repoUrl,
    branch: branchName,
    prompt,
    mode: data.mode,
    images,
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
      cursorRunId: immediateRunId,
      mode: data.mode === "plan" ? "PLAN" : "AGENT",
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  await db.changeRequest.update({
    where: { id: cr.id },
    data: {
      cursorAgentId: agentId,
      ...(data.mode === "plan"
        ? {
            planningMeta: {
              ...priorMeta,
              liveProgress: "Connecting…",
              liveDraft: null,
            },
            updatedAt: new Date(),
          }
        : {}),
    },
  });

  let streamedText = "";
  let result: Awaited<ReturnType<typeof wait>>;
  const turnStartedMs = Date.now();
  let stopHeartbeat: (() => void) | undefined;

  try {
    if (data.mode === "plan") {
      await markTurnInFlight(cr.id, priorMeta, "Connecting…");
      stopHeartbeat = startPlanningHeartbeat({
        changeRequestId: cr.id,
        priorMeta,
        startedAt: turnStartedMs,
        baseLabel: "Connecting planning session",
      });
    }

    const [waitResult, mirrored] = await Promise.all([
      withTimeout(wait(), AGENT_TURN_TIMEOUT_MS, "AI reply"),
      data.mode === "plan"
        ? mirrorPlanningStream({
            changeRequestId: cr.id,
            priorMeta,
            stream: run,
          })
        : Promise.resolve(""),
    ]);
    result = waitResult;
    streamedText = mirrored;
  } catch (error) {
    stopHeartbeat?.();
    const current = await db.agentRun.findUnique({ where: { id: agentRun.id } });
    if (current?.status === "CANCELLED") {
      console.info(`[cursor-start] cancelled mid-wait cr=${cr.id}`);
      if (data.mode === "plan") await clearLiveProgress(cr.id, priorMeta);
      return { agentId, mode: data.mode, cancelled: true };
    }
    await db.agentRun.update({
      where: { id: agentRun.id },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    const reason = error instanceof Error ? error.message : "Something went wrong";
    const isTimeout = /timed out/i.test(reason);
    if (data.mode === "plan") {
      await failPlanningTurn({
        changeRequestId: cr.id,
        priorMeta,
        reason,
        agentRunId: agentRun.id,
        hadAttachments: attachmentRefs.length > 0,
        wasLongMessage: Boolean(data.wasLongMessage),
        isTimeout,
        userMessageId: data.userMessageId,
      });
      return { ok: false, reason, agentId, mode: data.mode };
    }
    await postTurnMessage(cr.id, planningTurnErrorMessage(reason), "ASSISTANT");
    throw error;
  }

  stopHeartbeat?.();

  const afterWait = await db.agentRun.findUnique({ where: { id: agentRun.id } });
  if (afterWait?.status === "CANCELLED") {
    console.info(`[cursor-start] cancelled after wait cr=${cr.id}`);
    if (data.mode === "plan") await clearLiveProgress(cr.id, priorMeta);
    return { agentId, mode: data.mode, cancelled: true };
  }

  await db.agentRun.update({
    where: { id: agentRun.id },
    data: {
      cursorRunId: result.runId ?? immediateRunId,
      status: "SUCCEEDED",
      finishedAt: new Date(),
    },
  });

  if (data.mode === "plan") {
    const freshMeta = ((
      await db.changeRequest.findUnique({
        where: { id: cr.id },
        select: { planningMeta: true },
      })
    )?.planningMeta ?? priorMeta) as PlanningMeta;

    if (
      isEmptyAgentReply(result, streamedText, freshMeta.liveDraft) &&
      (await scheduleEmptyReplyRetry({
        changeRequestId: cr.id,
        priorMeta: freshMeta,
        jobName: "cursor.start-agent",
        jobData: data,
        result,
        streamedText,
        hadAttachments: attachmentRefs.length > 0,
        wasLongMessage: Boolean(data.wasLongMessage),
      }))
    ) {
      await db.agentRun.update({
        where: { id: agentRun.id },
        data: { status: "SUCCEEDED", finishedAt: new Date() },
      });
      return { ok: false, retryScheduled: true, agentId, mode: data.mode };
    }

    await finalizePlanModeTurn({
      changeRequestId: cr.id,
      priorMeta: freshMeta,
      result,
      streamedText,
      userPrompt: data.prompt,
      hadAttachments: attachmentRefs.length > 0,
    });
    await flushQueuedFollowUp(cr.id, data.companyId);
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
    if (result.text?.trim()) {
      await db.changeRequestMessage.create({
        data: {
          changeRequestId: cr.id,
          role: "ASSISTANT",
          content: result.text,
          cursorRunId: result.runId,
          model: result.model,
        },
      });
    } else {
      await postTurnMessage(
        cr.id,
        planningTurnErrorMessage("The AI session finished without a reply", {
          hadAttachments: attachmentRefs.length > 0,
        }),
        "ASSISTANT",
        { cursorRunId: result.runId, model: result.model },
      );
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
