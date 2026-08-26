import { db } from "@automation-studio/db";
import type { MergePrepareJobData } from "@automation-studio/jobs";

export async function handleMergePrepare(data: MergePrepareJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: { pullRequests: true, project: { include: { repository: true } } },
  });

  // Freshness placeholder: in a later iteration compare base SHA to main HEAD
  // and enqueue rebase + re-test when drifted.
  return {
    changeRequestId: cr.id,
    prNumber: cr.pullRequests[0]?.githubPrNumber ?? null,
    needsRebase: false,
  };
}
