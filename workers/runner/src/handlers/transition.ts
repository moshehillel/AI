import type { TransitionJobData } from "@automation-studio/jobs";
import type { ChangeRequestStatus } from "@automation-studio/db";
import { transitionChangeRequest } from "../lib/transition.js";

export async function handleTransition(data: TransitionJobData) {
  return transitionChangeRequest({
    changeRequestId: data.changeRequestId,
    companyId: data.companyId,
    toStatus: data.toStatus as ChangeRequestStatus,
    actorId: data.actorId,
    reason: data.reason,
  });
}
