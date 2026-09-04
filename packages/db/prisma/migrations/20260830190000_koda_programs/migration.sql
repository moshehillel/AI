-- AlterEnum
ALTER TYPE "ChangeRequestStatus" ADD VALUE 'AWAITING_DEV_BUILD';
ALTER TYPE "ChangeRequestStatus" ADD VALUE 'BUILDING';
ALTER TYPE "ChangeRequestStatus" ADD VALUE 'CLIENT_VERIFY';
ALTER TYPE "ChangeRequestStatus" ADD VALUE 'AWAITING_FINAL_REVIEW';
ALTER TYPE "ChangeRequestStatus" ADD VALUE 'DEPLOYING';
ALTER TYPE "ChangeRequestStatus" ADD VALUE 'DONE';

ALTER TYPE "SecretPurpose" ADD VALUE 'CHAT';
ALTER TYPE "SecretProvider" ADD VALUE 'ENCRYPTED';

CREATE TYPE "ChangeRequestKind" AS ENUM ('CHANGE', 'PROGRAM');
CREATE TYPE "OutboundEmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'READ');

ALTER TABLE "ChangeRequest" ADD COLUMN "kind" "ChangeRequestKind" NOT NULL DEFAULT 'CHANGE';
ALTER TABLE "ChangeRequest" ADD COLUMN "planningMeta" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ChangeRequest" ADD COLUMN "buildSetup" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "SecretRef" ADD COLUMN "changeRequestId" TEXT;
ALTER TABLE "SecretRef" ADD COLUMN "ciphertext" TEXT;

CREATE INDEX "ChangeRequest_kind_status_idx" ON "ChangeRequest"("kind", "status");
CREATE INDEX "SecretRef_changeRequestId_idx" ON "SecretRef"("changeRequestId");

ALTER TABLE "SecretRef" ADD CONSTRAINT "SecretRef_changeRequestId_fkey"
  FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OutboundEmail" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "OutboundEmailStatus" NOT NULL DEFAULT 'QUEUED',
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutboundEmail_companyId_createdAt_idx" ON "OutboundEmail"("companyId", "createdAt");
CREATE INDEX "OutboundEmail_status_idx" ON "OutboundEmail"("status");

ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
