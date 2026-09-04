import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma uses the Postgres driver pool from DATABASE_URL.
 * On Railway, append pool params if needed, e.g.:
 *   ?connection_limit=10&pool_timeout=20
 * Use a lower limit per web replica; worker typically needs fewer connections.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
export { prisma as db };
export {
  ensurePlanningRepository,
  type PlanningRepoDefaults,
} from "./planning-repo.js";
export { ensureCustomerOnboardingProject } from "./onboarding-project.js";
