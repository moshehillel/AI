import { getRedisConnection } from "./redis.js";
import { maxConcurrentCursorAgents } from "./config.js";

const SLOT_KEY = "koda:cursor:active-slots";

/** Acquire a global Cursor agent slot (blocks up to timeoutMs). */
export async function acquireCursorSlot(timeoutMs = 120_000): Promise<boolean> {
  const limit = maxConcurrentCursorAgents();
  const redis = getRedisConnection();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = await redis.incr(SLOT_KEY);
    if (current <= limit) {
      return true;
    }
    await redis.decr(SLOT_KEY);
    await sleep(Math.min(2000, 250 + Math.random() * 500));
  }
  return false;
}

export async function releaseCursorSlot(): Promise<void> {
  const redis = getRedisConnection();
  const next = await redis.decr(SLOT_KEY);
  if (next < 0) {
    await redis.set(SLOT_KEY, "0");
  }
}

/** Current slot usage for ops visibility. */
export async function cursorSlotStats(): Promise<{
  active: number;
  limit: number;
}> {
  const redis = getRedisConnection();
  const raw = await redis.get(SLOT_KEY);
  const active = Math.max(0, Number.parseInt(raw ?? "0", 10) || 0);
  return { active, limit: maxConcurrentCursorAgents() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
