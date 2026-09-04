import {
  db,
  type MembershipRole,
  type User,
  type Company,
  type CompanyMembership,
  type Prisma,
} from "@automation-studio/db";
import {
  CUSTOMER_ONBOARDING_SLUG,
  roleHasPermission,
  type Permission,
} from "@automation-studio/domain";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status = 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type AuthContext = {
  user: User;
  company: Company;
  membership: CompanyMembership;
  role: MembershipRole;
};

export async function resolveAuthContext(input: {
  clerkUserId: string;
  clerkOrgId: string | null | undefined;
}): Promise<AuthContext> {
  if (!input.clerkOrgId) {
    throw new AuthError("Select an active organization", 400);
  }

  const user = await db.user.findUnique({
    where: { clerkUserId: input.clerkUserId },
  });
  if (!user) {
    throw new AuthError("User not synced yet", 401);
  }

  const company = await db.company.findUnique({
    where: { clerkOrgId: input.clerkOrgId },
  });
  if (!company) {
    throw new AuthError("Company not found for organization", 404);
  }

  const membership = await db.companyMembership.findUnique({
    where: {
      companyId_userId: { companyId: company.id, userId: user.id },
    },
  });
  if (!membership) {
    throw new AuthError("Not a member of this company", 403);
  }

  return { user, company, membership, role: membership.role };
}

export async function requirePermission(
  ctx: AuthContext,
  permission: Permission,
): Promise<void> {
  if (!roleHasPermission(ctx.role, permission)) {
    throw new AuthError(`Missing permission: ${permission}`, 403);
  }
}

export async function requireProjectAccess(
  ctx: AuthContext,
  projectId: string,
): Promise<void> {
  const project = await db.project.findFirst({
    where: { id: projectId, companyId: ctx.company.id },
  });
  if (!project) {
    throw new AuthError("Project not found", 404);
  }

  if (ctx.role === "ADMIN" || ctx.role === "DEVELOPER") {
    return;
  }

  // Shared planning workspace: any company member may start / continue programs.
  // Admin assignment is only required for other projects (iterate on existing repos).
  if (project.slug === CUSTOMER_ONBOARDING_SLUG) {
    return;
  }

  const membership = await db.projectMember.findUnique({
    where: {
      projectId_userId: { projectId, userId: ctx.user.id },
    },
  });
  if (!membership) {
    throw new AuthError(
      "You don't have access to this workspace. Ask an admin to assign you, or start a new program from the home page.",
      403,
    );
  }
}

export async function requireChangeRequestAccess(
  ctx: AuthContext,
  changeRequestId: string,
) {
  const changeRequest = await db.changeRequest.findFirst({
    where: { id: changeRequestId, companyId: ctx.company.id },
    include: { project: true },
  });
  if (!changeRequest) {
    throw new AuthError("Change request not found", 404);
  }

  await requireProjectAccess(ctx, changeRequest.projectId);
  return changeRequest;
}

export async function writeAuditEvent(input: {
  companyId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return db.auditEvent.create({
    data: {
      companyId: input.companyId,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? {},
    },
  });
}
