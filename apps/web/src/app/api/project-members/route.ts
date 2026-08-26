import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  requireProjectAccess,
  writeAuditEvent,
  AuthError,
} from "@automation-studio/auth";
import { db } from "@automation-studio/db";

const bodySchema = z.object({
  projectId: z.string(),
  userId: z.string(),
  action: z.enum(["add", "remove"]),
});

export async function POST(request: Request) {
  try {
    const ctx = await getRequestAuth();
    if (ctx.role !== "ADMIN") {
      throw new AuthError("Only admins can manage project members", 403);
    }

    const body = bodySchema.parse(await request.json());
    await requireProjectAccess(ctx, body.projectId);

    const target = await db.companyMembership.findUnique({
      where: {
        companyId_userId: {
          companyId: ctx.company.id,
          userId: body.userId,
        },
      },
    });
    if (!target) {
      throw new AuthError("User is not a company member", 400);
    }

    if (body.action === "add") {
      await db.projectMember.upsert({
        where: {
          projectId_userId: {
            projectId: body.projectId,
            userId: body.userId,
          },
        },
        update: {},
        create: { projectId: body.projectId, userId: body.userId },
      });
    } else {
      await db.projectMember.deleteMany({
        where: { projectId: body.projectId, userId: body.userId },
      });
    }

    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action:
        body.action === "add"
          ? "project.member_added"
          : "project.member_removed",
      entityType: "project",
      entityId: body.projectId,
      metadata: { userId: body.userId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
