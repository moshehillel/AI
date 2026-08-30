import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  requirePermission,
  requireProjectAccess,
  writeAuditEvent,
  AuthError,
} from "@automation-studio/auth";
import { db, ensurePlanningRepository } from "@automation-studio/db";
import {
  shortTitleFromPrompt,
  slugify,
  buildOpeningPlanningMessage,
  getDefaultGithubRepoConfig,
  isLiveCursorConfigured,
  type PlanningMeta,
} from "@automation-studio/domain";
import { enqueueJob } from "@automation-studio/jobs";

const bodySchema = z
  .object({
    projectId: z.string().min(1),
    title: z.string().min(3).max(200).optional(),
    prompt: z.string().max(8000).optional(),
    kind: z.enum(["CHANGE", "PROGRAM"]).default("CHANGE"),
    apiDocsUrl: z.string().url().optional().or(z.literal("")),
    docsText: z.string().max(20000).optional(),
    examples: z.string().max(20000).optional(),
  })
  .superRefine((value, ctx) => {
    const prompt = value.prompt?.trim() ?? "";
    if (value.kind === "CHANGE" && prompt.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prompt is required",
        path: ["prompt"],
      });
    }
    if (value.kind === "PROGRAM" && !value.title?.trim() && prompt.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add a program name or a short starting note",
        path: ["prompt"],
      });
    }
  });

export async function POST(request: Request) {
  try {
    const ctx = await getRequestAuth();
    await requirePermission(ctx, "change_request:create");

    const body = bodySchema.parse(await request.json());
    await requireProjectAccess(ctx, body.projectId);

    if (body.kind === "CHANGE" && ctx.role === "EMPLOYEE") {
      return NextResponse.json(
        { error: "Small changes are not available. Start a new program instead." },
        { status: 403 },
      );
    }

    const latest = await db.changeRequest.findFirst({
      where: { projectId: body.projectId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const number = (latest?.number ?? 0) + 1;
    const prompt = body.prompt?.trim() ?? "";
    const isProgram = body.kind === "PROGRAM";
    const title =
      body.title?.trim() ||
      (prompt ? shortTitleFromPrompt(prompt) : `Program ${number}`);

    const planningMeta: PlanningMeta = isProgram
      ? {
          apiDocsUrl: body.apiDocsUrl || null,
          docsText: body.docsText || null,
          examples: body.examples || null,
          coveredTopics: prompt ? ["goals"] : [],
          lastQuestionTopic: null,
        }
      : {};

    const opening = isProgram
      ? buildOpeningPlanningMessage({
          title,
          hasInitialPrompt: prompt.length >= 3,
        })
      : null;

    const project = await db.project.findFirst({
      where: { id: body.projectId },
      include: { repository: true },
    });

    const changeRequest = await db.changeRequest.create({
      data: {
        companyId: ctx.company.id,
        projectId: body.projectId,
        createdById: ctx.user.id,
        number,
        title,
        description: prompt || title,
        shortDescription: slugify(title),
        kind: body.kind,
        classification: isProgram ? "COMPLEX" : "NORMAL",
        status: isProgram ? "PLANNING" : "DRAFT",
        planningMeta,
        messages: {
          create: [
            ...(prompt
              ? [
                  {
                    role: "USER" as const,
                    authorId: ctx.user.id,
                    content: prompt,
                  },
                ]
              : []),
            ...(opening
              ? [
                  {
                    role: "ASSISTANT" as const,
                    authorId: ctx.user.id,
                    content: opening,
                    metadata: {
                      planningBootstrap: true,
                      openingQuestion: true,
                    },
                  },
                ]
              : []),
          ],
        },
        statusEvents: {
          create: {
            toStatus: isProgram ? "PLANNING" : "DRAFT",
            actorId: ctx.user.id,
            reason: isProgram
              ? "Program created — live planning session starting"
              : "Change request created",
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

    if (!isProgram) {
      await enqueueJob(
        "change-request.classify",
        {
          changeRequestId: changeRequest.id,
          companyId: ctx.company.id,
        },
        { jobId: `classify-${changeRequest.id}` },
      );
    } else {
      // Auto-link planning repo so live Cursor plan mode can start immediately.
      let repository = project?.repository ?? null;
      if (!repository) {
        repository = await ensurePlanningRepository(db, {
          projectId: body.projectId,
          companyId: ctx.company.id,
          defaults: getDefaultGithubRepoConfig(),
        });
      }

      if (repository && isLiveCursorConfigured()) {
        await enqueueJob(
          "github.ensure-branch",
          {
            changeRequestId: changeRequest.id,
            companyId: ctx.company.id,
          },
          { jobId: `plan-branch-${changeRequest.id}` },
        );
      }
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
