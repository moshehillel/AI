import type { ChangeRequestStatus } from "@automation-studio/db";

export const CHANGE_REQUEST_STATUSES = [
  "DRAFT",
  "ANALYZING",
  "PLANNING",
  "AWAITING_PLAN_APPROVAL",
  "AWAITING_HIGH_RISK_APPROVAL",
  "AWAITING_DEV_BUILD",
  "BUILDING",
  "IMPLEMENTING",
  "TESTING",
  "PREVIEW_READY",
  "CLIENT_VERIFY",
  "CHANGES_REQUESTED",
  "READY_FOR_REVIEW",
  "AWAITING_FINAL_REVIEW",
  "DEVELOPER_REVIEW",
  "APPROVED",
  "MERGED",
  "DEPLOYING",
  "DEPLOYED",
  "DONE",
  "REJECTED",
  "FAILED",
  "CANCELLED",
] as const satisfies readonly ChangeRequestStatus[];

const ALLOWED_TRANSITIONS: Record<ChangeRequestStatus, ChangeRequestStatus[]> = {
  DRAFT: ["ANALYZING", "PLANNING", "CANCELLED"],
  ANALYZING: [
    "PLANNING",
    "AWAITING_HIGH_RISK_APPROVAL",
    "IMPLEMENTING",
    "FAILED",
    "CANCELLED",
  ],
  PLANNING: [
    "AWAITING_PLAN_APPROVAL",
    "AWAITING_DEV_BUILD",
    "FAILED",
    "CANCELLED",
  ],
  AWAITING_PLAN_APPROVAL: [
    "IMPLEMENTING",
    "AWAITING_DEV_BUILD",
    "CANCELLED",
    "CHANGES_REQUESTED",
  ],
  AWAITING_HIGH_RISK_APPROVAL: ["PLANNING", "IMPLEMENTING", "REJECTED", "CANCELLED"],
  // PLANNING: employee/staff can reopen if submit was accidental
  AWAITING_DEV_BUILD: ["BUILDING", "PLANNING", "CANCELLED", "FAILED"],
  BUILDING: ["TESTING", "PREVIEW_READY", "CLIENT_VERIFY", "FAILED", "CANCELLED"],
  IMPLEMENTING: ["TESTING", "PLANNING", "FAILED", "CANCELLED"],
  TESTING: [
    "PREVIEW_READY",
    "CLIENT_VERIFY",
    "FAILED",
    "IMPLEMENTING",
    "BUILDING",
    "APPROVED",
    "DEPLOYING",
  ],
  PREVIEW_READY: [
    "CLIENT_VERIFY",
    "CHANGES_REQUESTED",
    "READY_FOR_REVIEW",
    "AWAITING_FINAL_REVIEW",
    "IMPLEMENTING",
    "BUILDING",
    "CANCELLED",
  ],
  CLIENT_VERIFY: [
    "CHANGES_REQUESTED",
    "AWAITING_FINAL_REVIEW",
    "BUILDING",
    "CANCELLED",
  ],
  CHANGES_REQUESTED: [
    "ANALYZING",
    "IMPLEMENTING",
    "BUILDING",
    "TESTING",
    "PLANNING",
    "CLIENT_VERIFY",
    "CANCELLED",
  ],
  READY_FOR_REVIEW: ["DEVELOPER_REVIEW", "AWAITING_FINAL_REVIEW", "CANCELLED"],
  AWAITING_FINAL_REVIEW: [
    "APPROVED",
    "CHANGES_REQUESTED",
    "REJECTED",
    "DEPLOYING",
  ],
  DEVELOPER_REVIEW: ["APPROVED", "CHANGES_REQUESTED", "REJECTED"],
  APPROVED: ["MERGED", "DEPLOYING", "CHANGES_REQUESTED"],
  MERGED: ["DEPLOYED", "DEPLOYING"],
  DEPLOYING: ["DEPLOYED", "DONE", "FAILED"],
  DEPLOYED: ["DONE"],
  DONE: [],
  REJECTED: [],
  FAILED: ["ANALYZING", "IMPLEMENTING", "BUILDING", "PLANNING", "CANCELLED"],
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

/** Plain-language labels for employee / client UI (no infra jargon) */
export const STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  DRAFT: "Draft",
  ANALYZING: "Analyzing…",
  PLANNING: "Planning with Koda",
  AWAITING_PLAN_APPROVAL: "Waiting for your plan approval",
  AWAITING_HIGH_RISK_APPROVAL: "Waiting for developer approval",
  AWAITING_DEV_BUILD: "Submitted — your developer is building. Planning is closed.",
  BUILDING: "Building your program…",
  IMPLEMENTING: "Making the change…",
  TESTING: "Test & improve in progress…",
  PREVIEW_READY: "Preview ready",
  CLIENT_VERIFY: "Ready for you to verify",
  CHANGES_REQUESTED: "Changes requested",
  READY_FOR_REVIEW: "Submitted for review",
  AWAITING_FINAL_REVIEW: "Waiting for final review",
  DEVELOPER_REVIEW: "Under developer review",
  APPROVED: "Approved",
  MERGED: "Merged",
  DEPLOYING: "Deploying…",
  DEPLOYED: "Live",
  DONE: "Complete",
  REJECTED: "Rejected",
  FAILED: "Something went wrong",
  CANCELLED: "Cancelled",
};

/** Statuses where the customer can plan with Koda (living plan updates). */
export const PROGRAM_PLANNING_STATUSES: ChangeRequestStatus[] = [
  "DRAFT",
  "PLANNING",
  "AWAITING_PLAN_APPROVAL",
];

/** Statuses where Programs must stay in plan-only AI mode (no code edits). */
export const PROGRAM_PLAN_ONLY_STATUSES: ChangeRequestStatus[] = [
  ...PROGRAM_PLANNING_STATUSES,
];

export function isProgramPlanning(status: ChangeRequestStatus): boolean {
  return PROGRAM_PLANNING_STATUSES.includes(status);
}

export function isProgramPlanOnly(status: ChangeRequestStatus): boolean {
  return PROGRAM_PLAN_ONLY_STATUSES.includes(status);
}

/** After submit — customer cannot chat until developer opens verification. */
export const PROGRAM_BUILD_LOCKED_STATUSES: ChangeRequestStatus[] = [
  "AWAITING_DEV_BUILD",
  "BUILDING",
  "TESTING",
  "IMPLEMENTING",
];

export function isProgramBuildLocked(status: ChangeRequestStatus): boolean {
  return PROGRAM_BUILD_LOCKED_STATUSES.includes(status);
}

/** Test & request changes — agent/build mode on the live repo branch. */
export const PROGRAM_VERIFY_STATUSES: ChangeRequestStatus[] = [
  "CLIENT_VERIFY",
  "PREVIEW_READY",
  "CHANGES_REQUESTED",
];

export function isProgramVerifyPhase(status: ChangeRequestStatus): boolean {
  return PROGRAM_VERIFY_STATUSES.includes(status);
}

export function canProgramCustomerChat(status: ChangeRequestStatus): boolean {
  return isProgramPlanning(status) || isProgramVerifyPhase(status);
}

export function isTerminalStatus(status: ChangeRequestStatus): boolean {
  return ["DONE", "DEPLOYED", "REJECTED", "CANCELLED"].includes(status);
}

/** Soft-deleted from customer dashboards — still in DB for audit / admin archive */
export const DASHBOARD_HIDDEN_STATUSES: ChangeRequestStatus[] = ["CANCELLED"];

export function isHiddenFromDashboard(status: ChangeRequestStatus): boolean {
  return DASHBOARD_HIDDEN_STATUSES.includes(status);
}
