import { Worker, type Job } from "bullmq";
import {
  QUEUE_NAME,
  getQueueConnection,
  type JobName,
} from "@automation-studio/jobs";
import { handleClassify } from "./handlers/classify.js";
import { handleEnsureBranch } from "./handlers/ensure-branch.js";
import { handleCursorStart } from "./handlers/cursor-start.js";
import { handleCursorFollowUp } from "./handlers/cursor-follow-up.js";
import { handleEnsurePr } from "./handlers/ensure-pr.js";
import { handleSyncChecks } from "./handlers/sync-checks.js";
import { handleSyncPreview } from "./handlers/sync-preview.js";
import { handleTransition } from "./handlers/transition.js";
import { handleUsageRecord } from "./handlers/usage-record.js";
import { handleMergePrepare } from "./handlers/merge-prepare.js";

async function processJob(job: Job) {
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

const worker = new Worker(QUEUE_NAME, processJob, {
  connection: getQueueConnection(),
  concurrency: 5,
});

worker.on("completed", (job) => {
  console.log(`[worker] completed ${job.name} (${job.id})`);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] failed ${job?.name} (${job?.id})`, error);
});

console.log(`[worker] listening on queue ${QUEUE_NAME}`);

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
