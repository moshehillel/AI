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
  | "program:submit_to_dev"
  | "program:reopen_planning"
  | "program:start_build"
  | "program:open_in_cursor"
  | "program:grant_test_improve"
  | "program:final_approve"
  | "program:reveal_secrets"
  | "company:admin"
  | "members:manage"
  | "inbox:read";

const ROLE_PERMISSIONS: Record<MembershipRole, Permission[]> = {
  EMPLOYEE: [
    "project:read",
    "change_request:create",
    "change_request:chat",
    "change_request:submit_review",
    "change_request:approve_plan",
    "program:submit_to_dev",
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
    "program:submit_to_dev",
    "program:reopen_planning",
    "program:start_build",
    "program:open_in_cursor",
    "program:grant_test_improve",
    "program:final_approve",
    "program:reveal_secrets",
    "members:manage",
    "inbox:read",
  ],
  ADMIN: [
    "project:read",
    "project:manage",
    "change_request:create",
    "change_request:chat",
    "change_request:submit_review",
    "change_request:approve_plan",
    "change_request:review",
    "change_request:merge",
    "change_request:high_risk_approve",
    "program:submit_to_dev",
    "program:reopen_planning",
    "program:start_build",
    "program:open_in_cursor",
    "program:grant_test_improve",
    "program:final_approve",
    "program:reveal_secrets",
    "company:admin",
    "members:manage",
    "inbox:read",
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
