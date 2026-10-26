import type { PrismaClient } from "@prisma/client";
import { ProjectStatus } from "@prisma/client";

/** Keep in sync with CUSTOMER_ONBOARDING_SLUG in @automation-studio/domain. */
const CUSTOMER_ONBOARDING_SLUG = "customer-onboarding";

/**
 * Ensure the legacy customer-onboarding project row exists.
 * Membership is not granted here. Only an admin assignment allows chat.
 */
export async function ensureCustomerOnboardingProject(
  db: PrismaClient,
  companyId: string,
) {
  return db.project.upsert({
    where: {
      companyId_slug: { companyId, slug: CUSTOMER_ONBOARDING_SLUG },
    },
    update: { status: ProjectStatus.ACTIVE },
    create: {
      companyId,
      name: "Customer Onboarding",
      slug: CUSTOMER_ONBOARDING_SLUG,
      description: "Plan new automations with Koda",
      status: ProjectStatus.ACTIVE,
    },
  });
}
