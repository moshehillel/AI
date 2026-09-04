import {
  workerConcurrency,
  workerMaxStalledCount,
  workerStalledIntervalMs,
  acquireCursorSlot,
  releaseCursorSlot,
  getQueueConnection,
  QUEUE_NAME,
  type JobName,
} from "@automation-studio/jobs";
import { Worker, type Job } from "bullmq";
import { db } from "@automation-studio/db";
import {
  failPlanningTurn,
  planningTurnErrorMessage,
  postTurnMessage,
} from "./lib/planning-turn.js";
import type { PlanningMeta } from "@automation-studio/domain";
import { handleClassify } from "./handlers/classify.js";
import { handleEnsureBranch } from "./handlers/ensure-branch.js";
import { handleCursorStart } from "./handlers/cursor-start.js";
import { handleCursorFollowUp } from "./handlers/cursor-follow-up.js";
import { handleCursorCancel } from "./handlers/cursor-cancel.js";
import { handleEnsurePr } from "./handlers/ensure-pr.js";
import { handleSyncChecks } from "./handlers/sync-checks.js";
import { handleSyncPreview } from "./handlers/sync-preview.js";
import { handleTransition } from "./handlers/transition.js";
import { handleUsageRecord } from "./handlers/usage-record.js";
import { handleMergePrepare } from "./handlers/merge-prepare.js";
import { startWorkerHealthServer } from "./health.js";

const CURSOR_JOBS = new Set<JobName>([
  "cursor.start-agent",
  "cursor.follow-up",
]);

async function processJobInner(job: Job) {
  const name = job.name as JobName;
  switch (name) {
    case "change-request.classify":
      return handleClassify(job.data);
    case "github.ensure-branch":
      return handleEnsureBranch(job.data);
    case "cursor.start-agent":
      return handleCursorStart(job.data);
    case "cursor.follow-up":
      return handleCursorFollowUp(job.data);
    case "cursor.cancel":
      return handleCursorCancel(job.data);
    case "github.ensure-pr":
      return handleEnsurePr(job.data);
    case "ci.sync-checks":
      return handleSyncChecks(job.data);
    case "railway.sync-preview":
      return handleSyncPreview(job.data);
    case "change-request.transition":
      return handleTransition(job.data);
    case "usage.record":
      return handleUsageRecord(job.data);
    case "merge.prepare":
      return handleMergePrepare(job.data);
    case "cursor.poll-or-stream":
      return { skipped: true };
    default:
      throw new Error(`Unknown job: ${name}`);
  }
}

async function processJob(job: Job) {
  if (!CURSOR_JOBS.has(job.name as JobName)) {
    return processJobInner(job);
  }

  const acquired = await acquireCursorSlot();
  if (!acquired) {
    const delayMs = 5000 + Math.floor(Math.random() * 5000);
    console.warn(
      `[worker] cursor slot unavailable — requeue ${job.name} (${job.id}) in ${delayMs}ms`,
    );
    await job.moveToDelayed(Date.now() + delayMs);
    return { deferred: true, reason: "cursor_slots_full" };
  }

  try {
    return await processJobInner(job);
  } finally {
    await releaseCursorSlot();
  }
}

export function createWorker() {
  return new Worker(QUEUE_NAME, processJob, {
    connection: getQueueConnection(),
    concurrency: workerConcurrency(),
    stalledInterval: workerStalledIntervalMs(),
    maxStalledCount: workerMaxStalledCount(),
  });
}

export function attachWorkerLifecycle(worker: Worker): void {
  worker.on("completed", (job) => {
    console.log(`[worker] completed ${job.name} (${job.id})`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[worker] failed ${job?.name} (${job?.id})`, error);
    void (async () => {
      if (!job?.data || typeof job.data !== "object") return;
      const data = job.data as {
        changeRequestId?: string;
        companyId?: string;
      };
      if (!data.changeRequestId) return;
      if (
        job.name !== "cursor.follow-up" &&
        job.name !== "cursor.start-agent"
      ) {
        return;
      }

      const cr = await db.changeRequest.findFirst({
        where: { id: data.changeRequestId },
      });
      if (!cr) return;

      const recentAssistant = await db.changeRequestMessage.findFirst({
        where: {
          changeRequestId: cr.id,
          role: "ASSISTANT",
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
      });
      if (recentAssistant) return;

      const reason =
        error instanceof Error ? error.message : "Something went wrong";
      const priorMeta = (cr.planningMeta ?? {}) as PlanningMeta;
      if (cr.kind === "PROGRAM" && cr.status === "PLANNING") {
        await failPlanningTurn({
          changeRequestId: cr.id,
          priorMeta,
          reason,
        });
        return;
      }
      await postTurnMessage(
        cr.id,
        planningTurnErrorMessage(reason),
        "ASSISTANT",
      );
    })().catch((postError) => {
      console.error("[worker] failed to post turn error message", postError);
    });
  });

  worker.on("stalled", (jobId) => {
    console.warn(`[worker] stalled job ${jobId} — BullMQ will retry or fail`);
  });
}

export function bootWorker(): Worker {
  startWorkerHealthServer();
  const worker = createWorker();
  attachWorkerLifecycle(worker);
  console.log(
    `[worker] listening on queue ${QUEUE_NAME} (concurrency=${workerConcurrency()})`,
  );
  return worker;
}
