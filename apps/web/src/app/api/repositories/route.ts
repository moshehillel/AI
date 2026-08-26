import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  requireProjectAccess,
  writeAuditEvent,
  AuthError,
} from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { verifyBranchProtection } from "@automation-studio/github";

const bodySchema = z.object({
  projectId: z.string(),
  githubOwner: z.string().min(1),
  githubRepo: z.string().min(1),
  installationId: z.string().nullable().optional(),
  railwayProjectId: z.string().nullable().optional(),
  previewBaseEnvId: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await getRequestAuth();
    if (ctx.role !== "ADMIN" && ctx.role !== "DEVELOPER") {
      throw new AuthError("Forbidden", 403);
    }

    const body = bodySchema.parse(await request.json());
    await requireProjectAccess(ctx, body.projectId);

    const repository = await db.repository.upsert({
      where: { projectId: body.projectId },
      update: {
        githubOwner: body.githubOwner,
        githubRepo: body.githubRepo,
        installationId: body.installationId ?? undefined,
        railwayProjectId: body.railwayProjectId ?? undefined,
        previewBaseEnvId: body.previewBaseEnvId ?? undefined,
      },
      create: {
        projectId: body.projectId,
        githubOwner: body.githubOwner,
        githubRepo: body.githubRepo,
        installationId: body.installationId ?? null,
        railwayProjectId: body.railwayProjectId ?? null,
        previewBaseEnvId: body.previewBaseEnvId ?? null,
      },
    });

    const protection = await verifyBranchProtection({
      installationId: repository.installationId ?? "0",
      owner: repository.githubOwner,
      repo: repository.githubRepo,
    });

    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "repository.connected",
      entityType: "project",
      entityId: body.projectId,
      metadata: {
        githubOwner: body.githubOwner,
        githubRepo: body.githubRepo,
        protection,
      },
    });

    return NextResponse.json({ repository, protection });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
