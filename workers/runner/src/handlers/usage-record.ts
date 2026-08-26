import { db } from "@automation-studio/db";
import { getAgentUsage } from "@automation-studio/cursor-adapter";
import type { UsageRecordJobData } from "@automation-studio/jobs";

export async function handleUsageRecord(data: UsageRecordJobData) {
  const run = await db.agentRun.findFirstOrThrow({
    where: { id: data.agentRunId },
    include: { changeRequest: true },
  });

  let billedCents = data.billedCents;
  try {
    const usage = await getAgentUsage(run.cursorAgentId);
    const maybeCents = (usage as { totalCents?: number }).totalCents;
    if (typeof maybeCents === "number") billedCents = maybeCents;
  } catch {
    // usage endpoint may be unavailable in mock/beta
  }

  await db.usageRecord.create({
    data: {
      companyId: data.companyId,
      userId: run.changeRequest.createdById,
      projectId: run.changeRequest.projectId,
      changeRequestId: run.changeRequestId,
      agentRunId: run.id,
      provider: "CURSOR",
      inputTokens: data.inputTokens ?? 0,
      outputTokens: data.outputTokens ?? 0,
      totalTokens: data.totalTokens ?? 0,
      billedCents,
      metadata: {
        cursorAgentId: run.cursorAgentId,
        cursorRunId: run.cursorRunId,
      },
    },
  });

  return { recorded: true };
}
