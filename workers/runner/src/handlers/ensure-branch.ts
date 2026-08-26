import { db } from "@automation-studio/db";
import { buildBranchName, slugify } from "@automation-studio/domain";
import { createBranchFromDefault } from "@automation-studio/github";
import { enqueueJob, type EnsureBranchJobData } from "@automation-studio/jobs";
import { writeAuditEvent } from "@automation-studio/auth";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleEnsureBranch(data: EnsureBranchJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: {
      createdBy: true,
      project: { include: { repository: true } },
    },
  });

  const repo = cr.project.repository;
  if (!repo) {
    await transitionChangeRequest({
      changeRequestId: cr.id,
      companyId: data.companyId,
      toStatus: "FAILED",
      reason: "Project has no connected GitHub repository",
    });
    throw new Error("No repository connected");
  }

  const shortDescription = cr.shortDescription ?? slugify(cr.title);
  const branchName =
    cr.branchName ??
    buildBranchName({
      userSlug: cr.createdBy.slug,
      taskId: cr.number,
      shortDescription,
    });

  const result = await createBranchFromDefault({
    installationId: repo.installationId ?? "0",
    owner: repo.githubOwner,
    repo: repo.githubRepo,
    branchName,
    defaultBranch: repo.defaultBranch,
  });

  await db.changeRequest.update({
    where: { id: cr.id },
    data: { branchName, shortDescription },
  });

  await writeAuditEvent({
    companyId: data.companyId,
    actorId: cr.createdById,
    action: "github.branch_created",
    entityType: "change_request",
    entityId: cr.id,
    metadata: { branchName, sha: result.sha },
  });

  const needsPlan = cr.classification === "COMPLEX" || cr.classification === "HIGH_RISK";

  await enqueueJob("cursor.start-agent", {
    changeRequestId: cr.id,
    companyId: data.companyId,
    mode: needsPlan ? "plan" : "agent",
    prompt: `${cr.title}\n\n${cr.description}`.trim(),
  });

  return { branchName };
}
