import { type JobsOptions } from "bullmq";
import { getAutomationQueue } from "./queue.js";
import {
  jobPriority,
  queueBackoffDelayMs,
  queueDefaultAttempts,
  queueMaxWaiting,
  queueRemoveOnCompleteCount,
  queueRemoveOnFailCount,
} from "./config.js";
import { type JobDataMap, type JobName } from "./types.js";

export async function enqueueJob<T extends JobName>(
  name: T,
  data: JobDataMap[T],
  opts?: {
    jobId?: string;
    delay?: number;
    priority?: number;
    mode?: "plan" | "agent";
  },
) {
  const q = getAutomationQueue();
  const maxWaiting = queueMaxWaiting();
  if (maxWaiting > 0) {
    const counts = await q.getJobCounts("waiting", "delayed");
    const waiting = (counts.waiting ?? 0) + (counts.delayed ?? 0);
    if (waiting >= maxWaiting) {
      throw new Error(
        `Job queue is full (${waiting} waiting). Try again in a moment.`,
      );
    }
  }

  const mode =
    opts?.mode ??
    (typeof data === "object" && data && "mode" in data
      ? (data as { mode?: "plan" | "agent" }).mode
      : undefined);

  const jobOpts: JobsOptions = {
    jobId: opts?.jobId,
    delay: opts?.delay,
    priority: opts?.priority ?? jobPriority(name, mode),
    attempts: queueDefaultAttempts(),
    backoff: { type: "exponential", delay: queueBackoffDelayMs() },
    removeOnComplete: queueRemoveOnCompleteCount(),
    removeOnFail: queueRemoveOnFailCount(),
  };

  return q.add(name, data, jobOpts);
}
