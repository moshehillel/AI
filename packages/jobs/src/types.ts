export const QUEUE_NAME = "automation-studio";

export type JobName =
  | "change-request.classify"
  | "github.ensure-branch"
  | "cursor.start-agent"
  | "cursor.follow-up"
  | "cursor.poll-or-stream"
  | "cursor.cancel"
  | "github.ensure-pr"
  | "ci.sync-checks"
  | "railway.sync-preview"
  | "change-request.transition"
  | "merge.prepare"
  | "usage.record";

export type ClassifyJobData = {
  changeRequestId: string;
  companyId: string;
};

export type EnsureBranchJobData = {
  changeRequestId: string;
  companyId: string;
};

export type CursorStartJobData = {
  changeRequestId: string;
  companyId: string;
  mode: "plan" | "agent";
  prompt: string;
  /** SecretRef.keyName for an encrypted PlanningAgentFilePayload */
  attachmentRef?: string;
  /** Multiple SecretRef.keyNames for encrypted PlanningAgentFilePayloads */
  attachmentRefs?: string[];
};

export type CursorFollowUpJobData = {
  changeRequestId: string;
  companyId: string;
  prompt: string;
  mode?: "plan" | "agent";
  /** SecretRef.keyName for an encrypted PlanningAgentFilePayload */
  attachmentRef?: string;
  /** Multiple SecretRef.keyNames for encrypted PlanningAgentFilePayloads */
  attachmentRefs?: string[];
};

export type CursorCancelJobData = {
  changeRequestId: string;
  companyId: string;
  agentId: string;
  runId?: string | null;
  agentRunId?: string;
};

export type EnsurePrJobData = {
  changeRequestId: string;
  companyId: string;
};

export type SyncChecksJobData = {
  changeRequestId: string;
  companyId: string;
};

export type SyncPreviewJobData = {
  changeRequestId: string;
  companyId: string;
  attempt?: number;
};

export type TransitionJobData = {
  changeRequestId: string;
  companyId: string;
  toStatus: string;
  actorId?: string;
  reason?: string;
};

export type MergePrepareJobData = {
  changeRequestId: string;
  companyId: string;
};

export type UsageRecordJobData = {
  changeRequestId: string;
  companyId: string;
  agentRunId: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  billedCents?: number;
};

export type JobDataMap = {
  "change-request.classify": ClassifyJobData;
  "github.ensure-branch": EnsureBranchJobData;
  "cursor.start-agent": CursorStartJobData;
  "cursor.follow-up": CursorFollowUpJobData;
  "cursor.cancel": CursorCancelJobData;
  "cursor.poll-or-stream": { changeRequestId: string; companyId: string; agentRunId: string };
  "github.ensure-pr": EnsurePrJobData;
  "ci.sync-checks": SyncChecksJobData;
  "railway.sync-preview": SyncPreviewJobData;
  "change-request.transition": TransitionJobData;
  "merge.prepare": MergePrepareJobData;
  "usage.record": UsageRecordJobData;
};
