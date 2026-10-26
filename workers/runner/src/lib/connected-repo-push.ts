import { db, type ChangeRequestStatus } from "@automation-studio/db";
import { readBranchHead } from "@automation-studio/github";
import {
  connectedRepoPushResultMessage,
  nextStatusAfterProgramAgentTurn,
  readClientAwsDeployTarget,
  type PlanningMeta,
} from "@automation-studio/domain";
import { enqueueJob } from "@automation-studio/jobs";
import { transitionChangeRequest } from "./transition.js";
import { flushQueuedFollowUp } from "./planning-heartbeat.js";

/**
 * After an agent turn on a connected client repo.
 * A user-requested push is reported on its own. Secret values are not read
 * unless a client AWS deploy target is already configured — this repo has none,
 * so ciphertext stays in the database and is not sent anywhere.
 */
export async function finishConnectedRepoAgentTurn(input: {
  changeRequestId: string;
  companyId: string;
  pushRequest: boolean;
  statusBefore: ChangeRequestStatus;
}) {
  await transitionChangeRequest({
    changeRequestId: input.changeRequestId,
    companyId: input.companyId,
    toStatus: nextStatusAfterProgramAgentTurn(input.statusBefore),
    reason: input.pushRequest
      ? "User asked to push this change on its own"
      : "Connected repo change kept for the next push",
  });

  if (input.pushRequest) {
    const cr = await db.changeRequest.findFirstOrThrow({
      where: { id: input.changeRequestId, companyId: input.companyId },
      include: { project: { include: { repository: true } } },
    });
    const repo = cr.project.repository;
    const meta = (cr.planningMeta ?? {}) as PlanningMeta;
    const previousSha = meta.lastPushedSha ?? null;
    let headSha: string | null = null;
    if (repo && cr.branchName) {
      try {
        const head = await readBranchHead({
          installationId: repo.installationId ?? "0",
          owner: repo.githubOwner,
          repo: repo.githubRepo,
          branch: cr.branchName,
        });
        headSha = head.sha;
      } catch (error) {
        console.warn("[connected-repo-push] could not read branch head", error);
      }
    }
    if (headSha && headSha !== previousSha) {
      await db.changeRequest.update({
        where: { id: cr.id },
        data: {
          planningMeta: {
            ...meta,
            lastPushedSha: headSha,
          },
          updatedAt: new Date(),
        },
      });
    }

    const awsTarget = readClientAwsDeployTarget(repo);
    await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        role: "SYSTEM",
        content: connectedRepoPushResultMessage({
          repoLabel: repo ? `${repo.githubOwner}/${repo.githubRepo}` : null,
          branch: cr.branchName,
          headSha,
          previousSha,
          previewLinked: Boolean(repo?.railwayProjectId?.trim()),
          awsTargetConnected: Boolean(awsTarget),
        }),
      },
    });

    if (awsTarget) {
      // Secret ciphertext would be read here and applied to that AWS runtime.
      // Nothing in this repo configures a per-client AWS target, so this does not run.
    } else if (repo?.railwayProjectId?.trim() && cr.branchName) {
      await enqueueJob("github.ensure-pr", {
        changeRequestId: cr.id,
        companyId: input.companyId,
      });
    }
  }

  await flushQueuedFollowUp(input.changeRequestId, input.companyId);
}
