import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import { AuthError, writeAuditEvent } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { verifyBranchProtection } from "@automation-studio/github";

const bodySchema = z.object({
  projectId: z.string(),
});

export async function POST(request: Request) {
  try {
    const ctx = await getRequestAuth();
    if (ctx.role !== "ADMIN" && ctx.role !== "DEVELOPER") {
      throw new AuthError("Forbidden", 403);
    }
    const body = bodySchema.parse(await request.json());
    const repo = await db.repository.findFirst({
      where: {
        projectId: body.projectId,
        project: { companyId: ctx.company.id },
      },
    });
    if (!repo) {
      throw new AuthError("Repository not connected", 404);
    }

    const protection = await verifyBranchProtection({
      installationId: repo.installationId ?? "0",
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      branch: repo.defaultBranch,
    });

    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "github.protection_verified",
      entityType: "project",
      entityId: body.projectId,
      metadata: protection,
    });

    return NextResponse.json({ protection });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
