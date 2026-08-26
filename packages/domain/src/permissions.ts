import type { MembershipRole } from "@automation-studio/db";

export type Permission =
  | "project:read"
  | "project:manage"
  | "change_request:create"
  | "change_request:chat"
  | "change_request:submit_review"
  | "change_request:approve_plan"
  | "change_request:review"
  | "change_request:merge"
  | "change_request:high_risk_approve"
  | "company:admin"
  | "members:manage";

const ROLE_PERMISSIONS: Record<MembershipRole, Permission[]> = {
  EMPLOYEE: [
    "project:read",
    "change_request:create",
    "change_request:chat",
    "change_request:submit_review",
    "change_request:approve_plan",
  ],
  DEVELOPER: [
    "project:read",
    "change_request:create",
    "change_request:chat",
    "change_request:submit_review",
    "change_request:approve_plan",
    "change_request:review",
    "change_request:merge",
    "change_request:high_risk_approve",
  ],
  ADMIN: [
    "project:read",
    "project:manage",
    "change_request:create",
    "change_request:chat",
    "change_request:submit_review",
    "change_request:approve_plan",
    "company:admin",
    "members:manage",
  ],
};

export function roleHasPermission(
  role: MembershipRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(
  role: MembershipRole,
  permission: Permission,
): void {
  if (!roleHasPermission(role, permission)) {
    throw new Error(`Missing permission: ${permission}`);
  }
}
