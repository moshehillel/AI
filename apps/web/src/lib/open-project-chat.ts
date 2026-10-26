import { writeAuditEvent } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import {
  buildOpeningIterateMessage,
  buildOpeningPlanningMessage,
  isLiveCursorConfigured,
  slugify,
  type PlanningMeta,
} from "@automation-studio/domain";
import { enqueueJob } from "@automation-studio/jobs";

/**
 * The chat an assigned user works in. Created when an admin opens a project
 * so the user does not start a program themselves.
 */
export async function openInitialProjectChat(input: {
  companyId: string;
  projectId: string;
  actorId: string;
  projectName: string;
  repository: { githubOwner: string; githubRepo: string } | null;
}) {
  const latest = await db.changeRequest.findFirst({
    where: { projectId: input.projectId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const number = (latest?.number ?? 0) + 1;
  const title = input.projectName.slice(0, 200);
  const iterateExisting = Boolean(input.repository);
  const linkedRepoLabel = input.repository
    ? `${input.repository.githubOwner}/${input.repository.githubRepo}`
    : null;
  const planningMeta: PlanningMeta = {
    apiDocsUrl: null,
    docsText: null,
    examples: null,
    coveredTopics: [],
    lastQuestionTopic: null,
    ...(iterateExisting ? { iterateExisting: true, linkedRepoLabel } : {}),
  };
  const opening = iterateExisting
    ? buildOpeningIterateMessage({
        title,
        repoLabel: linkedRepoLabel,
        hasInitialPrompt: false,
      })
    : buildOpeningPlanningMessage({
        title,
        hasInitialPrompt: false,
      });

  const changeRequest = await db.changeRequest.create({
    data: {
      companyId: input.companyId,
      projectId: input.projectId,
      createdById: input.actorId,
      number,
      title,
      description: title,
      shortDescription: slugify(title),
      kind: "PROGRAM",
      classification: "COMPLEX",
      status: "PLANNING",
      planningMeta,
      messages: {
        create: {
          role: "ASSISTANT",
          authorId: input.actorId,
          content: opening,
          metadata: {
            planningBootstrap: true,
            openingQuestion: true,
          },
        },
      },
      statusEvents: {
        create: {
          toStatus: "PLANNING",
          actorId: input.actorId,
          reason: "Chat opened with the project",
        },
      },
    },
  });

  await writeAuditEvent({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "program.created",
    entityType: "change_request",
    entityId: changeRequest.id,
    metadata: { number, title, kind: "PROGRAM", withProject: true },
  });

  const repository = input.repository
    ? await db.repository.findUnique({ where: { projectId: input.projectId } })
    : null;
  if (repository && isLiveCursorConfigured()) {
    await enqueueJob(
      "github.ensure-branch",
      {
        changeRequestId: changeRequest.id,
        companyId: input.companyId,
      },
      { jobId: `plan-branch-${changeRequest.id}` },
    );
  }

  return changeRequest;
}
