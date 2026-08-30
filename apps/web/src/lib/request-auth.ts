import { cookies, headers } from "next/headers";
import { AuthError, resolveAuthContext } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { syncClerkOrgMembership } from "@/lib/clerk-sync";
import { isOpenAccess } from "@/lib/open-access";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function demoUserIdFromHint(hint: string | null | undefined) {
  const normalized = (hint ?? "").toLowerCase();
  if (normalized === "developer" || normalized === "dev") return "seed_developer";
  if (normalized === "admin") return "seed_admin";
  return "seed_employee";
}

async function seededAuthContext(clerkUserId: string) {
  const company = await db.company.findFirst({
    where: { slug: "demo-co" },
  });
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
 * Auth context resolution:
 * - OPEN_ACCESS=1 → fixed seeded customer (EMPLOYEE / seed_employee); no Clerk
 * - ALLOW_DEMO_AUTH=1 → seeded users with optional role cookie switcher
 * - Clerk org + synced DB → real multi-tenant context
 * - Clerk org present but DB lag → JIT sync from Clerk API
 */
export async function getRequestAuth() {
  if (isOpenAccess()) {
    const ctx = await seededAuthContext("seed_employee");
    if (ctx) return ctx;
    throw new AuthError(
      "Open access is enabled but seed customer data is missing. Run pnpm db:seed.",
      500,
    );
  }

  if (!clerkEnabled || process.env.ALLOW_DEMO_AUTH === "1") {
    let hint = process.env.DEMO_ROLE ?? "employee";
    if (process.env.ALLOW_DEMO_AUTH === "1") {
      try {
        const h = await headers();
        const cookieStore = await cookies();
        hint =
          h.get("x-demo-user") ??
          cookieStore.get("demo_user")?.value ??
          hint;
      } catch {
        // headers/cookies unavailable outside request scope
      }
    }

    const ctx = await seededAuthContext(demoUserIdFromHint(hint));
    if (ctx) return ctx;

    if (!clerkEnabled) {
      throw new AuthError(
        "Clerk is not configured and demo auth data is missing. Run pnpm db:seed.",
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
    return await resolveAuthContext({
      clerkUserId: session.userId,
      clerkOrgId: session.orgId,
    });
  } catch (error) {
    if (!(error instanceof AuthError)) {
      throw error;
    }

    // Webhook lag / missed org events — sync from Clerk then retry once.
    try {
      await syncClerkOrgMembership({
        clerkUserId: session.userId,
        clerkOrgId: session.orgId,
        orgRole: session.orgRole,
      });
      return await resolveAuthContext({
        clerkUserId: session.userId,
        clerkOrgId: session.orgId,
      });
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
