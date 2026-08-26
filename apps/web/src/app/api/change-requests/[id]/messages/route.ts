import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  requireChangeRequestAccess,
  requirePermission,
  AuthError,
} from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { enqueueJob } from "@automation-studio/jobs";

const bodySchema = z.object({
  content: z.string().min(1).max(8000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requirePermission(ctx, "change_request:chat");
    const cr = await requireChangeRequestAccess(ctx, id);
    const body = bodySchema.parse(await request.json());

    const message = await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        authorId: ctx.user.id,
        role: "USER",
        content: body.content,
      },
    });

    if (cr.cursorAgentId) {
      await enqueueJob("cursor.follow-up", {
        changeRequestId: cr.id,
        companyId: ctx.company.id,
        prompt: body.content,
        mode: "agent",
      });
    }

    return NextResponse.json({
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
