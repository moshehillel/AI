import { db } from "@automation-studio/db";
import { classifyChangeRequest } from "@automation-studio/domain";
import { enqueueJob, type ClassifyJobData } from "@automation-studio/jobs";
import { writeAuditEvent } from "@automation-studio/auth";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleClassify(data: ClassifyJobData) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: data.changeRequestId, companyId: data.companyId },
  });

  const result = classifyChangeRequest({
    title: cr.title,
    description: cr.description,
  });

  await db.changeRequest.update({
    where: { id: cr.id },
    data: { classification: result.classification },
  });

  await writeAuditEvent({
    companyId: data.companyId,
    actorId: cr.createdById,
    action: "change_request.classified",
    entityType: "change_request",
    entityId: cr.id,
    metadata: result,
  });

  await transitionChangeRequest({
    changeRequestId: cr.id,
    companyId: data.companyId,
    toStatus: "ANALYZING",
    actorId: cr.createdById,
    reason: `Classified as ${result.classification}`,
  });

  if (result.requiresDeveloperPreApproval) {
    await transitionChangeRequest({
      changeRequestId: cr.id,
      companyId: data.companyId,
      toStatus: "AWAITING_HIGH_RISK_APPROVAL",
      reason: "High-risk changes require developer approval before implementation",
    });
    return { classification: result.classification, gated: true };
  }

  await enqueueJob("github.ensure-branch", {
    changeRequestId: cr.id,
    companyId: data.companyId,
  });

  return { classification: result.classification, gated: false };
}
