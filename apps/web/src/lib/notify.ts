import { db } from "@automation-studio/db";
import {
  trySendEmail,
  type QueueEmailInput,
} from "@automation-studio/domain";

export async function queueAndMaybeSendEmail(
  input: QueueEmailInput & { actorId?: string },
) {
  const sendResult = await trySendEmail(input);
  const row = await db.outboundEmail.create({
    data: {
      companyId: input.companyId,
      toEmail: input.toEmail,
      subject: input.subject,
      body: input.body,
      status: sendResult.sent ? "SENT" : "QUEUED",
      entityType: input.entityType,
      entityId: input.entityId,
      sentAt: sendResult.sent ? new Date() : null,
      metadata: {
        ...(input.metadata ?? {}),
        provider: sendResult.provider ?? null,
        error: sendResult.error ?? null,
      },
    },
  });

  return { email: row, sendResult };
}
