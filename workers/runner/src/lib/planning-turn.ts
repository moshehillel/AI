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
export function planningTurnErrorMessage(
  reason: string,
  opts?: { hadAttachments?: boolean; isMetaQuestion?: boolean },
): string {
  const detail = reason.trim().replace(/\.$/, "");
  const retryHint = opts?.isMetaQuestion
    ? "You can send your original question again and I will pick up where we left off."
    : opts?.hadAttachments
      ? "Try **Interrupt**, then send your message again with one file at a time or a smaller PDF."
      : "Try sending your message again. If it is very long, split it into two shorter messages.";

  return [
    "Sorry — I couldn't finish that reply.",
    detail ? `${detail}.` : "",
    retryHint,
  ]
    .filter(Boolean)
    .join(" ");
}

const META_STOP_QUESTION_RE =
  /\b(why (was|did) (it |you )?stop|why stopped|what happened|why didn't you (reply|respond|finish)|why no (reply|response))\b/i;

export function isMetaStopQuestion(text: string): boolean {
  return META_STOP_QUESTION_RE.test(text.trim());
}

export function metaStopExplanation(opts: {
  hadAttachments: boolean;
  wasInterrupted: boolean;
}): string {
  if (opts.wasInterrupted) {
    return [
      "That turn was **interrupted** — either you clicked Interrupt or a new message replaced the in-flight reply.",
      "",
      "Nothing was lost from your chat history. Send your question again (or edit and resend from the queue) and I will answer normally.",
    ].join("\n");
  }
  if (opts.hadAttachments) {
    return [
      "The last turn ended before a reply was saved — this sometimes happens with large or multiple file uploads.",
      "",
      "Your message is still in the thread. Try again with one smaller file, or paste the key details as text.",
    ].join("\n");
  }
  return [
    "The last turn ended before a reply was saved — the AI session returned empty even though it may have been thinking.",
    "",
    "Your message is still in the thread. Please send it again (split very long notes into two messages if needed).",
  ].join("\n");
}

export async function failPlanningTurn(opts: {
  changeRequestId: string;
  priorMeta: PlanningMeta;
  reason: string;
  agentRunId?: string;
  hadAttachments?: boolean;
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
    planningTurnErrorMessage(opts.reason, {
      hadAttachments: opts.hadAttachments,
    }),
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
  streamedText?: string | null;
  userPrompt?: string;
  hadAttachments?: boolean;
  wasInterrupted?: boolean;
}) {
  const rawText =
    opts.result.text?.trim() ||
    opts.streamedText?.trim() ||
    opts.priorMeta.liveDraft?.trim() ||
    "";

  if (opts.userPrompt && isMetaStopQuestion(opts.userPrompt)) {
    await clearLiveProgress(opts.changeRequestId, opts.priorMeta);
    await postTurnMessage(
      opts.changeRequestId,
      metaStopExplanation({
        hadAttachments: Boolean(opts.hadAttachments),
        wasInterrupted: Boolean(opts.wasInterrupted),
      }),
      "ASSISTANT",
      { cursorRunId: opts.result.runId, model: opts.result.model },
    );
    return;
  }

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

  console.warn(
    `[finalizePlanModeTurn] empty reply cr=${opts.changeRequestId} runId=${opts.result.runId ?? "none"} streamed=${Boolean(opts.streamedText?.trim())} liveDraft=${Boolean(opts.priorMeta.liveDraft?.trim())}`,
  );

  await clearLiveProgress(opts.changeRequestId, opts.priorMeta);
  await postTurnMessage(
    opts.changeRequestId,
    planningTurnErrorMessage(
      "The AI session finished without a reply",
      { hadAttachments: opts.hadAttachments },
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
