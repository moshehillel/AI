import { db } from "@automation-studio/db";
import { createPullRequest } from "@automation-studio/github";
import { enqueueJob, type EnsurePrJobData } from "@automation-studio/jobs";
import { writeAuditEvent } from "@automation-studio/auth";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleEnsurePr(data: EnsurePrJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: { project: { include: { repository: true } }, pullRequests: true },
  });

  const repo = cr.project.repository;
  if (!repo || !cr.branchName) {
    throw new Error("Missing repository or branch");
  }

  const existing = cr.pullRequests.find((p) => p.status === "OPEN" || p.status === "DRAFT");
  if (!existing) {
    const pr = await createPullRequest({
      installationId: repo.installationId ?? "0",
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      title: `[Automation Studio] #${cr.number}: ${cr.title}`,
      body: [
        `Change request #${cr.number}`,
        "",
        cr.description,
        "",
        `Classification: ${cr.classification}`,
        `Branch: \`${cr.branchName}\``,
        "",
        "_Prepared by Automation Studio. Do not merge without developer review._",
      ].join("\n"),
      head: cr.branchName,
      base: repo.defaultBranch,
    });

    await db.pullRequest.create({
      data: {
        changeRequestId: cr.id,
        githubPrNumber: pr.number,
        url: pr.url,
        status: "OPEN",
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        title: cr.title,
      },
    });

    await writeAuditEvent({
      companyId: data.companyId,
      action: "github.pr_created",
      entityType: "change_request",
      entityId: cr.id,
      metadata: { prNumber: pr.number, url: pr.url },
    });
  }

  await enqueueJob("ci.sync-checks", {
    changeRequestId: cr.id,
    companyId: data.companyId,
  });
  await enqueueJob("railway.sync-preview", {
    changeRequestId: cr.id,
    companyId: data.companyId,
  });

  return { ok: true };
}
