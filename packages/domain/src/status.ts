import type { ChangeRequestStatus } from "@automation-studio/db";

export const CHANGE_REQUEST_STATUSES = [
  "DRAFT",
  "ANALYZING",
  "PLANNING",
  "AWAITING_PLAN_APPROVAL",
  "AWAITING_HIGH_RISK_APPROVAL",
  "IMPLEMENTING",
  "TESTING",
  "PREVIEW_READY",
  "CHANGES_REQUESTED",
  "READY_FOR_REVIEW",
  "DEVELOPER_REVIEW",
  "APPROVED",
  "MERGED",
  "DEPLOYED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
] as const satisfies readonly ChangeRequestStatus[];

const ALLOWED_TRANSITIONS: Record<ChangeRequestStatus, ChangeRequestStatus[]> = {
  DRAFT: ["ANALYZING", "CANCELLED"],
  ANALYZING: [
    "PLANNING",
    "AWAITING_HIGH_RISK_APPROVAL",
    "IMPLEMENTING",
    "FAILED",
    "CANCELLED",
  ],
  PLANNING: ["AWAITING_PLAN_APPROVAL", "FAILED", "CANCELLED"],
  AWAITING_PLAN_APPROVAL: ["IMPLEMENTING", "CANCELLED", "CHANGES_REQUESTED"],
  AWAITING_HIGH_RISK_APPROVAL: ["PLANNING", "IMPLEMENTING", "REJECTED", "CANCELLED"],
  IMPLEMENTING: ["TESTING", "PLANNING", "FAILED", "CANCELLED"],
  TESTING: ["PREVIEW_READY", "FAILED", "IMPLEMENTING"],
  PREVIEW_READY: [
    "CHANGES_REQUESTED",
    "READY_FOR_REVIEW",
    "IMPLEMENTING",
    "CANCELLED",
  ],
  CHANGES_REQUESTED: ["ANALYZING", "IMPLEMENTING", "CANCELLED"],
  READY_FOR_REVIEW: ["DEVELOPER_REVIEW", "CANCELLED"],
  DEVELOPER_REVIEW: ["APPROVED", "CHANGES_REQUESTED", "REJECTED"],
  APPROVED: ["MERGED", "CHANGES_REQUESTED"],
  MERGED: ["DEPLOYED"],
  DEPLOYED: [],
  REJECTED: [],
  FAILED: ["ANALYZING", "IMPLEMENTING", "CANCELLED"],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: ChangeRequestStatus,
    public readonly to: ChangeRequestStatus,
  ) {
    super(`Invalid change request transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function allowedNextStatuses(
  from: ChangeRequestStatus,
): ChangeRequestStatus[] {
  return [...ALLOWED_TRANSITIONS[from]];
}

/** Plain-language labels for employee UI */
export const STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  DRAFT: "Draft",
  ANALYZING: "Analyzing project…",
  PLANNING: "Preparing a plan…",
  AWAITING_PLAN_APPROVAL: "Waiting for your plan approval",
  AWAITING_HIGH_RISK_APPROVAL: "Waiting for developer approval",
  IMPLEMENTING: "Making the change…",
  TESTING: "Running builds and tests…",
  PREVIEW_READY: "Test version ready",
  CHANGES_REQUESTED: "Additional changes requested",
  READY_FOR_REVIEW: "Submitted for review",
  DEVELOPER_REVIEW: "Under developer review",
  APPROVED: "Approved",
  MERGED: "Merged",
  DEPLOYED: "Deployed",
  REJECTED: "Rejected",
  FAILED: "Something went wrong",
  CANCELLED: "Cancelled",
};
