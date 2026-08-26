import { db } from "@automation-studio/db";
import { findPreviewUrlForPr } from "@automation-studio/railway";
import type { SyncPreviewJobData } from "@automation-studio/jobs";
import { writeAuditEvent } from "@automation-studio/auth";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleSyncPreview(data: SyncPreviewJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
    include: {
      project: { include: { repository: true } },
      pullRequests: true,
    },
  });

  const repo = cr.project.repository;
  const pr = cr.pullRequests[0];
  if (!pr) {
    throw new Error("No pull request to sync preview for");
  }

  const preview = await findPreviewUrlForPr({
    railwayProjectId: repo?.railwayProjectId ?? "mock",
    prNumber: pr.githubPrNumber,
  });

  await db.previewEnvironment.create({
    data: {
      changeRequestId: cr.id,
      provider: "RAILWAY",
      externalId: preview.environmentId,
      url: preview.url,
      status: preview.url ? "READY" : "PENDING",
    },
  });

  if (preview.url) {
    await transitionChangeRequest({
      changeRequestId: cr.id,
      companyId: data.companyId,
      toStatus: "PREVIEW_READY",
      reason: "Preview environment ready",
    });

    await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        role: "SYSTEM",
        content: `Test version is ready. Open it here: ${preview.url}`,
      },
    });

    await writeAuditEvent({
      companyId: data.companyId,
      action: "preview.ready",
      entityType: "change_request",
      entityId: cr.id,
      metadata: { url: preview.url },
    });
  }

  return preview;
}
