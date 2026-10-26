/**
 * Legacy shared workspace. It is not a self-serve place to start a program.
 * Only an admin can open a project; chat requires an assignment (or admin).
 */
export const CUSTOMER_ONBOARDING_SLUG = "customer-onboarding";

export type CompanyAccessRole = "ADMIN" | "DEVELOPER" | "EMPLOYEE";

const ROLE_RANK: Record<CompanyAccessRole, number> = {
  EMPLOYEE: 0,
  DEVELOPER: 1,
  ADMIN: 2,
};

/** Map a Clerk organization role onto our company role. Unknown roles are employees. */
export function membershipRoleFromClerk(
  role: string | null | undefined,
): CompanyAccessRole {
  const normalized = (role ?? "").trim().toLowerCase();
  if (
    normalized === "org:admin" ||
    normalized === "admin" ||
    normalized.endsWith(":admin")
  ) {
    return "ADMIN";
  }
  if (
    normalized === "org:developer" ||
    normalized === "developer" ||
    normalized.endsWith(":developer")
  ) {
    return "DEVELOPER";
  }
  return "EMPLOYEE";
}

/** Raise a stored role when the live Clerk session is higher. Never downgrade. */
export function elevateRole(
  current: CompanyAccessRole,
  sessionRole: string | null | undefined,
): CompanyAccessRole {
  if (!sessionRole) return current;
  const mapped = membershipRoleFromClerk(sessionRole);
  return ROLE_RANK[mapped] > ROLE_RANK[current] ? mapped : current;
}

/** Only an admin can create a project or open a workspace for someone else. */
export function canCreateProject(role: CompanyAccessRole): boolean {
  return role === "ADMIN";
}

/** Only an admin can assign or remove a user on a project. */
export function canAssignProjectMember(role: CompanyAccessRole): boolean {
  return role === "ADMIN";
}

/**
 * Only an admin starts a program. An assigned user chats inside the project
 * the admin already opened; they do not create another project or program.
 */
export function canStartProgram(role: CompanyAccessRole): boolean {
  return role === "ADMIN";
}

/** Chat and edits stay inside a project the admin assigned. */
export function canChatInProject(input: {
  role: CompanyAccessRole;
  isProjectMember: boolean;
}): boolean {
  if (input.role === "ADMIN") return true;
  return input.isProjectMember;
}
