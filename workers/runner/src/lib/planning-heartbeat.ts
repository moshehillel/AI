import { db } from "@automation-studio/db";
import type { PlanningMeta } from "@automation-studio/domain";
import { writeLiveProgress } from "./planning-turn.js";

const HEARTBEAT_MS = 12_000;

/** Customer-facing labels while waiting on Cursor during long turns. */
const WAIT_STEPS = [
  "Still working on your note…",
  "Reviewing details…",
  "Drafting a reply…",
  "Almost there…",
];

export function startPlanningHeartbeat(opts: {
  changeRequestId: string;
  priorMeta: PlanningMeta;
  startedAt: number;
  baseLabel?: string;
}): () => void {
  let tick = 0;
  const interval = setInterval(() => {
    tick += 1;
    const elapsedSec = Math.max(1, Math.round((Date.now() - opts.startedAt) / 1000));
    const step = WAIT_STEPS[Math.min(tick - 1, WAIT_STEPS.length - 1)]!;
    const label = opts.baseLabel
      ? `${opts.baseLabel} (${elapsedSec}s)`
      : `${step} (${elapsedSec}s)`;

    void (async () => {
      await db.changeRequest.update({
        where: { id: opts.changeRequestId },
        data: {
          planningMeta: {
            ...opts.priorMeta,
            workerHeartbeatAt: new Date().toISOString(),
            liveProgress: label,
          },
          updatedAt: new Date(),
        },
      });
    })().catch((error) => {
      console.warn("[planning-heartbeat] tick failed", error);
    });
  }, HEARTBEAT_MS);

  return () => clearInterval(interval);
}

export async function markTurnInFlight(
  changeRequestId: string,
  priorMeta: PlanningMeta,
  label = "Starting…",
) {
  await writeLiveProgress(changeRequestId, priorMeta, label);
  await db.changeRequest.update({
    where: { id: changeRequestId },
    data: {
      planningMeta: {
        ...priorMeta,
        inFlightTurnAt: new Date().toISOString(),
        workerHeartbeatAt: new Date().toISOString(),
        lastFailedUserMessageId: null,
      },
      updatedAt: new Date(),
    },
  });
}

export async function clearTurnInFlight(
  changeRequestId: string,
  priorMeta: PlanningMeta,
  extra?: Partial<PlanningMeta>,
) {
  const { inFlightTurnAt: _a, workerHeartbeatAt: _b, ...rest } = priorMeta;
  await db.changeRequest.update({
    where: { id: changeRequestId },
    data: {
      planningMeta: {
        ...rest,
        ...extra,
        inFlightTurnAt: null,
        workerHeartbeatAt: null,
      },
      updatedAt: new Date(),
    },
  });
}

export async function flushQueuedFollowUp(changeRequestId: string, companyId: string) {
  const cr = await db.changeRequest.findUnique({
    where: { id: changeRequestId },
    select: { planningMeta: true },
  });
  const meta = (cr?.planningMeta ?? {}) as PlanningMeta;
  const queued = meta.queuedFollowUp;
  if (!queued?.prompt?.trim()) return false;

  const { enqueueJob } = await import("@automation-studio/jobs");
  await db.changeRequest.update({
    where: { id: changeRequestId },
    data: {
      planningMeta: {
        ...meta,
        queuedFollowUp: null,
      },
      updatedAt: new Date(),
    },
  });

  await enqueueJob(
    "cursor.follow-up",
    {
      changeRequestId,
      companyId,
      prompt: queued.prompt,
      mode: "plan",
      attachmentRefs: queued.attachmentRefs,
      userMessageId: queued.userMessageId,
    },
    { jobId: `cursor-follow-up-${changeRequestId}` },
  );
  console.info(
    `[planning-heartbeat] flushed queued follow-up cr=${changeRequestId}`,
  );
  return true;
}
