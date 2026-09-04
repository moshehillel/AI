import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  writeAuditEvent,
  AuthError,
} from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { slugify } from "@automation-studio/domain";
import { verifyBranchProtection } from "@automation-studio/github";

const bodySchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  githubOwner: z.string().min(1),
  githubRepo: z.string().min(1),
  installationId: z.string().min(1).nullable().optional(),
  defaultBranch: z.string().min(1).max(200).optional(),
});

async function uniqueProjectSlug(companyId: string, base: string) {
  const root = slugify(base, 48) || "project";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const existing = await db.project.findUnique({
      where: { companyId_slug: { companyId, slug: candidate } },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/**
 * Create a Koda project from an existing GitHub repository (already accessible
 * via the company GitHub App installation), then connect that repo.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getRequestAuth();
    if (ctx.role !== "ADMIN" && ctx.role !== "DEVELOPER") {
      throw new AuthError("Forbidden", 403);
    }

    const body = bodySchema.parse(await request.json());
    const githubOwner = body.githubOwner.trim();
    const githubRepo = body.githubRepo.trim();
    const name =
      body.name?.trim() ||
      `${githubOwner}/${githubRepo}`.slice(0, 120);
    const slug = await uniqueProjectSlug(ctx.company.id, name);

    const installationId =
      body.installationId?.trim() ||
      (
        await db.githubInstallation.findFirst({
          where: { companyId: ctx.company.id },
          orderBy: { createdAt: "desc" },
          select: { installationId: true },
        })
      )?.installationId ||
      null;

    const project = await db.project.create({
      data: {
        companyId: ctx.company.id,
        name,
        slug,
        description:
          body.description?.trim() ||
          `Linked from GitHub ${githubOwner}/${githubRepo}`,
        repository: {
          create: {
            githubOwner,
            githubRepo,
            installationId,
            defaultBranch: body.defaultBranch?.trim() || "main",
          },
        },
      },
      include: { repository: true },
    });

    // Creator can always open the project; others still need Assign by email.
    await db.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: ctx.user.id,
        },
      },
      update: {},
      create: { projectId: project.id, userId: ctx.user.id },
    });

    let protection: Awaited<ReturnType<typeof verifyBranchProtection>> | null =
      null;
    if (project.repository) {
      try {
        protection = await verifyBranchProtection({
          installationId: project.repository.installationId ?? "0",
          owner: project.repository.githubOwner,
          repo: project.repository.githubRepo,
        });
      } catch {
        protection = null;
      }
    }

    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "project.created_from_repo",
      entityType: "project",
      entityId: project.id,
      metadata: {
        name,
        slug,
        githubOwner,
        githubRepo,
        installationId,
        protection,
      },
    });

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        repository: project.repository,
      },
      protection,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
