import { NextResponse } from "next/server";
import { db } from "@automation-studio/db";
import { getRedisConnection } from "@automation-studio/jobs";
import { sseStats } from "@/lib/sse-limits";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, unknown> = {};
  let ok = true;

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (error) {
    ok = false;
    checks.database =
      error instanceof Error ? error.message : "database unavailable";
  }

  try {
    const pong = await getRedisConnection().ping();
    checks.redis = pong === "PONG";
    if (pong !== "PONG") ok = false;
  } catch (error) {
    ok = false;
    checks.redis =
      error instanceof Error ? error.message : "redis unavailable";
  }

  checks.sse = sseStats();

  return NextResponse.json(
    {
      ok,
      service: "koda",
      ready: ok,
      checks,
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
