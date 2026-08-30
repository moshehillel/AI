import type { PrismaClient, Repository } from "@prisma/client";

export type PlanningRepoDefaults = {
  githubOwner: string;
  githubRepo: string;
  installationId: string | null;
  defaultBranch: string;
};

/**
 * Ensure the project has a Repository row so plan-mode can start a live Cursor
 * agent (branch ensure → cursor.start). Prefers an existing project repo, then
 * copies another company repo connection, then platform DEFAULT_GITHUB_* env.
 */
export async function ensurePlanningRepository(
  db: PrismaClient,
  opts: {
    projectId: string;
    companyId: string;
    defaults?: PlanningRepoDefaults | null;
  },
): Promise<Repository | null> {
  const existing = await db.repository.findUnique({
    where: { projectId: opts.projectId },
  });
  if (existing) return existing;

  const sibling = await db.repository.findFirst({
    where: { project: { companyId: opts.companyId } },
    orderBy: { createdAt: "asc" },
  });

  const source = sibling
    ? {
        githubOwner: sibling.githubOwner,
        githubRepo: sibling.githubRepo,
        installationId: sibling.installationId,
        defaultBranch: sibling.defaultBranch,
      }
    : opts.defaults ?? null;

  if (!source) return null;

  return db.repository.create({
    data: {
      projectId: opts.projectId,
      githubOwner: source.githubOwner,
      githubRepo: source.githubRepo,
      installationId: source.installationId,
      defaultBranch: source.defaultBranch || "main",
    },
  });
}
