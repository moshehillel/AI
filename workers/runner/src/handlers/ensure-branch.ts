import { db, ensurePlanningRepository } from "@automation-studio/db";
import {
  buildBranchName,
  buildPlanningStartPrompt,
  getDefaultGithubRepoConfig,
  slugify,
  type PlanningMeta,
} from "@automation-studio/domain";
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
      messages: { orderBy: { createdAt: "asc" }, take: 40 },
    },
  });

  let repo = cr.project.repository;
  if (!repo) {
    repo = await ensurePlanningRepository(db, {
      projectId: cr.projectId,
      companyId: data.companyId,
      defaults: getDefaultGithubRepoConfig(),
    });
  }
  if (!repo) {
    await transitionChangeRequest({
      changeRequestId: cr.id,
      companyId: data.companyId,
      toStatus: "FAILED",
      reason: "Project has no connected repository",
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

  const needsPlan =
    cr.kind === "PROGRAM" ||
    cr.classification === "COMPLEX" ||
    cr.classification === "HIGH_RISK";

  // Programs only leave plan mode after developer starts a build (BUILDING).
  const mode =
    cr.kind === "PROGRAM" && cr.status !== "BUILDING" ? "plan" : needsPlan ? "plan" : "agent";

  const prompt =
    mode === "plan"
      ? buildPlanningStartPrompt({
          title: cr.title,
          description: cr.description,
          messages: cr.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          planningMeta: (cr.planningMeta ?? {}) as PlanningMeta,
        })
      : `${cr.title}\n\n${cr.description}`.trim();

  await enqueueJob("cursor.start-agent", {
    changeRequestId: cr.id,
    companyId: data.companyId,
    mode: mode as "plan" | "agent",
    prompt,
    attachmentRef:
      ((cr.planningMeta ?? {}) as PlanningMeta).pendingAttachmentRef ??
      undefined,
    attachmentRefs:
      ((cr.planningMeta ?? {}) as PlanningMeta).pendingAttachmentRefs ??
      undefined,
  });

  // Clear one-shot pending attachment so it is not re-sent on later starts.
  const priorMeta = (cr.planningMeta ?? {}) as PlanningMeta;
  if (priorMeta.pendingAttachmentRef || priorMeta.pendingAttachmentRefs?.length) {
    await db.changeRequest.update({
      where: { id: cr.id },
      data: {
        planningMeta: {
          ...priorMeta,
          pendingAttachmentRef: null,
          pendingAttachmentRefs: null,
        } as object,
        updatedAt: new Date(),
      },
    });
  }

  return { branchName };
}
