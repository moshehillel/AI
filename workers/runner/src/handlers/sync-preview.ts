import { db } from "@automation-studio/db";
import { findPreviewUrlForPr } from "@automation-studio/railway";
import { enqueueJob, type SyncPreviewJobData } from "@automation-studio/jobs";
import { writeAuditEvent } from "@automation-studio/auth";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleSyncPreview(data: SyncPreviewJobData & { attempt?: number }) {
  const attempt = data.attempt ?? 1;
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

  const existing = await db.previewEnvironment.findFirst({
    where: { changeRequestId: cr.id },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    await db.previewEnvironment.update({
      where: { id: existing.id },
      data: {
        externalId: preview.environmentId ?? existing.externalId,
        url: preview.url ?? existing.url,
        status: preview.url ? "READY" : "PENDING",
      },
    });
  } else {
    await db.previewEnvironment.create({
      data: {
        changeRequestId: cr.id,
        provider: "RAILWAY",
        externalId: preview.environmentId,
        url: preview.url,
        status: preview.url ? "READY" : "PENDING",
      },
    });
  }

  if (preview.url) {
    if (
      cr.status === "TESTING" ||
      cr.status === "IMPLEMENTING" ||
      cr.status === "BUILDING"
    ) {
      const nextStatus =
        cr.kind === "PROGRAM" ? "CLIENT_VERIFY" : "PREVIEW_READY";
      await transitionChangeRequest({
        changeRequestId: cr.id,
        companyId: data.companyId,
        toStatus: nextStatus,
        reason: "Preview environment ready",
      });
    }

    const alreadyNotified = await db.changeRequestMessage.findFirst({
      where: {
        changeRequestId: cr.id,
        role: "SYSTEM",
        content: { contains: preview.url },
      },
    });
    if (!alreadyNotified) {
      await db.changeRequestMessage.create({
        data: {
          changeRequestId: cr.id,
          role: "SYSTEM",
          content: `Test version is ready. Open it here: ${preview.url}`,
        },
      });
    }

    await writeAuditEvent({
      companyId: data.companyId,
      action: "preview.ready",
      entityType: "change_request",
      entityId: cr.id,
      metadata: { url: preview.url, attempt },
    });
    return preview;
  }

  if (attempt < 8) {
    await enqueueJob(
      "railway.sync-preview",
      {
        changeRequestId: cr.id,
        companyId: data.companyId,
        attempt: attempt + 1,
      } as SyncPreviewJobData,
      {
        jobId: `preview-${cr.id}-${attempt + 1}`,
        delay: Math.min(60_000, attempt * 5_000),
      },
    );
  } else if (cr.status === "TESTING") {
    await transitionChangeRequest({
      changeRequestId: cr.id,
      companyId: data.companyId,
      toStatus: "FAILED",
      reason: "Preview environment did not become ready in time",
    });
    await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        role: "SYSTEM",
        content:
          "We could not prepare a test version in time. You can retry this request.",
      },
    });
  }

  return preview;
}
