import { Queue, type ConnectionOptions } from "bullmq";
import { getRedisConnection } from "./redis.js";
import { QUEUE_NAME } from "./types.js";

let queue: Queue | null = null;

export function getQueueConnection(): ConnectionOptions {
  return getRedisConnection();
}

export function getAutomationQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getQueueConnection() });
  }
  return queue;
}

export { QUEUE_NAME };
