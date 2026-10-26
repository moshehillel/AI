import { db } from "@automation-studio/db";
import { cancelAgentRun } from "@automation-studio/cursor-adapter";
import type { CursorCancelJobData } from "@automation-studio/jobs";

export async function handleCursorCancel(data: CursorCancelJobData) {
  const result = await cancelAgentRun({
    agentId: data.agentId,
    runId: data.runId,
  });

  if (data.agentRunId) {
    await db.agentRun.updateMany({
      where: {
        id: data.agentRunId,
        status: { in: ["RUNNING", "CANCELLED"] },
      },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
  }

  return result;
}
