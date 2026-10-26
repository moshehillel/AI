import { enqueueJob } from "@automation-studio/jobs";
import type { AgentRunResult } from "@automation-studio/cursor-adapter";
import type { PlanningMeta } from "@automation-studio/domain";
import type { CursorFollowUpJobData, CursorStartJobData } from "@automation-studio/jobs";
import { writeLiveProgress } from "./planning-turn.js";

const EMPTY_REPLY_RETRY_DELAY_MS = 8000;

type TurnJobData = CursorFollowUpJobData | CursorStartJobData;

/**
 * Schedule one automatic retry when Cursor returns empty text.
 * Returns true if a retry was enqueued (caller should skip error UI).
 */
export async function scheduleEmptyReplyRetry(opts: {
  changeRequestId: string;
  priorMeta: PlanningMeta;
  jobName: "cursor.follow-up" | "cursor.start-agent";
  jobData: TurnJobData;
  result: AgentRunResult;
  streamedText?: string | null;
  hadAttachments?: boolean;
  wasLongMessage?: boolean;
}): Promise<boolean> {
  if (opts.jobData.isEmptyReplyRetry) return false;

  const raw =
    opts.result.text?.trim() ||
    opts.streamedText?.trim() ||
    opts.priorMeta.liveDraft?.trim() ||
    "";
  if (raw) return false;

  console.info(
    `[planning-empty-retry] scheduling retry cr=${opts.changeRequestId} job=${opts.jobName} attachments=${Boolean(opts.hadAttachments)} long=${Boolean(opts.wasLongMessage)}`,
  );

  await writeLiveProgress(
    opts.changeRequestId,
    opts.priorMeta,
    "Still working — retrying your note…",
  );

  const retryData = {
    ...opts.jobData,
    isEmptyReplyRetry: true,
  };

  if (opts.jobName === "cursor.follow-up") {
    await enqueueJob("cursor.follow-up", retryData as CursorFollowUpJobData, {
      delay: EMPTY_REPLY_RETRY_DELAY_MS,
      jobId: `cursor-follow-up-retry-${opts.changeRequestId}`,
    });
  } else {
    await enqueueJob("cursor.start-agent", retryData as CursorStartJobData, {
      delay: EMPTY_REPLY_RETRY_DELAY_MS,
      jobId: `cursor-start-retry-${opts.changeRequestId}`,
    });
  }

  return true;
}
