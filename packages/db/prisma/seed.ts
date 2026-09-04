import { PrismaClient, MembershipRole, ProjectStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.upsert({
    where: { slug: "demo-co" },
    update: {},
    create: {
      name: "Demo Company",
      slug: "demo-co",
      settings: {
        demo: true,
        usageSoftCapCents: 250000,
        usageSoftCapTokens: 5_000_000,
        allowAdminDeploy: false,
      },
    },
  });

  const admin = await prisma.user.upsert({
    where: { clerkUserId: "seed_admin" },
    update: {},
    create: {
      clerkUserId: "seed_admin",
      email: "admin@demo.local",
      name: "Demo Admin",
      slug: "demo-admin",
    },
  });

  const employee = await prisma.user.upsert({
    where: { clerkUserId: "seed_employee" },
    update: {},
    create: {
      clerkUserId: "seed_employee",
      email: "sarah@demo.local",
      name: "Sarah",
      slug: "sarah",
    },
  });

  const developer = await prisma.user.upsert({
    where: { clerkUserId: "seed_developer" },
    update: {},
    create: {
      clerkUserId: "seed_developer",
      email: "dev@demo.local",
      name: "Alex Developer",
      slug: "alex",
    },
  });

  for (const [userId, role] of [
    [admin.id, MembershipRole.ADMIN],
    [employee.id, MembershipRole.EMPLOYEE],
    [developer.id, MembershipRole.DEVELOPER],
  ] as const) {
    await prisma.companyMembership.upsert({
      where: { companyId_userId: { companyId: company.id, userId } },
      update: { role },
      create: { companyId: company.id, userId, role },
    });
  }

  const projects = [
    {
      name: "Customer Onboarding",
      slug: "customer-onboarding",
      description: "New customer provisioning workflows",
    },
    {
      name: "Invoice Automation",
      slug: "invoice-automation",
      description: "Process and retry failed invoices",
    },
    {
      name: "Reporting System",
      slug: "reporting-system",
      description: "Internal reporting dashboards",
    },
  ];

  for (const p of projects) {
    const project = await prisma.project.upsert({
      where: { companyId_slug: { companyId: company.id, slug: p.slug } },
      update: { description: p.description, status: ProjectStatus.ACTIVE },
      create: {
        companyId: company.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
      },
    });

    for (const userId of [admin.id, employee.id, developer.id]) {
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId } },
        update: {},
        create: { projectId: project.id, userId },
      });
    }

    const owner = process.env.DEFAULT_GITHUB_OWNER?.trim();
    const repo = process.env.DEFAULT_GITHUB_REPO?.trim();
    if (owner && repo) {
      await prisma.repository.upsert({
        where: { projectId: project.id },
        update: {
          githubOwner: owner,
          githubRepo: repo,
          installationId:
            process.env.DEFAULT_GITHUB_INSTALLATION_ID?.trim() || undefined,
          defaultBranch: process.env.DEFAULT_GITHUB_BRANCH?.trim() || "main",
        },
        create: {
          projectId: project.id,
          githubOwner: owner,
          githubRepo: repo,
          installationId:
            process.env.DEFAULT_GITHUB_INSTALLATION_ID?.trim() || null,
          defaultBranch: process.env.DEFAULT_GITHUB_BRANCH?.trim() || "main",
        },
      });
    }
  }

  console.log("Seeded demo company, users, and projects for Koda");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
