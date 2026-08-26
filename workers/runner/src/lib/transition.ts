import { db, type ChangeRequestStatus } from "@automation-studio/db";
import { assertTransition } from "@automation-studio/domain";
import { writeAuditEvent } from "@automation-studio/auth";

export async function transitionChangeRequest(input: {
  changeRequestId: string;
  companyId: string;
  toStatus: ChangeRequestStatus;
  actorId?: string | null;
  reason?: string;
}) {
  const cr = await db.changeRequest.findFirstOrThrow({
    where: { id: input.changeRequestId, companyId: input.companyId },
  });

  if (cr.status === input.toStatus) {
    return cr;
  }

  assertTransition(cr.status, input.toStatus);

  const updated = await db.changeRequest.update({
    where: { id: cr.id },
    data: { status: input.toStatus },
  });

  await db.changeRequestStatusEvent.create({
    data: {
      changeRequestId: cr.id,
      fromStatus: cr.status,
      toStatus: input.toStatus,
      actorId: input.actorId ?? null,
      reason: input.reason,
    },
  });

  await writeAuditEvent({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "change_request.status_changed",
    entityType: "change_request",
    entityId: cr.id,
    metadata: {
      from: cr.status,
      to: input.toStatus,
      reason: input.reason,
    },
  });

  return updated;
}
