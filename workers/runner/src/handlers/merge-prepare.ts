import { db } from "@automation-studio/db";
import { compareBranchToDefault } from "@automation-studio/github";
import type { MergePrepareJobData } from "@automation-studio/jobs";
import { writeAuditEvent } from "@automation-studio/auth";

export async function handleMergePrepare(data: MergePrepareJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: {
      pullRequests: true,
      project: { include: { repository: true } },
    },
  });

  const repo = cr.project.repository;
  if (!repo || !cr.branchName) {
    return {
      changeRequestId: cr.id,
      prNumber: cr.pullRequests[0]?.githubPrNumber ?? null,
      needsRebase: false,
      reason: "Missing repository or branch",
    };
  }

  const comparison = await compareBranchToDefault({
    installationId: repo.installationId ?? "0",
    owner: repo.githubOwner,
    repo: repo.githubRepo,
    branch: cr.branchName,
    defaultBranch: repo.defaultBranch,
  });

  await writeAuditEvent({
    companyId: data.companyId,
    action: "merge.prepare",
    entityType: "change_request",
    entityId: cr.id,
    metadata: comparison,
  });

  if (comparison.needsRebase) {
    await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        role: "SYSTEM",
        content:
          "Main has moved since this change was prepared. A developer should rebase and re-run checks before merge.",
      },
    });
  }

  return {
    changeRequestId: cr.id,
    prNumber: cr.pullRequests[0]?.githubPrNumber ?? null,
    ...comparison,
  };
}
