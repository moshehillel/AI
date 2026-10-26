import { createServer } from "node:http";
import { db } from "@automation-studio/db";
import {
  cursorSlotStats,
  getAutomationQueue,
  getRedisConnection,
  workerConcurrency,
} from "@automation-studio/jobs";

export function startWorkerHealthServer(port = 8081): void {
  const listenPort = Number.parseInt(process.env.WORKER_HEALTH_PORT ?? String(port), 10);

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";

    if (url === "/health" || url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "koda-worker",
          concurrency: workerConcurrency(),
          time: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url === "/ready" || url === "/readyz") {
      try {
        await db.$queryRaw`SELECT 1`;
        await getRedisConnection().ping();
        const queue = getAutomationQueue();
        const counts = await queue.getJobCounts("waiting", "active", "failed");
        const slots = await cursorSlotStats();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            queue: counts,
            cursorSlots: slots,
          }),
        );
      } catch (error) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(listenPort, "0.0.0.0", () => {
    console.log(`[worker] health listening on :${listenPort}`);
  });
}
