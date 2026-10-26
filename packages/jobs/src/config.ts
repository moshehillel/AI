/** Runtime tuning for BullMQ workers and Cursor agent concurrency. */

function readInt(name: string, fallback: number, min = 1, max = 256): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function workerConcurrency(): number {
  return readInt("WORKER_CONCURRENCY", 5, 1, 64);
}

/** Global cap on simultaneous Cursor API agent sessions across all workers. */
export function maxConcurrentCursorAgents(): number {
  return readInt("MAX_CONCURRENT_CURSOR_AGENTS", 8, 1, 128);
}

/** BullMQ stalled-job detection interval (ms). */
export function workerStalledIntervalMs(): number {
  return readInt("WORKER_STALLED_INTERVAL_MS", 30_000, 5_000, 300_000);
}

/** Max times a job may be marked stalled before failing. */
export function workerMaxStalledCount(): number {
  return readInt("WORKER_MAX_STALLED_COUNT", 2, 1, 10);
}

/** Drop completed jobs after this many are kept (per queue). */
export function queueRemoveOnCompleteCount(): number {
  return readInt("QUEUE_REMOVE_ON_COMPLETE", 1000, 100, 50_000);
}

/** Keep failed jobs for inspection / dead-letter review. */
export function queueRemoveOnFailCount(): number {
  return readInt("QUEUE_REMOVE_ON_FAIL", 5000, 100, 100_000);
}

/** Default job attempts before dead-letter. */
export function queueDefaultAttempts(): number {
  return readInt("QUEUE_DEFAULT_ATTEMPTS", 5, 1, 20);
}

/** Exponential backoff base delay (ms). */
export function queueBackoffDelayMs(): number {
  return readInt("QUEUE_BACKOFF_DELAY_MS", 3000, 500, 120_000);
}

/** Optional max waiting jobs before enqueue rejects (0 = unlimited). */
export function queueMaxWaiting(): number {
  return readInt("QUEUE_MAX_WAITING", 0, 0, 1_000_000);
}

/** Lower number = higher priority in BullMQ. */
export function jobPriority(name: string, mode?: "plan" | "agent"): number {
  if (name === "cursor.start-agent" || name === "cursor.follow-up") {
    return mode === "plan" ? 1 : 5;
  }
  if (name.startsWith("cursor.")) return 3;
  if (name.startsWith("github.")) return 4;
  return 10;
}
