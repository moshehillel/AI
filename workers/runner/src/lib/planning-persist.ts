import { db } from "@automation-studio/db";
import {
  preferPlanMarkdown,
  splitPlanFromReply,
  type PlanningMeta,
} from "@automation-studio/domain";

export async function clearLiveProgress(
  changeRequestId: string,
  priorMeta: PlanningMeta,
) {
  const { liveProgress: _p, liveDraft: _d, ...rest } = priorMeta;
  await db.changeRequest.update({
    where: { id: changeRequestId },
    data: {
      planningMeta: {
        ...rest,
        liveProgress: null,
        liveDraft: null,
      },
      updatedAt: new Date(),
    },
  });
}

/** Persist chat + plan separately after a plan-mode agent turn. */
export async function persistPlanModeReply(opts: {
  changeRequestId: string;
  priorMeta: PlanningMeta;
  rawText: string;
  cursorRunId?: string;
  model?: string;
}) {
  const priorPlan =
    opts.priorMeta.planMarkdown ??
    (
      await db.plan.findFirst({
        where: { changeRequestId: opts.changeRequestId },
        orderBy: { createdAt: "desc" },
      })
    )?.content ??
    null;

  const split = splitPlanFromReply(opts.rawText, priorPlan);
  const planMarkdown = preferPlanMarkdown(split.planMarkdown, priorPlan);
  const chatContent = split.chatContent.trim() || opts.rawText.trim();

  if (chatContent) {
    await db.changeRequestMessage.create({
      data: {
        changeRequestId: opts.changeRequestId,
        role: "ASSISTANT",
        content: chatContent,
        cursorRunId: opts.cursorRunId,
        model: opts.model,
      },
    });
  }

  if (planMarkdown) {
    await db.plan.create({
      data: {
        changeRequestId: opts.changeRequestId,
        content: planMarkdown,
      },
    });
  }

  const { liveProgress: _p, liveDraft: _d, ...rest } = opts.priorMeta;
  await db.changeRequest.update({
    where: { id: opts.changeRequestId },
    data: {
      planningMeta: {
        ...rest,
        planMarkdown: planMarkdown || priorPlan,
        liveProgress: null,
        liveDraft: null,
      },
      updatedAt: new Date(),
    },
  });

  return { chatContent, planMarkdown };
}
