import { db, MembershipRole, ensureCustomerOnboardingProject } from "@automation-studio/db";
import { slugify } from "@automation-studio/domain";

function mapClerkRole(role: string | null | undefined): MembershipRole {
  if (role === "org:admin") return "ADMIN";
  if (role === "org:developer") return "DEVELOPER";
  return "EMPLOYEE";
}

/**
 * Upsert Clerk user + organization + membership when webhooks lagged or missed.
 * First real org claims the seeded demo-co company (clerkOrgId null) so existing
 * projects remain usable after turning off demo auth.
 */
export async function syncClerkOrgMembership(input: {
  clerkUserId: string;
  clerkOrgId: string;
  orgRole?: string | null;
}) {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();

  const clerkUser = await client.users.getUser(input.clerkUserId);
  const email =
    clerkUser.emailAddresses.find(
      (entry) => entry.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    `${input.clerkUserId}@users.local`;
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    email;

  const user = await db.user.upsert({
    where: { clerkUserId: input.clerkUserId },
    update: { email, name, slug: slugify(name || email) },
    create: {
      clerkUserId: input.clerkUserId,
      email,
      name,
      slug: slugify(name || email),
    },
  });

  const org = await client.organizations.getOrganization({
    organizationId: input.clerkOrgId,
  });
  const orgName = org.name || "Company";

  let company = await db.company.findUnique({
    where: { clerkOrgId: input.clerkOrgId },
  });

  if (!company) {
    const claimable = await db.company.findFirst({
      where: { slug: "demo-co", clerkOrgId: null },
    });
    if (claimable) {
      company = await db.company.update({
        where: { id: claimable.id },
        data: { clerkOrgId: input.clerkOrgId, name: orgName },
      });
    } else {
      company = await db.company.create({
        data: {
          clerkOrgId: input.clerkOrgId,
          name: orgName,
          slug: slugify(orgName),
        },
      });
    }
  }

  let role = mapClerkRole(input.orgRole);
  try {
    const memberships =
      await client.organizations.getOrganizationMembershipList({
        organizationId: input.clerkOrgId,
        limit: 100,
      });
    const mine = memberships.data.find(
      (m) => m.publicUserData?.userId === input.clerkUserId,
    );
    if (mine?.role) role = mapClerkRole(mine.role);
  } catch {
    // session.orgRole is enough when membership list is unavailable
  }

  await db.companyMembership.upsert({
    where: {
      companyId_userId: { companyId: company.id, userId: user.id },
    },
    update: { role },
    create: { companyId: company.id, userId: user.id, role },
  });

  // Shared planning workspace only — admin assigns other projects for iterate flows.
  const onboarding = await ensureCustomerOnboardingProject(db, company.id);
  await db.projectMember.upsert({
    where: {
      projectId_userId: { projectId: onboarding.id, userId: user.id },
    },
    update: {},
    create: { projectId: onboarding.id, userId: user.id },
  });

  return { user, company, role };
}

/**
 * Resolve an existing Clerk user by email or Clerk user id, upsert into our DB,
 * optionally ensure they belong to the active Clerk org + company, and return
 * the local User. Does not create Clerk accounts — signup is admin/invite only.
 */
export async function ensureExistingClerkUserOnCompany(input: {
  companyId: string;
  clerkOrgId: string | null;
  email?: string | null;
  userId?: string | null;
  clerkUserId?: string | null;
  /** When false, only resolve the user (for remove). Default true. */
  ensureMembership?: boolean;
}) {
  const email = input.email?.trim().toLowerCase() || null;
  const localUserId = input.userId?.trim() || null;
  const clerkUserIdHint = input.clerkUserId?.trim() || null;
  const ensureMembership = input.ensureMembership !== false;

  if (!email && !localUserId && !clerkUserIdHint) {
    throw new Error("Provide email, user id, or Clerk user id");
  }

  let user =
    (localUserId
      ? await db.user.findUnique({ where: { id: localUserId } })
      : null) ??
    (clerkUserIdHint
      ? await db.user.findUnique({ where: { clerkUserId: clerkUserIdHint } })
      : null) ??
    (email
      ? await db.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        })
      : null);

  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const shouldSyncClerk =
    ensureMembership && clerkEnabled && Boolean(input.clerkOrgId);

  if (shouldSyncClerk && input.clerkOrgId) {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();

    let clerkUserId = user?.clerkUserId ?? clerkUserIdHint;
    if (!clerkUserId && email) {
      const listed = await client.users.getUserList({
        emailAddress: [email],
        limit: 1,
      });
      clerkUserId = listed.data[0]?.id ?? null;
    }
    if (!clerkUserId) {
      throw new Error(
        "No Clerk user found for that email. Create the login in Clerk first, then assign the project.",
      );
    }

    const clerkUser = await client.users.getUser(clerkUserId);
    const resolvedEmail =
      clerkUser.emailAddresses.find(
        (entry) => entry.id === clerkUser.primaryEmailAddressId,
      )?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      email ??
      `${clerkUserId}@users.local`;
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
      resolvedEmail;

    user = await db.user.upsert({
      where: { clerkUserId },
      update: {
        email: resolvedEmail,
        name,
        slug: slugify(name || resolvedEmail),
      },
      create: {
        clerkUserId,
        email: resolvedEmail,
        name,
        slug: slugify(name || resolvedEmail),
      },
    });

    try {
      await client.organizations.createOrganizationMembership({
        organizationId: input.clerkOrgId,
        userId: clerkUserId,
        role: "org:employee",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Already a member, or custom role key differs — try default org:member once.
      if (!/already.?a.?member|already_exists|duplicate/i.test(message)) {
        try {
          await client.organizations.createOrganizationMembership({
            organizationId: input.clerkOrgId,
            userId: clerkUserId,
            role: "org:member",
          });
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError);
          if (
            !/already.?a.?member|already_exists|duplicate/i.test(fallbackMessage)
          ) {
            // Membership may already exist under another role; company row is enough.
            console.warn(
              "[clerk-sync] org membership ensure skipped:",
              fallbackMessage,
            );
          }
        }
      }
    }
  } else if (!user && email && clerkEnabled && !input.clerkOrgId) {
    throw new Error(
      "Company has no Clerk organization linked. Select/link a Clerk org before adding members by email.",
    );
  }

  if (!user) {
    throw new Error(
      "User not found locally. Create the Clerk login first, or pick a company member.",
    );
  }

  if (ensureMembership) {
    await db.companyMembership.upsert({
      where: {
        companyId_userId: {
          companyId: input.companyId,
          userId: user.id,
        },
      },
      update: {},
      create: {
        companyId: input.companyId,
        userId: user.id,
        role: MembershipRole.EMPLOYEE,
      },
    });
  }

  return user;
}
