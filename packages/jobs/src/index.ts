import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { QUEUE_NAME, type JobDataMap, type JobName } from "./types.js";

let connection: Redis | null = null;
let queue: Queue | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    connection = new Redis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getQueueConnection(): ConnectionOptions {
  return getRedisConnection();
}

export function getAutomationQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getQueueConnection() });
  }
  return queue;
}

export async function enqueueJob<T extends JobName>(
  name: T,
  data: JobDataMap[T],
  opts?: { jobId?: string; delay?: number },
) {
  const q = getAutomationQueue();
  return q.add(name, data, {
    jobId: opts?.jobId,
    delay: opts?.delay,
    attempts: 5,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

export { QUEUE_NAME };
export * from "./types.js";
