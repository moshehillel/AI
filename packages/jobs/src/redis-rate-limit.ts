import { getRedisConnection } from "./redis.js";

export type RateLimitResult =
  | { ok: true; remaining: number; resetAtMs: number }
  | { ok: false; remaining: 0; resetAtMs: number; retryAfterSec: number };

/**
 * Fixed-window rate limiter backed by Redis (INCR + EXPIRE).
 * Safe across web replicas when REDIS_URL is shared.
 */
export async function checkRateLimit(input: {
  key: string;
  limit: number;
  windowSec: number;
}): Promise<RateLimitResult> {
  const redis = getRedisConnection();
  const bucket = `koda:rl:${input.key}:${Math.floor(Date.now() / (input.windowSec * 1000))}`;
  const count = await redis.incr(bucket);
  if (count === 1) {
    await redis.expire(bucket, input.windowSec + 1);
  }
  const resetAtMs =
    (Math.floor(Date.now() / (input.windowSec * 1000)) + 1) *
    input.windowSec *
    1000;
  if (count > input.limit) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((resetAtMs - Date.now()) / 1000),
    );
    return { ok: false, remaining: 0, resetAtMs, retryAfterSec };
  }
  return {
    ok: true,
    remaining: Math.max(0, input.limit - count),
    resetAtMs,
  };
}
