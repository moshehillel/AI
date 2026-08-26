-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('EMPLOYEE', 'DEVELOPER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ChangeClassification" AS ENUM ('SIMPLE', 'NORMAL', 'COMPLEX', 'HIGH_RISK');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('DRAFT', 'ANALYZING', 'PLANNING', 'AWAITING_PLAN_APPROVAL', 'AWAITING_HIGH_RISK_APPROVAL', 'IMPLEMENTING', 'TESTING', 'PREVIEW_READY', 'CHANGES_REQUESTED', 'READY_FOR_REVIEW', 'DEVELOPER_REVIEW', 'APPROVED', 'MERGED', 'DEPLOYED', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AgentRunMode" AS ENUM ('PLAN', 'AGENT');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PullRequestStatus" AS ENUM ('OPEN', 'CLOSED', 'MERGED', 'DRAFT');

-- CreateEnum
CREATE TYPE "PreviewStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "CiCheckStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILURE', 'ERROR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SecretPurpose" AS ENUM ('PREVIEW', 'PLATFORM');

-- CreateEnum
CREATE TYPE "SecretProvider" AS ENUM ('ENV', 'VAULT');

-- CreateEnum
CREATE TYPE "UsageProvider" AS ENUM ('CURSOR', 'RAILWAY');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "clerkOrgId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMembership" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'EMPLOYEE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "githubOwner" TEXT NOT NULL,
    "githubRepo" TEXT NOT NULL,
    "installationId" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "railwayProjectId" TEXT,
    "previewBaseEnvId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assignedDeveloperId" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "classification" "ChangeClassification" NOT NULL DEFAULT 'NORMAL',
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "branchName" TEXT,
    "cursorAgentId" TEXT,
    "shortDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequestStatusEvent" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "fromStatus" "ChangeRequestStatus",
    "toStatus" "ChangeRequestStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeRequestStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequestMessage" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "authorId" TEXT,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "cursorRunId" TEXT,
    "model" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeRequestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentJson" JSONB,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "cursorAgentId" TEXT NOT NULL,
    "cursorRunId" TEXT,
    "mode" "AgentRunMode" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "changeRequestId" TEXT,
    "agentRunId" TEXT,
    "provider" "UsageProvider" NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "billedCents" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "githubPrNumber" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "status" "PullRequestStatus" NOT NULL DEFAULT 'OPEN',
    "headSha" TEXT,
    "baseSha" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreviewEnvironment" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAILWAY',
    "externalId" TEXT,
    "url" TEXT,
    "status" "PreviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "destroyedAt" TIMESTAMP(3),

    CONSTRAINT "PreviewEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CiCheckSuite" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GITHUB',
    "externalId" TEXT,
    "status" "CiCheckStatus" NOT NULL DEFAULT 'PENDING',
    "detailsUrl" TEXT,
    "rawSummary" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CiCheckSuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretRef" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "purpose" "SecretPurpose" NOT NULL,
    "provider" "SecretProvider" NOT NULL DEFAULT 'ENV',
    "keyName" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubInstallation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Company_clerkOrgId_key" ON "Company"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE INDEX "CompanyMembership_userId_idx" ON "CompanyMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_companyId_userId_key" ON "CompanyMembership"("companyId", "userId");

-- CreateIndex
CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_companyId_slug_key" ON "Project"("companyId", "slug");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_projectId_key" ON "Repository"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubOwner_githubRepo_key" ON "Repository"("githubOwner", "githubRepo");

-- CreateIndex
CREATE INDEX "ChangeRequest_companyId_status_idx" ON "ChangeRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "ChangeRequest_projectId_idx" ON "ChangeRequest"("projectId");

-- CreateIndex
CREATE INDEX "ChangeRequest_createdById_idx" ON "ChangeRequest"("createdById");

-- CreateIndex
CREATE INDEX "ChangeRequest_cursorAgentId_idx" ON "ChangeRequest"("cursorAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRequest_projectId_number_key" ON "ChangeRequest"("projectId", "number");

-- CreateIndex
CREATE INDEX "ChangeRequestStatusEvent_changeRequestId_createdAt_idx" ON "ChangeRequestStatusEvent"("changeRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeRequestMessage_changeRequestId_createdAt_idx" ON "ChangeRequestMessage"("changeRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "Plan_changeRequestId_idx" ON "Plan"("changeRequestId");

-- CreateIndex
CREATE INDEX "AgentRun_changeRequestId_idx" ON "AgentRun"("changeRequestId");

-- CreateIndex
CREATE INDEX "AgentRun_cursorAgentId_idx" ON "AgentRun"("cursorAgentId");

-- CreateIndex
CREATE INDEX "AgentRun_cursorRunId_idx" ON "AgentRun"("cursorRunId");

-- CreateIndex
CREATE INDEX "UsageRecord_companyId_createdAt_idx" ON "UsageRecord"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_changeRequestId_idx" ON "UsageRecord"("changeRequestId");

-- CreateIndex
CREATE INDEX "PullRequest_changeRequestId_idx" ON "PullRequest"("changeRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_changeRequestId_githubPrNumber_key" ON "PullRequest"("changeRequestId", "githubPrNumber");

-- CreateIndex
CREATE INDEX "PreviewEnvironment_changeRequestId_idx" ON "PreviewEnvironment"("changeRequestId");

-- CreateIndex
CREATE INDEX "CiCheckSuite_changeRequestId_idx" ON "CiCheckSuite"("changeRequestId");

-- CreateIndex
CREATE INDEX "SecretRef_companyId_idx" ON "SecretRef"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretRef_companyId_projectId_keyName_purpose_key" ON "SecretRef"("companyId", "projectId", "keyName", "purpose");

-- CreateIndex
CREATE INDEX "AuditEvent_companyId_createdAt_idx" ON "AuditEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "GithubInstallation_installationId_key" ON "GithubInstallation"("installationId");

-- CreateIndex
CREATE INDEX "GithubInstallation_companyId_idx" ON "GithubInstallation"("companyId");

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_assignedDeveloperId_fkey" FOREIGN KEY ("assignedDeveloperId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequestStatusEvent" ADD CONSTRAINT "ChangeRequestStatusEvent_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequestStatusEvent" ADD CONSTRAINT "ChangeRequestStatusEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequestMessage" ADD CONSTRAINT "ChangeRequestMessage_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequestMessage" ADD CONSTRAINT "ChangeRequestMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreviewEnvironment" ADD CONSTRAINT "PreviewEnvironment_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CiCheckSuite" ADD CONSTRAINT "CiCheckSuite_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretRef" ADD CONSTRAINT "SecretRef_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretRef" ADD CONSTRAINT "SecretRef_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

