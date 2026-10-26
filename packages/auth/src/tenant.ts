import { createHash } from "node:crypto";

/**
 * Defense-in-depth tenant guard — always pair resource id lookups with companyId.
 * Use after requireChangeRequestAccess for mutations that accept ids from the client.
 */
export function tenantWhere<T extends { companyId: string }>(
  ctx: { company: { id: string } },
  extra?: Partial<T>,
): T & { companyId: string } {
  return { ...(extra as T), companyId: ctx.company.id };
}

/** Stable scope key for open-access (single seeded company) vs Clerk multi-tenant. */
export function tenantScopeLabel(input: {
  companySlug: string;
  clerkOrgId: string | null;
  openAccess: boolean;
}): string {
  if (input.openAccess) {
    return `open-access:${input.companySlug}`;
  }
  return input.clerkOrgId ?? input.companySlug;
}

/** Hash for audit logs — never log raw tenant identifiers in shared ops logs. */
export function hashTenantRef(companyId: string): string {
  return createHash("sha256").update(companyId).digest("hex").slice(0, 12);
}
