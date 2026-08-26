import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  requirePermission,
  requireProjectAccess,
  writeAuditEvent,
  AuthError,
} from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { shortTitleFromPrompt, slugify } from "@automation-studio/domain";
import { enqueueJob } from "@automation-studio/jobs";

const bodySchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(3).max(8000),
});

export async function POST(request: Request) {
  try {
    const ctx = await getRequestAuth();
    await requirePermission(ctx, "change_request:create");

    const body = bodySchema.parse(await request.json());
    await requireProjectAccess(ctx, body.projectId);

    const latest = await db.changeRequest.findFirst({
      where: { projectId: body.projectId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const number = (latest?.number ?? 0) + 1;
    const title = shortTitleFromPrompt(body.prompt);

    const changeRequest = await db.changeRequest.create({
      data: {
        companyId: ctx.company.id,
        projectId: body.projectId,
        createdById: ctx.user.id,
        number,
        title,
        description: body.prompt,
        shortDescription: slugify(title),
        status: "DRAFT",
        messages: {
          create: {
            role: "USER",
            authorId: ctx.user.id,
            content: body.prompt,
          },
        },
        statusEvents: {
          create: {
            toStatus: "DRAFT",
            actorId: ctx.user.id,
            reason: "Change request created",
          },
        },
      },
    });

    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "change_request.created",
      entityType: "change_request",
      entityId: changeRequest.id,
      metadata: { number, title },
    });

    await enqueueJob(
      "change-request.classify",
      {
        changeRequestId: changeRequest.id,
        companyId: ctx.company.id,
      },
      { jobId: `classify-${changeRequest.id}` },
    );

    return NextResponse.json({ id: changeRequest.id, number });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
