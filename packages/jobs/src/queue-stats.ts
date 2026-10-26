import { getAutomationQueue, QUEUE_NAME } from "./queue.js";
import { cursorSlotStats } from "./cursor-slots.js";

export type QueueVisibility = {
  queueName: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completedRecent: number;
  cursorSlots: { active: number; limit: number };
  /** Position of a program's cursor job if waiting (1-based), else null. */
  programQueuePosition?: number | null;
};

export async function getQueueVisibility(input?: {
  changeRequestId?: string;
}): Promise<QueueVisibility> {
  const queue = getAutomationQueue();
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "failed",
    "completed",
  );
  const cursorSlots = await cursorSlotStats();

  let programQueuePosition: number | null = null;
  if (input?.changeRequestId) {
    programQueuePosition = await findProgramQueuePosition(
      input.changeRequestId,
    );
  }

  return {
    queueName: QUEUE_NAME,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completedRecent: counts.completed ?? 0,
    cursorSlots,
    programQueuePosition,
  };
}

async function findProgramQueuePosition(
  changeRequestId: string,
): Promise<number | null> {
  const queue = getAutomationQueue();
  const waiting = await queue.getJobs(["waiting", "delayed"], 0, 200);
  const cursorJobs = waiting.filter(
    (job) =>
      (job.name === "cursor.start-agent" || job.name === "cursor.follow-up") &&
      (job.data as { changeRequestId?: string })?.changeRequestId ===
        changeRequestId,
  );
  if (!cursorJobs.length) return null;
  const earliest = cursorJobs.sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
  )[0];
  if (!earliest) return null;
  const allWaiting = waiting
    .filter(
      (job) =>
        job.name === "cursor.start-agent" || job.name === "cursor.follow-up",
    )
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const idx = allWaiting.findIndex((j) => j.id === earliest.id);
  return idx >= 0 ? idx + 1 : null;
}

/** Plain-English status when Cursor is under load. */
export function highDemandMessage(stats: QueueVisibility): string | null {
  const { cursorSlots, programQueuePosition, waiting } = stats;
  if (cursorSlots.active >= cursorSlots.limit && programQueuePosition) {
    return `Koda is in high demand right now — your request is queued (position ${programQueuePosition}). We'll reply as soon as a slot opens.`;
  }
  if (waiting > 20 && programQueuePosition && programQueuePosition > 3) {
    return `Koda is busy with other programs — you're number ${programQueuePosition} in the queue. Thanks for waiting.`;
  }
  if (cursorSlots.active >= cursorSlots.limit) {
    return "Koda is in high demand right now — your request is queued. We'll reply shortly.";
  }
  return null;
}
