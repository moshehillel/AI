import { db } from "@automation-studio/db";
import { getCombinedStatus } from "@automation-studio/github";
import type { SyncChecksJobData } from "@automation-studio/jobs";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleSyncChecks(data: SyncChecksJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: {
      project: { include: { repository: true } },
      pullRequests: true,
    },
  });

  const repo = cr.project.repository;
  const pr = cr.pullRequests[0];
  if (!repo || !pr?.headSha) {
    await db.ciCheckSuite.create({
      data: {
        changeRequestId: cr.id,
        status: "SUCCESS",
        rawSummary: { mock: true, note: "No SHA yet; mock success" },
      },
    });
  } else {
    const status = await getCombinedStatus({
      installationId: repo.installationId ?? "0",
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      ref: pr.headSha,
    });

    const mapped =
      status.state === "success"
        ? "SUCCESS"
        : status.state === "failure"
          ? "FAILURE"
          : status.state === "pending"
            ? "PENDING"
            : "ERROR";

    await db.ciCheckSuite.create({
      data: {
        changeRequestId: cr.id,
        status: mapped,
        rawSummary: status,
      },
    });

    if (mapped === "FAILURE" || mapped === "ERROR") {
      await transitionChangeRequest({
        changeRequestId: cr.id,
        companyId: data.companyId,
        toStatus: "FAILED",
        reason: "CI checks failed",
      });
      return { status: mapped };
    }
  }

  if (cr.status === "TESTING") {
    // Preview sync will move to PREVIEW_READY
  }

  return { ok: true };
}
