import { AuthError, resolveAuthContext, type AuthContext } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { isDemoAuthEnabled, isOpenAccess } from "@/lib/access-mode";
import {
  syncClerkOrgMembership,
  upgradeMembershipFromSession,
} from "@/lib/clerk-sync";
import {
  clerkUserIdForStaffRole,
  readStaffRoleCookie,
} from "@/lib/staff-access";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

async function seededAuthContext(clerkUserId: string) {
  const company =
    (await db.company.findFirst({ where: { slug: "demo-co" } })) ??
    (await db.company.findFirst({ orderBy: { createdAt: "asc" } }));
  const user = await db.user.findFirst({
    where: { clerkUserId },
  });
  if (!company || !user) return null;
  const membership = await db.companyMembership.findUniqueOrThrow({
    where: {
      companyId_userId: { companyId: company.id, userId: user.id },
    },
  });
  return {
    user,
    company,
    membership,
    role: membership.role,
  };
}

/**
 * Existing company members skip JIT sync. Promote them when the Clerk session
 * is a higher role. Signing in does not open a project or grant a workspace.
 */
async function applySessionRole(
  ctx: AuthContext,
  sessionRole: string | null | undefined,
) {
  const role = await upgradeMembershipFromSession({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    currentRole: ctx.role,
    sessionRole,
  });
  if (role === ctx.role) return ctx;
  return {
    ...ctx,
    role,
    membership: { ...ctx.membership, role },
  };
}

/**
 * Auth context:
 * - OPEN_ACCESS / demo → seeded employee on demo-co (single customer).
 *   All tenant filters still use companyId; only identity is fixed until Clerk.
 * - Clerk org + synced DB → real multi-tenant context (one Company per org).
 * - Clerk org present but DB lag → JIT sync from Clerk API
 */
export async function getRequestAuth() {
  if (isOpenAccess() || isDemoAuthEnabled()) {
    const staffRole = isOpenAccess() ? await readStaffRoleCookie() : null;
    let clerkUserId = "seed_employee";
    if (staffRole) {
      clerkUserId = clerkUserIdForStaffRole(staffRole);
    } else if (!isOpenAccess() && process.env.DEMO_ROLE) {
      clerkUserId =
        process.env.DEMO_ROLE === "developer" ||
        process.env.DEMO_ROLE === "dev"
          ? "seed_developer"
          : process.env.DEMO_ROLE === "admin"
            ? "seed_admin"
            : "seed_employee";
    }

    const ctx = await seededAuthContext(clerkUserId);
    if (ctx) return ctx;

    if (isOpenAccess() || !clerkEnabled) {
      throw new AuthError(
        "Open access is on but seed data is missing. Run pnpm db:seed.",
        500,
      );
    }
  }

  const { auth } = await import("@clerk/nextjs/server");
  const session = await auth();
  if (!session.userId) {
    throw new AuthError("Unauthorized", 401);
  }

  if (!session.orgId) {
    throw new AuthError(
      "No active organization. Create or select an organization to continue.",
      400,
    );
  }

  try {
    const ctx = await resolveAuthContext({
      clerkUserId: session.userId,
      clerkOrgId: session.orgId,
    });
    return await applySessionRole(ctx, session.orgRole);
  } catch (error) {
    if (!(error instanceof AuthError)) {
      throw error;
    }

    try {
      await syncClerkOrgMembership({
        clerkUserId: session.userId,
        clerkOrgId: session.orgId,
        orgRole: session.orgRole,
      });
      const ctx = await resolveAuthContext({
        clerkUserId: session.userId,
        clerkOrgId: session.orgId,
      });
      return await applySessionRole(ctx, session.orgRole);
    } catch (syncError) {
      console.error(
        "[auth] clerk org sync failed",
        syncError instanceof Error ? syncError.message : syncError,
      );
      throw error instanceof AuthError
        ? error
        : new AuthError(
            "Organization is not ready yet. Open Select organization and try again.",
            400,
          );
    }
  }
}
