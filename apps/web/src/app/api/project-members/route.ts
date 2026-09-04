import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import { ensureExistingClerkUserOnCompany } from "@/lib/clerk-sync";
import {
  requirePermission,
  requireProjectAccess,
  writeAuditEvent,
  AuthError,
} from "@automation-studio/auth";
import { db } from "@automation-studio/db";

const bodySchema = z
  .object({
    projectId: z.string().min(1),
    action: z.enum(["add", "remove"]),
    /** Local DB user id (company member dropdown). */
    userId: z.string().min(1).optional(),
    /** Existing Clerk login email. */
    email: z.string().email().optional(),
    /** Existing Clerk user id (user_…). */
    clerkUserId: z.string().min(1).optional(),
  })
  .refine(
    (value) => Boolean(value.userId || value.email || value.clerkUserId),
    { message: "Provide userId, email, or clerkUserId" },
  );

export async function POST(request: Request) {
  try {
    const ctx = await getRequestAuth();
    await requirePermission(ctx, "members:manage");

    const body = bodySchema.parse(await request.json());
    await requireProjectAccess(ctx, body.projectId);

    const target = await ensureExistingClerkUserOnCompany({
      companyId: ctx.company.id,
      clerkOrgId: ctx.company.clerkOrgId,
      userId: body.userId,
      email: body.email,
      clerkUserId: body.clerkUserId,
      ensureMembership: body.action === "add",
    });

    if (body.action === "add") {
      await db.projectMember.upsert({
        where: {
          projectId_userId: {
            projectId: body.projectId,
            userId: target.id,
          },
        },
        update: {},
        create: { projectId: body.projectId, userId: target.id },
      });
    } else {
      await db.projectMember.deleteMany({
        where: { projectId: body.projectId, userId: target.id },
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
      metadata: {
        userId: target.id,
        email: target.email,
        clerkUserId: target.clerkUserId,
      },
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: target.id,
        email: target.email,
        name: target.name,
      },
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
    const message =
      error instanceof Error ? error.message : "Internal error";
    const status = /not found|Provide |Create the/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
