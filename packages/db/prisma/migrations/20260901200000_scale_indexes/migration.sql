-- Hot-path indexes for multi-user scale (programs, messages, agent runs)

CREATE INDEX IF NOT EXISTS "ChangeRequestMessage_changeRequestId_role_createdAt_idx"
  ON "ChangeRequestMessage"("changeRequestId", "role", "createdAt");

CREATE INDEX IF NOT EXISTS "AgentRun_changeRequestId_status_createdAt_idx"
  ON "AgentRun"("changeRequestId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "AgentRun_status_createdAt_idx"
  ON "AgentRun"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "ChangeRequest_companyId_kind_status_idx"
  ON "ChangeRequest"("companyId", "kind", "status");

CREATE INDEX IF NOT EXISTS "SecretRef_companyId_changeRequestId_purpose_idx"
  ON "SecretRef"("companyId", "changeRequestId", "purpose");
