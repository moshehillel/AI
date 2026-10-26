import { db } from "@automation-studio/db";
import {
  buildBranchName,
  connectedRepoStartPrompt,
  cursorFailureChatMessage,
  shouldRunConnectedRepoAgent,
  slugify,
  type PlanningMeta,
} from "@automation-studio/domain";
import { createBranchFromDefault } from "@automation-studio/github";
import { enqueueJob, type EnsureBranchJobData } from "@automation-studio/jobs";
import { writeAuditEvent } from "@automation-studio/auth";

export async function handleEnsureBranch(data: EnsureBranchJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: {
      createdBy: true,
      project: { include: { repository: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 40 },
    },
  });

  const repo = cr.project.repository;
  if (!repo) {
    await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        role: "ASSISTANT",
        content: cursorFailureChatMessage(
          "this project has no connected GitHub repo. An admin has to connect one before the agent can edit it",
        ),
      },
    });
    return { ok: false, reason: "no_repository" };
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

  let planningMeta = (cr.planningMeta ?? {}) as PlanningMeta;
  const connectedRepo = shouldRunConnectedRepoAgent({
    kind: cr.kind,
    status: cr.status,
    hasRepository: true,
    iterateExisting: planningMeta.iterateExisting,
  });
  if (connectedRepo && !planningMeta.iterateExisting) {
    planningMeta = {
      ...planningMeta,
      iterateExisting: true,
      linkedRepoLabel: `${repo.githubOwner}/${repo.githubRepo}`,
    };
    await db.changeRequest.update({
      where: { id: cr.id },
      data: { planningMeta: planningMeta as object, updatedAt: new Date() },
    });
  }

  // Agent mode only. Plan-only sessions are not started.
  const mode: "plan" | "agent" = "agent";

  const prompt =
    data.prompt?.trim() ||
    (connectedRepo
      ? connectedRepoStartPrompt({
          title: cr.title,
          repoLabel: `${repo.githubOwner}/${repo.githubRepo}`,
        })
      : `${cr.title}\n\n${cr.description}`.trim());

  await enqueueJob(
    "cursor.start-agent",
    {
      changeRequestId: cr.id,
      companyId: data.companyId,
      mode,
      prompt,
      pushRequest: data.pushRequest,
      attachmentRef:
        data.attachmentRef ??
        ((cr.planningMeta ?? {}) as PlanningMeta).pendingAttachmentRef ??
        undefined,
      attachmentRefs:
        data.attachmentRefs ??
        ((cr.planningMeta ?? {}) as PlanningMeta).pendingAttachmentRefs ??
        undefined,
    },
    { jobId: `cursor-start-${cr.id}` },
  );

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
