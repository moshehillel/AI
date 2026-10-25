/** Shared planning workspace — every company member can start programs here. */
export const CUSTOMER_ONBOARDING_SLUG = "customer-onboarding";

export type CompanyAccessRole = "ADMIN" | "DEVELOPER" | "EMPLOYEE";

const ROLE_RANK: Record<CompanyAccessRole, number> = {
  EMPLOYEE: 0,
  DEVELOPER: 1,
  ADMIN: 2,
};

/** Map a Clerk organization role onto our company role. Unknown roles can still plan. */
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

/**
 * Start planning is available to any company member once the shared
 * customer-onboarding workspace exists. Project assignment is not required.
 */
export function canStartPlanningProgram(input: {
  hasCompanyMembership: boolean;
  onboardingProjectId: string | null | undefined;
}): boolean {
  return input.hasCompanyMembership && Boolean(input.onboardingProjectId);
}
