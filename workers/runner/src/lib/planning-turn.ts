import { db } from "@automation-studio/db";
import type { AgentRunResult } from "@automation-studio/cursor-adapter";
import type { PlanningMeta } from "@automation-studio/domain";
import { clearLiveProgress, persistPlanModeReply } from "./planning-persist.js";

/** Max time to wait for a Cursor agent turn before surfacing an error. */
export const AGENT_TURN_TIMEOUT_MS = 8 * 60 * 1000;

export async function writeLiveProgress(
  changeRequestId: string,
  priorMeta: PlanningMeta,
  label: string,
  liveDraft?: string | null,
) {
  await db.changeRequest.update({
    where: { id: changeRequestId },
    data: {
      planningMeta: {
        ...priorMeta,
        liveProgress: label,
        liveDraft: liveDraft ?? priorMeta.liveDraft ?? null,
      },
      updatedAt: new Date(),
    },
  });
}

export async function postTurnMessage(
  changeRequestId: string,
  content: string,
  role: "ASSISTANT" | "SYSTEM" = "ASSISTANT",
  extra?: { cursorRunId?: string; model?: string },
) {
  await db.changeRequestMessage.create({
    data: {
      changeRequestId,
      role,
      content,
      cursorRunId: extra?.cursorRunId,
      model: extra?.model,
    },
  });
}

/** User-visible error when a planning turn fails or times out. */
export function planningTurnErrorMessage(reason: string): string {
  const detail = reason.trim().replace(/\.$/, "");
  return [
    "Sorry — I couldn't finish that reply.",
    detail ? `${detail}.` : "",
    "Try **Interrupt**, then send your message again. If it keeps failing, attach one file at a time or use a smaller PDF.",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function failPlanningTurn(opts: {
  changeRequestId: string;
  priorMeta: PlanningMeta;
  reason: string;
  agentRunId?: string;
}) {
  if (opts.agentRunId) {
    await db.agentRun.updateMany({
      where: { id: opts.agentRunId, status: "RUNNING" },
      data: { status: "FAILED", finishedAt: new Date() },
    });
  }
  await clearLiveProgress(opts.changeRequestId, opts.priorMeta);
  await postTurnMessage(
    opts.changeRequestId,
    planningTurnErrorMessage(opts.reason),
    "ASSISTANT",
  );
}

/**
 * Always leave the chat with an assistant message after a plan-mode turn.
 * Handles empty agent text and persist failures gracefully.
 */
export async function finalizePlanModeTurn(opts: {
  changeRequestId: string;
  priorMeta: PlanningMeta;
  result: AgentRunResult;
}) {
  const rawText = opts.result.text?.trim() ?? "";
  if (rawText) {
    await persistPlanModeReply({
      changeRequestId: opts.changeRequestId,
      priorMeta: opts.priorMeta,
      rawText,
      cursorRunId: opts.result.runId,
      model: opts.result.model,
    });
    return;
  }

  await clearLiveProgress(opts.changeRequestId, opts.priorMeta);
  await postTurnMessage(
    opts.changeRequestId,
    planningTurnErrorMessage(
      "The AI session finished without a reply (this can happen with large file uploads)",
    ),
    "ASSISTANT",
    { cursorRunId: opts.result.runId, model: opts.result.model },
  );
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/** When attachment refs were sent but none could be decrypted/loaded. */
export function attachmentLoadFailureMessage(
  refs: string[],
  loadedCount: number,
): string | null {
  if (!refs.length) return null;
  if (loadedCount > 0) return null;
  return "Could not read the attached file(s). Try uploading again, or send one file at a time.";
}
