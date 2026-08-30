import { cookies, headers } from "next/headers";
import { AuthError, resolveAuthContext } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { syncClerkOrgMembership } from "@/lib/clerk-sync";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function demoUserIdFromHint(hint: string | null | undefined) {
  const normalized = (hint ?? "").toLowerCase();
  if (normalized === "developer" || normalized === "dev") return "seed_developer";
  if (normalized === "admin") return "seed_admin";
  return "seed_employee";
}

/**
 * Dev-friendly auth context:
 * - With Clerk org + synced DB rows → real multi-tenant context
 * - Without Clerk configured / unsynced → fall back to seeded demo company
 * - Clerk org present but DB lag → JIT sync from Clerk API
 */
export async function getRequestAuth() {
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

    const company = await db.company.findFirst({
      where: { slug: "demo-co" },
    });
    const user = await db.user.findFirst({
      where: { clerkUserId: demoUserIdFromHint(hint) },
    });
    if (company && user) {
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
