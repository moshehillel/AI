import { db, MembershipRole } from "@automation-studio/db";
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

  // Ensure seeded projects stay reachable for newly linked members.
  const projects = await db.project.findMany({
    where: { companyId: company.id, status: "ACTIVE" },
    select: { id: true },
  });
  for (const project of projects) {
    await db.projectMember.upsert({
      where: {
        projectId_userId: { projectId: project.id, userId: user.id },
      },
      update: {},
      create: { projectId: project.id, userId: user.id },
    });
  }

  return { user, company, role };
}
