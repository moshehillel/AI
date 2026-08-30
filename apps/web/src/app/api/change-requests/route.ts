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
import { getAppBaseUrl } from "@/lib/app-url";

const bodySchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(3).max(200).optional(),
  prompt: z.string().min(3).max(8000),
  kind: z.enum(["CHANGE", "PROGRAM"]).default("CHANGE"),
  apiDocsUrl: z.string().url().optional().or(z.literal("")),
  docsText: z.string().max(20000).optional(),
  examples: z.string().max(20000).optional(),
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
    const title = body.title?.trim() || shortTitleFromPrompt(body.prompt);
    const isProgram = body.kind === "PROGRAM";

    const planningMeta = isProgram
      ? {
          apiDocsUrl: body.apiDocsUrl || null,
          docsText: body.docsText || null,
          examples: body.examples || null,
        }
      : {};

    const changeRequest = await db.changeRequest.create({
      data: {
        companyId: ctx.company.id,
        projectId: body.projectId,
        createdById: ctx.user.id,
        number,
        title,
        description: body.prompt,
        shortDescription: slugify(title),
        kind: body.kind,
        classification: isProgram ? "COMPLEX" : "NORMAL",
        status: isProgram ? "PLANNING" : "DRAFT",
        planningMeta,
        messages: {
          create: [
            {
              role: "USER",
              authorId: ctx.user.id,
              content: body.prompt,
            },
            ...(isProgram
              ? [
                  {
                    role: "SYSTEM" as const,
                    authorId: ctx.user.id,
                    content:
                      "Welcome to program planning. Share API docs, examples, and workflow details. Koda stays in plan mode until you submit to a developer for building.\n\nKoda is AI and can make mistakes.",
                  },
                ]
              : []),
          ],
        },
        statusEvents: {
          create: {
            toStatus: isProgram ? "PLANNING" : "DRAFT",
            actorId: ctx.user.id,
            reason: isProgram ? "Program created in plan mode" : "Change request created",
          },
        },
      },
    });

    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: isProgram ? "program.created" : "change_request.created",
      entityType: "change_request",
      entityId: changeRequest.id,
      metadata: { number, title, kind: body.kind },
    });

    if (isProgram) {
      // Plan-mode AI conversation without starting a build
      const planningContext = [
        `Program: ${title}`,
        body.prompt,
        body.apiDocsUrl ? `API docs URL: ${body.apiDocsUrl}` : null,
        body.docsText ? `Uploaded/pasted docs:\n${body.docsText}` : null,
        body.examples ? `Examples:\n${body.examples}` : null,
        "",
        "You are Koda in PLANNING mode only. Do not implement or write production code.",
        "Ask clarifying questions, propose a clear build plan, and wait for the client to submit to a developer.",
        `App: ${getAppBaseUrl()}`,
      ]
        .filter(Boolean)
        .join("\n");

      // Soft-start planning reply via mock/live AI if a repo exists later;
      // for now create an assistant plan stub so chat feels alive.
      await db.changeRequestMessage.create({
        data: {
          changeRequestId: changeRequest.id,
          role: "ASSISTANT",
          content: [
            "I've started planning this program with you.",
            "",
            "To build a solid plan, please share:",
            "1. Links to API documentation (or paste key endpoints)",
            "2. Example requests/responses or sample files",
            "3. The business workflow you want automated",
            "4. Any systems, credentials, or constraints I should know about",
            "",
            "When you're satisfied with the plan, use **Submit to developer for building**.",
            "",
            "Koda is AI and can make mistakes.",
          ].join("\n"),
          metadata: { planningBootstrap: true, contextChars: planningContext.length },
        },
      });
    } else {
      await enqueueJob(
        "change-request.classify",
        {
          changeRequestId: changeRequest.id,
          companyId: ctx.company.id,
        },
        { jobId: `classify-${changeRequest.id}` },
      );
    }

    return NextResponse.json({
      id: changeRequest.id,
      number,
      kind: body.kind,
    });
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
